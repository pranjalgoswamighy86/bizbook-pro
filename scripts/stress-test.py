#!/usr/bin/env python3
"""
BizBook Pro — Stress Test & Load Test
======================================
Tests the deployed application for:
  1. Response time under concurrent load
  2. Error rate at various concurrency levels
  3. Endpoint-specific stress (health, login, register, backup, restore)
  4. Sustained load over time

Usage:
  python3 scripts/stress-test.py
"""

import requests
import time
import threading
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict

BASE_URL = "https://carefree-success-production-7766.up.railway.app"

# Colors for terminal output
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
RESET = "\033[0m"
BOLD = "\033[1m"

def print_header(title):
    print(f"\n{BOLD}{CYAN}{'='*60}{RESET}")
    print(f"{BOLD}{CYAN}  {title}{RESET}")
    print(f"{BOLD}{CYAN}{'='*60}{RESET}\n")

def print_result(label, status, response_time, error=None):
    color = GREEN if status == "PASS" else RED if status == "FAIL" else YELLOW
    time_str = f"{response_time:.3f}s" if response_time else "N/A"
    err_str = f" | {error}" if error else ""
    print(f"  {color}[{status}]{RESET} {label:<45} {time_str:>8}{err_str}")

# ============================================================
# Test 1: Single-request baseline tests
# ============================================================
def test_baseline():
    print_header("TEST 1: Baseline Single-Request Tests")
    
    tests = [
        ("Health Check", "/api/health", "GET", None),
        ("Login Page", "/", "GET", None),
        ("Emergency Backup Page", "/emergency-backup.html", "GET", None),
    ]
    
    results = []
    for name, path, method, data in tests:
        url = BASE_URL + path
        try:
            start = time.time()
            if method == "GET":
                r = requests.get(url, timeout=15)
            else:
                r = requests.post(url, json=data, timeout=15, headers={"Content-Type": "application/json"})
            elapsed = time.time() - start
            
            if r.status_code == 200:
                print_result(name, "PASS", elapsed)
                results.append((name, True, elapsed))
            else:
                print_result(name, "FAIL", elapsed, f"HTTP {r.status_code}")
                results.append((name, False, elapsed))
        except Exception as e:
            print_result(name, "FAIL", None, str(e)[:50])
            results.append((name, False, 0))
    
    return results

# ============================================================
# Test 2: API endpoint tests (POST requests)
# ============================================================
def test_api_endpoints():
    print_header("TEST 2: API Endpoint Tests")
    
    api_tests = [
        ("Login (invalid creds)", "/api/auth", {
            "action": "login",
            "email": "test@nonexistent.com",
            "password": "wrongpassword"
        }),
        ("Register Send OTP (bypass)", "/api/auth", {
            "action": "register-send-otp",
            "name": "Stress Test",
            "email": f"stresstest{int(time.time())}@test.com",
            "password": "test123456",
            "businessName": "Stress Test Co",
            "businessAddress": "Test Address",
            "businessPhone": "9999999999",
            "businessGst": ""
        }),
        ("Send OTP (nonexistent user)", "/api/auth", {
            "action": "send-otp",
            "identifier": "nonexistent@test.com"
        }),
        ("Restore (no data)", "/api/backup/restore", {
            "email": "admin@bizbook.pro",
            "password": "admin123"
        }),
        ("Emergency Backup (no auth)", "/api/backup/emergency", {
            "email": "",
            "password": ""
        }),
    ]
    
    results = []
    for name, path, data in api_tests:
        url = BASE_URL + path
        try:
            start = time.time()
            r = requests.post(url, json=data, timeout=30, headers={"Content-Type": "application/json"})
            elapsed = time.time() - start
            
            # These endpoints are expected to return 4xx (client error) not 5xx
            if r.status_code < 500:
                print_result(name, "PASS", elapsed, f"HTTP {r.status_code}")
                results.append((name, True, elapsed))
            else:
                print_result(name, "FAIL", elapsed, f"HTTP {r.status_code}")
                results.append((name, False, elapsed))
        except Exception as e:
            print_result(name, "FAIL", None, str(e)[:50])
            results.append((name, False, 0))
    
    return results

