import nodemailer from 'nodemailer'

// Check if SMTP is configured
export function isEmailConfigured(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS)
}

// Create a transporter using SMTP settings
function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  })
}

// Send OTP email
export async function sendOtpEmail(email: string, otp: string, userName?: string): Promise<{ success: boolean; error?: string }> {
  if (!isEmailConfigured()) {
    return { success: false, error: 'SMTP_NOT_CONFIGURED' }
  }

  try {
    const transporter = createTransporter()

    const mailOptions = {
      from: process.env.EMAIL_FROM || '"BizBook Pro" <noreply@bizbookpro.com>',
      to: email,
      subject: 'BizBook Pro - Password Reset OTP',
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 480px; margin: 0 auto; background: #f9fafb; border-radius: 12px; overflow: hidden;">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #059669 0%, #047857 100%); padding: 28px 32px; text-align: center;">
            <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">BizBook Pro</h1>
            <p style="margin: 6px 0 0 0; color: #d1fae5; font-size: 14px;">Password Reset Verification</p>
          </div>
          
          <!-- Body -->
          <div style="padding: 32px;">
            <p style="margin: 0 0 8px 0; font-size: 16px; color: #111827;">Hello${userName ? ` ${userName}` : ''},</p>
            <p style="margin: 0 0 24px 0; font-size: 14px; color: #6b7280; line-height: 1.6;">
              We received a request to reset your password. Use the OTP below to verify your identity and set a new password.
            </p>
            
            <!-- OTP Box -->
            <div style="background: #ecfdf5; border: 2px dashed #059669; border-radius: 10px; padding: 20px; text-align: center; margin: 0 0 24px 0;">
              <p style="margin: 0 0 8px 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px;">Your One-Time Password</p>
              <p style="margin: 0; font-size: 36px; font-weight: 800; color: #059669; letter-spacing: 8px; font-family: 'Courier New', monospace;">${otp}</p>
            </div>
            
            <!-- Expiry Warning -->
            <div style="background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 6px; padding: 12px 16px; margin: 0 0 24px 0;">
              <p style="margin: 0; font-size: 13px; color: #92400e;">
                <strong>⏱ This OTP expires in 5 minutes.</strong> If it expires, please request a new one.
              </p>
            </div>
            
            <p style="margin: 0 0 8px 0; font-size: 13px; color: #6b7280; line-height: 1.6;">
              If you did not request a password reset, please ignore this email. Your account is safe and no changes have been made.
            </p>
          </div>
          
          <!-- Footer -->
          <div style="background: #f3f4f6; padding: 16px 32px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0; font-size: 12px; color: #9ca3af;">
              This is an automated message from BizBook Pro. Please do not reply to this email.
            </p>
          </div>
        </div>
      `,
    }

    const info = await transporter.sendMail(mailOptions)
    console.log(`OTP email sent to ${email}: ${info.messageId}`)
    return { success: true }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    console.error('Failed to send OTP email:', errMsg)
    return { success: false, error: errMsg }
  }
}
