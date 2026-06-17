'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [cleared, setCleared] = useState(false)

  useEffect(() => {
    console.error('[BizBook Pro] Client error:', error)
  }, [error])

  const handleClearData = () => {
    // Clear persisted Zustand state and reload
    localStorage.removeItem('bizbook-auth')
    setCleared(true)
    setTimeout(() => {
      window.location.href = '/'
    }, 1000)
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle className="text-xl">Something went wrong</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">
            An unexpected error occurred in BizBook Pro. This has been logged for review.
          </p>
          {error.message && (
            <details className="text-left text-xs text-muted-foreground bg-muted p-2 rounded">
              <summary className="cursor-pointer font-medium">Error details</summary>
              <pre className="mt-1 whitespace-pre-wrap break-all">{error.message}</pre>
            </details>
          )}
          {cleared ? (
            <p className="text-sm text-emerald-600 font-medium">Data cleared. Redirecting to login...</p>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2 justify-center">
                <Button onClick={reset} variant="default">
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Try Again
                </Button>
                <Button onClick={() => window.location.href = '/'} variant="outline">
                  Go to Home
                </Button>
              </div>
              <Button onClick={handleClearData} variant="destructive" size="sm" className="mt-2">
                <Trash2 className="mr-2 h-4 w-4" />
                Clear Session & Re-login
              </Button>
              <p className="text-xs text-muted-foreground">
                If the error persists, click &quot;Clear Session&quot; to reset and log in again.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