# ============================================================
# Test 3: Concurrent load test
# ============================================================
def test_concurrent_load(concurrent_users, num_requests):
    print_header(f"TEST 3: Concurrent Load Test ({concurrent_users} users, {num_requests} requests)")
    
    def make_request(req_id):
        try:
            start = time.time()
            r = requests.get(f"{BASE_URL}/api/health", timeout=15)
            elapsed = time.time() - start
            return (r.status_code, elapsed, None)
        except Exception as e:
            return (0, 0, str(e)[:50])
    
    print(f"  Sending {num_requests} requests with {concurrent_users} concurrent workers...")
    
    start_time = time.time()
    results = []
    
    with ThreadPoolExecutor(max_workers=concurrent_users) as executor:
        futures = [executor.submit(make_request, i) for i in range(num_requests)]
        for future in as_completed(futures):
            results.append(future.result())
    
    total_time = time.time() - start_time
    
    # Analyze results
    success_count = sum(1 for r in results if r[0] == 200)
    fail_count = sum(1 for r in results if r[0] != 200)
    response_times = [r[1] for r in results if r[1] > 0]
    
    if response_times:
        avg_time = sum(response_times) / len(response_times)
        min_time = min(response_times)
        max_time = max(response_times)
        # 95th percentile
        sorted_times = sorted(response_times)
        p95_idx = int(len(sorted_times) * 0.95)
        p95_time = sorted_times[p95_idx] if p95_idx < len(sorted_times) else sorted_times[-1]
    else:
        avg_time = min_time = max_time = p95_time = 0
    
    requests_per_sec = num_requests / total_time if total_time > 0 else 0
    success_rate = (success_count / num_requests) * 100 if num_requests > 0 else 0
    
    print(f"\n  {BOLD}Results:{RESET}")
    print(f"  {'Total requests:':<25} {num_requests}")
    print(f"  {'Successful:':<25} {GREEN}{success_count}{RESET}")
    print(f"  {'Failed:':<25} {RED}{fail_count}{RESET}")
    print(f"  {'Success rate:':<25} {GREEN if success_rate >= 95 else RED}{success_rate:.1f}%{RESET}")
    print(f"  {'Total time:':<25} {total_time:.2f}s")
    print(f"  {'Requests/sec:':<25} {requests_per_sec:.1f}")
    print(f"  {'Avg response time:':<25} {avg_time:.3f}s")
    print(f"  {'Min response time:':<25} {min_time:.3f}s")
    print(f"  {'Max response time:':<25} {max_time:.3f}s")
    print(f"  {'95th percentile:':<25} {p95_time:.3f}s")
    
    # Errors breakdown
    if fail_count > 0:
        errors = defaultdict(int)
        for r in results:
            if r[0] != 200:
                errors[r[2] or f"HTTP {r[0]}"] += 1
        print(f"\n  {RED}Error breakdown:{RESET}")
        for err, count in errors.items():
            print(f"    {err}: {count}")
    
    return success_rate >= 95

