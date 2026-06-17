# ============================================================
# BizBook Pro — PM2 Ecosystem Configuration
# ============================================================
// This file is portable: it resolves all paths relative to the
// project directory, so it works on any server without edits.
// ============================================================

const path = require('path');
const projectDir = __dirname;

module.exports = {
  apps: [{
    name: 'bizbook-pro',
    script: path.join(projectDir, '.next/standalone/server.js'),
    instances: 'max',          // Use all CPU cores (or set to a number like 4)
    exec_mode: 'cluster',
    max_memory_restart: '750M',
    max_restarts: 30,
    min_uptime: '10s',
    restart_delay: 4000,
    kill_timeout: 10000,
    listen_timeout: 30000,
    env: {
      NODE_ENV: 'production',
      HOSTNAME: '0.0.0.0',
      PORT: 3000,
      UV_THREADPOOL_SIZE: 32,
      NODE_OPTIONS: '--max-old-space-size=768',
      DATABASE_URL: `file:${path.join(projectDir, 'db/custom.db')}`,
      NEXT_TELEMETRY_DISABLED: 1,
    },
    error_file: path.join(projectDir, 'logs/pm2-error.log'),
    out_file: path.join(projectDir, 'logs/pm2-out.log'),
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    watch: false,
    shutdown_with_message: true,
  }],
};
