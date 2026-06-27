// ============================================================
// BizBook Pro — PM2 Ecosystem Configuration (v4.56)
// ============================================================
// PM2 cluster mode: spawns multiple Node.js processes that share
// the same port. Each process handles requests independently.
//
// With PostgreSQL, multiple writers are safe (unlike SQLite).
// 2 instances = 2x request handling capacity.
//
// Memory: 2 × ~200MB = ~400MB (fits in Railway Hobby 512MB)
// CPU: 2 instances use 2 CPU cores (Railway Hobby has shared CPU)
// ============================================================

const path = require('path');
const projectDir = __dirname;

module.exports = {
  apps: [{
    name: 'bizbook-pro',
    script: path.join(projectDir, '.next/standalone/server.js'),
    instances: 2,              // v4.56: 2 instances (safe for 512MB RAM)
    exec_mode: 'cluster',      // Cluster mode = shared port, load balanced
    max_memory_restart: '300M',
    max_restarts: 30,
    min_uptime: '10s',
    restart_delay: 4000,
    kill_timeout: 10000,
    listen_timeout: 30000,
    env: {
      NODE_ENV: 'production',
      HOSTNAME: '0.0.0.0',
      PORT: process.env.PORT || 8080,
      UV_THREADPOOL_SIZE: 32,
      NODE_OPTIONS: '--max-old-space-size=256',
      DATABASE_URL: process.env.DATABASE_URL,
      NEXT_TELEMETRY_DISABLED: 1,
      // Pass through all Railway env vars
      ...(process.env.BREVO_API_KEY ? { BREVO_API_KEY: process.env.BREVO_API_KEY } : {}),
      ...(process.env.BREVO_FROM_EMAIL ? { BREVO_FROM_EMAIL: process.env.BREVO_FROM_EMAIL } : {}),
      ...(process.env.BREVO_FROM_NAME ? { BREVO_FROM_NAME: process.env.BREVO_FROM_NAME } : {}),
      ...(process.env.RESEND_API_KEY ? { RESEND_API_KEY: process.env.RESEND_API_KEY } : {}),
      ...(process.env.SESSION_SECRET ? { SESSION_SECRET: process.env.SESSION_SECRET } : {}),
      ...(process.env.MASTER_MOBILE_NUMBER ? { MASTER_MOBILE_NUMBER: process.env.MASTER_MOBILE_NUMBER } : {}),
      ...(process.env.ADMIN_EMAIL ? { ADMIN_EMAIL: process.env.ADMIN_EMAIL } : {}),
      ...(process.env.NEXT_PUBLIC_SUPER_ADMIN_UPI_ID ? { NEXT_PUBLIC_SUPER_ADMIN_UPI_ID: process.env.NEXT_PUBLIC_SUPER_ADMIN_UPI_ID } : {}),
      ...(process.env.MASTER_UPI_VPA ? { MASTER_UPI_VPA: process.env.MASTER_UPI_VPA } : {}),
      ...(process.env.MASTER_UPI_NAME ? { MASTER_UPI_NAME: process.env.MASTER_UPI_NAME } : {}),
      ...(process.env.CRON_SECRET ? { CRON_SECRET: process.env.CRON_SECRET } : {}),
      ...(process.env.SMS_WEBHOOK_SECRET ? { SMS_WEBHOOK_SECRET: process.env.SMS_WEBHOOK_SECRET } : {}),
      ...(process.env.AUTO_ALERT_EMAIL_USER ? { AUTO_ALERT_EMAIL_USER: process.env.AUTO_ALERT_EMAIL_USER } : {}),
      ...(process.env.AUTO_ALERT_EMAIL_PASSWORD ? { AUTO_ALERT_EMAIL_PASSWORD: process.env.AUTO_ALERT_EMAIL_PASSWORD } : {}),
      ...(process.env.ZAI_BASE_URL ? { ZAI_BASE_URL: process.env.ZAI_BASE_URL } : {}),
      ...(process.env.ZAI_API_KEY ? { ZAI_API_KEY: process.env.ZAI_API_KEY } : {}),
    },
    error_file: path.join(projectDir, 'logs/pm2-error.log'),
    out_file: path.join(projectDir, 'logs/pm2-out.log'),
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    watch: false,
    shutdown_with_message: true,
  }],
};
