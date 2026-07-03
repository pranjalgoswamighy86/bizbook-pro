// Test sending to different recipients to see if it's a recipient-side issue
process.env.SMTP_USER = 'pranjalgoswamighy86@gmail.com'
process.env.SMTP_PASS = 'aeah qokp ycyn kcgk'

async function test() {
  const nodemailer = require('nodemailer')
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: 'pranjalgoswamighy86@gmail.com',
      pass: 'aeah qokp ycyn kcgk',
    },
  })

  // Test 1: Send to self (Gmail → Gmail, same account)
  console.log('[TEST 1] Sending to self (pranjalgoswamighy86@gmail.com)...')
  try {
    const info = await transporter.sendMail({
      from: '"BizBook Pro OTP Test" <pranjalgoswamighy86@gmail.com>',
      to: 'pranjalgoswamighy86@gmail.com',
      subject: '[TEST 1] OTP Email Test — To Self',
      text: 'This is test 1: Gmail → Gmail (same account). OTP would be: 123456',
      html: '<p>This is <strong>test 1</strong>: Gmail → Gmail (same account).</p><p>OTP would be: <strong>123456</strong></p>',
    })
    console.log('[TEST 1] ✅ Sent! Message ID:', info.messageId)
  } catch (err) {
    console.error('[TEST 1] ❌ Failed:', err.message)
  }

  // Test 2: Send with subject "Your OTP" (typical OTP subject)
  console.log('\n[TEST 2] Sending with OTP-style subject...')
  try {
    const info = await transporter.sendMail({
      from: '"BizBook Pro" <pranjalgoswamighy86@gmail.com>',
      to: 'pranjalgoswamighy86@gmail.com',
      subject: 'Your Verification OTP — 847293',
      text: 'Your BizBook Pro verification code is: 847293\n\nThis code expires in 5 minutes.',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #059669;">BizBook Pro — Your Verification Code</h2>
          <p>Your verification code is:</p>
          <p style="font-size: 32px; font-weight: bold; color: #059669; letter-spacing: 8px;">847293</p>
          <p>This code expires in 5 minutes.</p>
        </div>
      `,
    })
    console.log('[TEST 2] ✅ Sent! Message ID:', info.messageId)
  } catch (err) {
    console.error('[TEST 2] ❌ Failed:', err.message)
  }

  console.log('\n=== CHECK YOUR GMAIL INBOX ===')
  console.log('Look for 2 emails:')
  console.log('  1. Subject: "[TEST 1] OTP Email Test — To Self"')
  console.log('  2. Subject: "Your Verification OTP — 847293"')
  console.log('If both arrive, SMTP works → issue is on Railway side')
  console.log('If neither arrives, Gmail is filtering your emails → check Spam, All Mail, Updates tabs')
}
test()
