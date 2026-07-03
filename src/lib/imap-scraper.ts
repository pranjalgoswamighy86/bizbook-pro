/**
 * IMAP Email Payment Automation Worker
 *
 * Per spec Section 3: "Real-Time Autonomous IMAP Inbox Processing Worker"
 *
 * This module connects to the super admin's bank alert email inbox via IMAP,
 * reads incoming credit notification emails, extracts the UPI payment amount
 * using regex, and matches it against pending SubscriptionQueue entries.
 *
 * When a match is found, the subscription is auto-activated atomically.
 *
 * The worker is designed to run on a cron loop (every 30 seconds) from the
 * railway-start.js startup script. It's safe to call repeatedly — each run
 * processes only UNSEEN emails and marks them as seen.
 *
 * Environment variables:
 *   AUTO_ALERT_EMAIL_USER     — Gmail address receiving bank alerts
 *   AUTO_ALERT_EMAIL_PASSWORD — Gmail App Password for that account
 *
 * If these are not set, the worker silently skips (no error).
 */

import { db } from '@/lib/db-soft-delete'

// We dynamically import imap + mailparser to avoid build issues
// (they're Node.js-only modules that don't work in edge/webpack tracing)

export async function runEmailPaymentAutomationListener(): Promise<void> {
  const emailUser = process.env.AUTO_ALERT_EMAIL_USER
  const emailPass = process.env.AUTO_ALERT_EMAIL_PASSWORD

  if (!emailUser || !emailPass) {
    // Silent skip — not configured
    return
  }

  console.log('[IMAP-SCRAPER] Starting email payment scan...')

  try {
    // Dynamic import (avoids webpack bundling issues)
    const Imap = (await import('imap')).default
    const { simpleParser } = await import('mailparser')

    return new Promise<void>((resolve) => {
      const imap = new Imap({
        user: emailUser,
        password: emailPass,
        host: 'imap.gmail.com',
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 10000,
        authTimeout: 5000,
      })

      imap.once('ready', () => {
        imap.openBox('INBOX', false, (err: Error | null) => {
          if (err) {
            console.error('[IMAP-SCRAPER] Failed to open INBOX:', err.message)
            imap.end()
            resolve()
            return
          }

          imap.search(['UNSEEN'], async (searchErr: Error | null, results: number[]) => {
            if (searchErr || !results || results.length === 0) {
              if (!searchErr) console.log('[IMAP-SCRAPER] No new emails to process')
              imap.end()
              resolve()
              return
            }

            console.log(`[IMAP-SCRAPER] Found ${results.length} new email(s) to scan`)

            const fetchStream = imap.fetch(results, { bodies: '', markSeen: true })
            const promises: Promise<void>[] = []

            fetchStream.on('message', (msg: any) => {
              const promise = new Promise<void>((resolveMsg) => {
                msg.on('body', (stream: any) => {
                  const chunks: Buffer[] = []
                  stream.on('data', (chunk: Buffer) => chunks.push(chunk))
                  stream.on('end', async () => {
                    try {
                      const buffer = Buffer.concat(chunks)
                      const parsed = await simpleParser(buffer)
                      const mailBodyText = parsed.text || ''

                      // Regex: match amounts like "Rs.499.12", "INR 499.12", "₹499.12"
                      // Also matches "credited with Rs. 150.37" etc.
                      const amountRegex = /(?:Rs\.?|INR|₹)\s?(\d+\.(\d{2}))/i
                      const match = mailBodyText.match(amountRegex)

                      if (match) {
                        const parsedAmount = parseFloat(match[1])
                        console.log(`[IMAP-SCRAPER] Found amount ₹${parsedAmount} in email: "${parsed.subject?.substring(0, 80) || 'no subject'}"`)

                        // Look for a matching PENDING queue entry
                        const pendingEntry = await db.subscriptionQueue.findFirst({
                          where: {
                            finalAmount: parsedAmount,
                            status: 'PENDING',
                          },
                        })

                        if (pendingEntry) {
                          console.log(`[IMAP-SCRAPER] ✅ MATCH FOUND! Queue ID: ${pendingEntry.id}, Tenant: ${pendingEntry.tenantId}, Plan: ${pendingEntry.planName}`)

                          // Atomic activation: mark queue as SUCCESS + update subscription
                          await db.$transaction([
                            db.subscriptionQueue.update({
                              where: { id: pendingEntry.id },
                              data: { status: 'SUCCESS', completedAt: new Date() },
                            }),
                            db.subscription.upsert({
                              where: { tenantId: pendingEntry.tenantId },
                              create: {
                                tenantId: pendingEntry.tenantId,
                                planHours: pendingEntry.planHours,
                                planName: pendingEntry.planName,
                                totalSeconds: pendingEntry.planHours * 3600,
                                remainingSeconds: pendingEntry.planHours * 3600,
                                status: 'ACTIVE',
                                isFreeTier: false,
                              },
                              update: {
                                planHours: pendingEntry.planHours,
                                planName: pendingEntry.planName,
                                totalSeconds: pendingEntry.planHours * 3600,
                                remainingSeconds: { increment: pendingEntry.planHours * 3600 },
                                status: 'ACTIVE',
                                isFreeTier: false,
                              },
                            }),
                          ])

                          // Record recharge
                          const sub = await db.subscription.findUnique({ where: { tenantId: pendingEntry.tenantId } })
                          if (sub) {
                            await db.recharge.create({
                              data: {
                                subscriptionId: sub.id,
                                planHours: pendingEntry.planHours,
                                planName: pendingEntry.planName,
                                mrp: pendingEntry.baseAmount,
                                discountPercent: 0,
                                discountAmount: pendingEntry.finalAmount,
                                totalSeconds: pendingEntry.planHours * 3600,
                                paymentMode: 'UPI_AUTO',
                                paymentRef: pendingEntry.id,
                                status: 'COMPLETED',
                              },
                            })
                          }

                          console.log(`[IMAP-SCRAPER] 🎉 Autonomous activation complete for tenant ${pendingEntry.tenantId} — ${pendingEntry.planName} activated!`)
                        } else {
                          console.log(`[IMAP-SCRAPER] No matching PENDING queue entry for ₹${parsedAmount} — may be a non-subscription payment`)
                        }
                      } else {
                        // Not a bank alert email — skip
                        console.log(`[IMAP-SCRAPER] No amount found in email: "${parsed.subject?.substring(0, 60) || 'no subject'}" — skipping`)
                      }
                    } catch (parseErr: any) {
                      console.error('[IMAP-SCRAPER] Email parse error:', parseErr.message)
                    }
                    resolveMsg()
                  })
                })
              })
              promises.push(promise)
            })

            fetchStream.once('end', () => {
              Promise.all(promises).then(() => {
                console.log('[IMAP-SCRAPER] Email scan complete')
                imap.end()
                resolve()
              })
            })
          })
        })
      })

      imap.once('error', (err: Error) => {
        console.error('[IMAP-SCRAPER] IMAP connection error:', err.message)
        resolve()
      })

      imap.once('end', () => {
        resolve()
      })

      imap.connect()
    })
  } catch (error: any) {
    console.error('[IMAP-SCRAPER] Failed to start:', error.message)
  }
}
