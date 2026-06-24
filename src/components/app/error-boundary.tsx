'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Loader2 } from 'lucide-react'

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  isReloading: boolean
  reloadAttempts: number
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, isReloading: false, reloadAttempts: 0 }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, isReloading: false, reloadAttempts: 0 }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)

    // v4.94: Auto-reload on chunk load errors (stale cache after deploy)
    const isChunkError =
      error.message?.includes('Failed to load chunk') ||
      error.message?.includes('Loading chunk') ||
      error.message?.includes('Loading CSS chunk') ||
      error.name === 'ChunkLoadError'

    if (isChunkError && this.state.reloadAttempts < 2) {
      // Automatically reload the page to fetch fresh chunks from the new deploy
      this.setState({ isReloading: true, reloadAttempts: this.state.reloadAttempts + 1 })
      setTimeout(() => {
        window.location.reload()
      }, 1500)
    }
  }

  handleManualReload = () => {
    this.setState({ isReloading: true })
    const w = window as any
    // Clear all caches then reload
    if (w && 'caches' in w) {
      w.caches.keys().then((names: string[]) => {
        Promise.all(names.map((name: string) => w.caches.delete(name))).then(() => {
          w.location.reload()
        })
      })
    } else if (w) {
      w.location.reload()
    }
  }

  render() {
    if (this.state.hasError) {
      // v4.94: If this is a chunk load error, show auto-reloading state
      const isChunkError =
        this.state.error?.message?.includes('Failed to load chunk') ||
        this.state.error?.message?.includes('Loading chunk') ||
        this.state.error?.name === 'ChunkLoadError'

      if (isChunkError && this.state.isReloading) {
        return (
          <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 gap-4">
            <Loader2 className="h-12 w-12 text-emerald-500 animate-spin" />
            <h2 className="text-lg font-semibold">Updating BizBook Pro...</h2>
            <p className="text-sm text-muted-foreground max-w-md text-center">
              A new version was deployed. Refreshing your browser to load the latest version...
            </p>
          </div>
        )
      }

      if (this.props.fallback) {
        return this.props.fallback
      }
      return (
        <div className="flex flex-col items-center justify-center p-8 gap-4">
          <AlertTriangle className="h-12 w-12 text-amber-500" />
          <h2 className="text-lg font-semibold">Something went wrong</h2>
          <p className="text-sm text-muted-foreground max-w-md text-center">
            {this.state.error?.message || 'An unexpected error occurred. Please try again.'}
          </p>
          {isChunkError && (
            <p className="text-xs text-blue-600 max-w-md text-center">
              This usually happens after a new update. Click below to refresh and load the latest version.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              onClick={() => this.setState({ hasError: false, error: null })}
              variant="outline"
            >
              Try Again
            </Button>
            <Button
              onClick={this.handleManualReload}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              Refresh Page
            </Button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
