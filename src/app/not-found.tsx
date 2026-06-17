'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Home, ArrowLeft, Search, BookOpen } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
      <Card className="w-full max-w-lg border-0 shadow-xl">
        <CardContent className="p-0">
          {/* Header with gradient */}
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-t-lg px-8 py-10 text-center text-white">
            <div className="mb-4 flex justify-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
                <BookOpen className="h-10 w-10 text-white" />
              </div>
            </div>
            <h1 className="text-6xl font-bold tracking-tight">404</h1>
            <p className="mt-2 text-lg text-blue-100">Page Not Found</p>
          </div>

          {/* Body */}
          <div className="px-8 py-8 text-center space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                Oops! This page doesn&apos;t exist
              </h2>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                The page you&apos;re looking for might have been moved, deleted, or never existed.
                Don&apos;t worry — let&apos;s get you back on track.
              </p>
            </div>

            {/* Quick navigation options */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={() => window.location.href = '/'}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
              >
                <Home className="mr-2 h-4 w-4" />
                Go to Dashboard
              </Button>
              <Button
                onClick={() => window.history.back()}
                variant="outline"
                className="w-full"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Go Back
              </Button>
            </div>

            {/* Helpful links */}
            <div className="rounded-lg border bg-muted/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Search className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">Quick Access</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-left">
                {[
                  { label: 'Sale Register', path: '/' },
                  { label: 'Purchase Register', path: '/' },
                  { label: 'Inventory', path: '/' },
                  { label: 'GST Reports', path: '/' },
                  { label: 'Day Report', path: '/' },
                  { label: 'Staff & Salary', path: '/' },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={() => window.location.href = item.path}
                    className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline text-left transition-colors"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              BizBook Pro &mdash; Simple Business Management
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
