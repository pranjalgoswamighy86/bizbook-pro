#!/usr/bin/env python3
"""Read-only BizBook Pro health load check.

This script only sends GET requests to /api/health. It never logs in,
registers users, sends OTPs, exports/restores backups, or mutates data.

Required:
  BIZBOOK_BASE_URL=https://your-test-or-staging-host

Optional:
  BIZBOOK_STRESS_REQUESTS=20       (1-200)
  BIZBOOK_STRESS_CONCURRENCY=5     (1-25)

Production safety:
  The live production hostname is blocked unless
  BIZBOOK_ALLOW_PRODUCTION_STRESS=YES is set explicitly.
"""
from __future__ import annotations

import os
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

PRODUCTION_HOST = "carefree-success-production-7766.up.railway.app"


def read_bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise SystemExit(f"{name} must be an integer.") from exc
    if not minimum <= value <= maximum:
        raise SystemExit(f"{name} must be between {minimum} and {maximum}.")
    return value


def main() -> int:
    base_url = os.environ.get("BIZBOOK_BASE_URL", "").strip().rstrip("/")
    if not base_url:
        raise SystemExit("Set BIZBOOK_BASE_URL to an explicit test or staging URL.")

    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise SystemExit("BIZBOOK_BASE_URL must be a valid HTTP(S) URL.")
    if parsed.username or parsed.password:
        raise SystemExit("Do not embed credentials in BIZBOOK_BASE_URL.")
    if parsed.hostname.lower() == PRODUCTION_HOST and os.environ.get(
        "BIZBOOK_ALLOW_PRODUCTION_STRESS"
    ) != "YES":
        raise SystemExit(
            "Production load testing is blocked. Set BIZBOOK_ALLOW_PRODUCTION_STRESS=YES "
            "only after explicitly approving a controlled production test."
        )

    request_count = read_bounded_int("BIZBOOK_STRESS_REQUESTS", 20, 1, 200)
    concurrency = read_bounded_int("BIZBOOK_STRESS_CONCURRENCY", 5, 1, 25)
    endpoint = f"{base_url}/api/health"

    def probe(index: int) -> tuple[int, float, str]:
        request = Request(
            endpoint,
            headers={"User-Agent": "BizBookPro-ReadOnlyHealthCheck/1.0"},
            method="GET",
        )
        started = time.perf_counter()
        try:
            with urlopen(request, timeout=15) as response:
                status = int(response.status)
                response.read(1024)
                detail = "OK" if 200 <= status < 300 else f"HTTP {status}"
        except HTTPError as error:
            status = int(error.code)
            detail = f"HTTP {status}"
        except Exception as error:  # network and timeout failures
            status = 0
            detail = type(error).__name__
        return status, time.perf_counter() - started, detail

    print(f"Target: {endpoint}")
    print(f"Requests: {request_count}; concurrency: {concurrency}")
    print("Mode: GET-only, read-only; no authentication or data changes")

    results: list[tuple[int, float, str]] = []
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(probe, index) for index in range(request_count)]
        for future in as_completed(futures):
            results.append(future.result())

    successful = [entry for entry in results if 200 <= entry[0] < 300]
    latencies = [entry[1] for entry in results]
    failure_counts: dict[str, int] = {}
    for status, _, detail in results:
        if not 200 <= status < 300:
            failure_counts[detail] = failure_counts.get(detail, 0) + 1

    success_rate = len(successful) / request_count * 100
    print(f"Successful: {len(successful)}/{request_count} ({success_rate:.1f}%)")
    print(f"Average latency: {statistics.mean(latencies):.3f}s")
    print(f"Maximum latency: {max(latencies):.3f}s")
    if failure_counts:
        print("Failures:")
        for reason, count in sorted(failure_counts.items()):
            print(f"  {reason}: {count}")
    return 0 if success_rate >= 95 else 1


if __name__ == "__main__":
    sys.exit(main())
