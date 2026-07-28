import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// v6.28.9: Re-export roundTo2 from gst-utils so any file importing from
// @/lib/utils also has access to it. This prevents ReferenceError crashes
// in reporting endpoints that might import utils but forget to import
// gst-utils separately.
//
// The canonical definition lives in src/lib/gst-utils.ts — this is just
// a re-export for convenience and safety.
export { roundTo2 } from '@/lib/gst-utils'
// Railway deploy trigger Wed Jun 17 12:47:06 UTC 2026
