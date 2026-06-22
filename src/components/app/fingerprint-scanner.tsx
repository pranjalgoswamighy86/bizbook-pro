'use client'

/**
 * Fingerprint Scanner Component (v4.67)
 * ======================================
 * Uses WebAuthn API for biometric authentication.
 * Works with: Touch ID (Mac), Windows Hello, Android fingerprint.
 *
 * In Staff module:
 *   - MAIN_ADMIN can register a staff member's fingerprint
 *   - Staff can login with fingerprint instead of password
 *
 * Requirements:
 *   - HTTPS (Railway provides this)
 *   - Browser with WebAuthn support (Chrome, Edge, Safari, Firefox)
 *   - Device with biometric sensor (Touch ID, Windows Hello, etc.)
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Fingerprint, Check, X, Loader2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface FingerprintScannerProps {
  userId?: string
  userEmail?: string
  onRegistered?: (credentialId: string) => void
  buttonText?: string
}

export function FingerprintScanner({ userId, userEmail, onRegistered, buttonText = 'Register Fingerprint' }: FingerprintScannerProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [registered, setRegistered] = useState(false)

  const isSupported = typeof window !== 'undefined' && 'PublicKeyCredential' in window

  const registerFingerprint = async () => {
    if (!isSupported) {
      toast({
        title: 'Not Supported',
        description: 'Your browser or device does not support biometric authentication.',
        variant: 'destructive',
      })
      return
    }

    setLoading(true)
    try {
      // Create a new credential
      const publicKey: PublicKeyCredentialCreationOptions = {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: {
          name: 'BizBook Pro',
          // rpId will be set by browser based on current domain
        },
        user: {
          id: new TextEncoder().encode(userId || userEmail || 'unknown'),
          name: userEmail || 'staff',
          displayName: userEmail || 'Staff Member',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },   // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform', // built-in biometric
          userVerification: 'required',        // require fingerprint/Face ID
        },
        timeout: 60000,
        attestation: 'none',
      }

      const credential = await navigator.credentials.create({ publicKey }) as PublicKeyCredential

      if (credential) {
        const credentialId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)))
        console.log('[FINGERPRINT] Registered credential:', credentialId)
        setRegistered(true)
        onRegistered?.(credentialId)
        toast({
          title: '✅ Fingerprint Registered',
          description: 'Staff can now login with fingerprint on this device.',
          duration: 5000,
        })
      }
    } catch (err: any) {
      console.error('[FINGERPRINT] Error:', err)
      if (err.name === 'NotAllowedError') {
        toast({
          title: 'Cancelled',
          description: 'Fingerprint registration was cancelled.',
          variant: 'destructive',
        })
      } else {
        toast({
          title: 'Registration Failed',
          description: err?.message || 'Could not register fingerprint.',
          variant: 'destructive',
        })
      }
    } finally {
      setLoading(false)
    }
  }

  if (!isSupported) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <X className="h-4 w-4 text-rose-400" />
        Biometric auth not supported on this device
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant={registered ? 'outline' : 'default'}
        size="sm"
        onClick={registerFingerprint}
        disabled={loading || registered}
        className="gap-1.5 text-xs"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : registered ? (
          <Check className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <Fingerprint className="h-3.5 w-3.5" />
        )}
        {registered ? 'Fingerprint Registered' : buttonText}
      </Button>
    </div>
  )
}