# ============================================================
# Test 4: Sustained load (stress test)
# ============================================================
def test_sustained_load(duration_seconds, concurrent_users):
    print_header(f"TEST 4: Sustained Load Test ({duration_seconds}s, {concurrent_users} users)")
    
    stop_time = time.time() + duration_seconds
    request_count = 0
    success_count = 0
    fail_count = 0
    response_times = []
    errors = defaultdict(int)
    
    def worker():
        nonlocal request_count, success_count, fail_count
        while time.time() < stop_time:
            try:
                start = time.time()
                r = requests.get(f"{BASE_URL}/api/health", timeout=15)
                elapsed = time.time() - start
                response_times.append(elapsed)
                request_count += 1
                if r.status_code == 200:
                    success_count += 1
                else:
                    fail_count += 1
                    errors[f"HTTP {r.status_code}"] += 1
            except Exception as e:
                request_count += 1
                fail_count += 1
                errors[str(e)[:50]] += 1
    
    print(f"  Running sustained load for {duration_seconds}s with {concurrent_users} workers...")
    
    threads = [threading.Thread(target=worker) for _ in range(concurrent_users)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    
    total_actual_time = duration_seconds
    
    if response_times:
        avg_time = sum(response_times) / len(response_times)
        min_time = min(response_times)
        max_time = max(response_times)
        sorted_times = sorted(response_times)
        p95_idx = int(len(sorted_times) * 0.95)
        p95_time = sorted_times[p95_idx] if p95_idx < len(sorted_times) else sorted_times[-1]
    else:
        avg_time = min_time = max_time = p95_time = 0
    
    rps = request_count / total_actual_time if total_actual_time > 0 else 0
    success_rate = (success_count / request_count * 100) if request_count > 0 else 0
    
    print(f"\n  {BOLD}Results:{RESET}")
    print(f"  {'Duration:':<25} {duration_seconds}s")
    print(f"  {'Total requests:':<25} {request_count}")
    print(f"  {'Successful:':<25} {GREEN}{success_count}{RESET}")
    print(f"  {'Failed:':<25} {RED}{fail_count}{RESET}")
    print(f"  {'Success rate:':<25} {GREEN if success_rate >= 95 else RED}{success_rate:.1f}%{RESET}")
    print(f"  {'Requests/sec:':<25} {rps:.1f}")
    print(f"  {'Avg response time:':<25} {avg_time:.3f}s")
    print(f"  {'Min response time:':<25} {min_time:.3f}s")
    print(f"  {'Max response time:':<25} {max_time:.3f}s")
    print(f"  {'95th percentile:':<25} {p95_time:.3f}s")
    
    if errors:
        print(f"\n  {RED}Error breakdown:{RESET}")
        for err, count in sorted(errors.items(), key=lambda x: -x[1]):
            print(f"    {err}: {count}")
    
    return success_rate >= 95

# ============================================================
# Test 5: Login flow stress test
# ============================================================
def test_login_stress(num_requests):
    print_header(f"TEST 5: Login Flow Stress Test ({num_requests} login attempts)")
    
    def attempt_login(req_id):
        try:
            start = time.time()
            r = requests.post(
                f"{BASE_URL}/api/auth",
                json={
                    "action": "login",
                    "email": "admin@bizbook.pro",
                    "password": "wrongpassword"  # Intentionally wrong
                },
                timeout=15,
                headers={"Content-Type": "application/json"}
            )
            elapsed = time.time() - start
            return (r.status_code, elapsed, None)
        except Exception as e:
            return (0, 0, str(e)[:50])
    
    print(f"  Sending {num_requests} login requests (10 concurrent)...")
    
    start_time = time.time()
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(attempt_login, i) for i in range(num_requests)]
        results = [f.result() for f in as_completed(futures)]
    total_time = time.time() - start_time
    
    # Login should return 401 (invalid credentials) not 500 (server error)
    expected_401 = sum(1 for r in results if r[0] == 401)
    server_errors = sum(1 for r in results if r[0] >= 500)
    other = sum(1 for r in results if r[0] not in [401, 429])
    rate_limited = sum(1 for r in results if r[0] == 429)
    
    response_times = [r[1] for r in results if r[1] > 0]
    avg_time = sum(response_times) / len(response_times) if response_times else 0
    
    print(f"\n  {BOLD}Results:{RESET}")
    print(f"  {'Total login attempts:':<30} {num_requests}")
    print(f"  {'Returned 401 (expected):':<30} {GREEN}{expected_401}{RESET}")
    print(f"  {'Rate limited (429):':<30} {YELLOW}{rate_limited}{RESET}")
    print(f"  {'Server errors (5xx):':<30} {RED}{server_errors}{RESET}")
    print(f"  {'Other:':<30} {other}")
    print(f"  {'Total time:':<30} {total_time:.2f}s")
    print(f"  {'Avg response time:':<30} {avg_time:.3f}s")
    
    # PASS if no server errors (401 and 429 are both acceptable)
    return server_errors == 0

