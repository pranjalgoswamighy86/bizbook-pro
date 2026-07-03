// Test SMTP credentials before adding to Railway
process.env.SMTP_USER = 'pranjalgoswamighy86@gmail.com'
process.env.SMTP_PASS = 'aeah qokp ycyn kcgk'
process.env.SMTP_HOST = 'smtp.gmail.com'
process.env.SMTP_PORT = '587'
process.env.SMTP_SECURE = 'false'

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
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  })

  console.log('[TEST] Verifying SMTP connection...')
  try {
    await transporter.verify()
    console.log('[TEST] ✅ SMTP connection VERIFIED — credentials are valid!')
    console.log('[TEST] Sending test email to verify delivery...')

    const info = await transporter.sendMail({
      from: '"BizBook Pro" <pranjalgoswamighy86@gmail.com>',
      to: 'pranjalgoswamighy86@gmail.com',  // send to self for testing
      subject: 'BizBook Pro — SMTP Test (credentials verified)',
      text: 'This is a test email from BizBook Pro. If you received this, your SMTP credentials work correctly!',
      html: '<p>This is a test email from <strong>BizBook Pro</strong>.</p><p>If you received this, your SMTP credentials work correctly!</p>',
    })

    console.log('[TEST] ✅ Test email SENT successfully!')
    console.log('[TEST] Message ID:', info.messageId)
    console.log('[TEST] Response:', info.response)
    console.log('')
    console.log('[TEST] Check your Gmail inbox (pranjalgoswamighy86@gmail.com) for the test email.')
    console.log('[TEST] If it arrived, your OTP emails will work!')
  } catch (err) {
    console.error('[TEST] ❌ SMTP test FAILED:')
    console.error('         Error:', err.message)
    console.error('         Code:', err.code)
    if (err.code === 'EAUTH') {
      console.error('')
      console.error('         → This means the App Password is wrong or 2FA is not enabled.')
      console.error('         → Go to https://myaccount.google.com/apppasswords and create a new one.')
    }
  }
}

test()
