// ============================================================
// BizBook Pro — PM2 Ecosystem Configuration (v6.23.0)
// ============================================================
// v6.23.0 FIX: Changed from cluster mode to fork mode.
//
// ROOT CAUSE of PM2 failure (v4.56–v6.22.3):
//   PM2 cluster mode requires the server to use Node.js's cluster
//   API (cluster.isMaster + worker.listen()). Next.js standalone
//   server.js uses http.createServer() which binds to a specific
//   port directly — incompatible with PM2's IPC-based port sharing.
//   This caused PM2.start() to fail silently on every container
//   startup, falling back to direct server.js (single instance).
//
// FIX:
//   Switch to fork mode with 1 instance. Fork mode spawns a single
//   child process — no cluster IPC, no port sharing. This works
//   correctly with Next.js standalone server.js.
//
//   Railway provides container-level scaling (multiple containers),
//   so PM2 cluster mode within a single container is redundant.
//   If you need more capacity, upgrade the Railway plan or add
//   more replicas via Railway's service settings.
//
// Memory: ~200MB (fits in Railway 512MB)
// ============================================================

const path = require('path');
const projectDir = __dirname;

module.exports = {
  apps: [{
    name: 'bizbook-pro',
    script: path.join(projectDir, '.next/standalone/server.js'),
    instances: 1,              // v6.23.0: 1 instance (fork mode)
    exec_mode: 'fork',         // v6.23.0: fork mode (was: cluster)
    max_memory_restart: '400M',
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
      NODE_OPTIONS: '--max-old-space-size=384',
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