# ============================================================
# Test 6: Register OTP bypass test
# ============================================================
def test_register_otp_bypass():
    print_header("TEST 6: Register OTP Bypass Test")
    
    email = f"stresstest{int(time.time())}@test.com"
    
    print(f"  Testing registration with email: {email}")
    print(f"  (OTP bypass should return the OTP directly since email/SMS not configured)")
    
    try:
        start = time.time()
        r = requests.post(
            f"{BASE_URL}/api/auth",
            json={
                "action": "register-send-otp",
                "name": "Stress Test User",
                "email": email,
                "password": "test123456",
                "businessName": "Stress Test Co",
                "businessAddress": "Test Address",
                "businessPhone": "9999999999",
                "businessGst": ""
            },
            timeout=30,
            headers={"Content-Type": "application/json"}
        )
        elapsed = time.time() - start
        data = r.json()
        
        print(f"\n  {BOLD}Response:{RESET}")
        print(f"  {'HTTP Status:':<25} {r.status_code}")
        print(f"  {'Response time:':<25} {elapsed:.3f}s")
        print(f"  {'sent:':<25} {data.get('sent', 'N/A')}")
        print(f"  {'otpBypass:':<25} {data.get('otpBypass', 'N/A')}")
        print(f"  {'devOtp:':<25} {data.get('devOtp', 'N/A')}")
        print(f"  {'message:':<25} {data.get('message', 'N/A')[:60]}")
        
        if data.get("otpBypass") and data.get("devOtp"):
            print_result("OTP Bypass Working", "PASS", elapsed)
            return True
        elif data.get("sent"):
            print_result("OTP Sent (email/SMS configured)", "PASS", elapsed)
            return True
        else:
            print_result("OTP Bypass Test", "FAIL", elapsed, data.get("error", "Unknown"))
            return False
    except Exception as e:
        print_result("OTP Bypass Test", "FAIL", None, str(e)[:50])
        return False

# ============================================================
# Main
# ============================================================
def main():
    print_header("BIZBOOK PRO — STRESS TEST & LOAD TEST")
    print(f"  Target: {BASE_URL}")
    print(f"  Time: {time.strftime('%Y-%m-%d %H:%M:%S UTC')}")
    print(f"  Version: v4.120")
    
    all_passed = True
    
    # Test 1: Baseline
    results = test_baseline()
    if not all(r[1] for r in results):
        all_passed = False
    
    # Test 2: API endpoints
    results = test_api_endpoints()
    if not all(r[1] for r in results):
        all_passed = False
    
    # Test 3: Concurrent load — 10 users, 50 requests
    if not test_concurrent_load(10, 50):
        all_passed = False
    
    # Test 3b: Concurrent load — 20 users, 100 requests
    if not test_concurrent_load(20, 100):
        all_passed = False
    
    # Test 4: Sustained load — 15 seconds, 15 concurrent
    if not test_sustained_load(15, 15):
        all_passed = False
    
    # Test 5: Login stress — 30 login attempts
    if not test_login_stress(30):
        all_passed = False
    
    # Test 6: Register OTP bypass
    if not test_register_otp_bypass():
        all_passed = False
    
    # Final summary
    print_header("STRESS TEST SUMMARY")
    if all_passed:
        print(f"  {GREEN}{BOLD}✅ ALL TESTS PASSED{RESET}")
        print(f"  The application is handling load correctly.")
        print(f"  No server errors detected.")
        print(f"  OTP bypass is working for registration.")
    else:
        print(f"  {RED}{BOLD}❌ SOME TESTS FAILED{RESET}")
        print(f"  Review the results above for details.")
    
    print(f"\n  Test completed at: {time.strftime('%Y-%m-%d %H:%M:%S UTC')}")

if __name__ == "__main__":
    main()
