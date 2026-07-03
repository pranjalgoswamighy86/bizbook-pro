// BizBook Pro Desktop Launcher
// This script launches the BizBook Pro web application in the default browser
// and connects to the main server: https://bizbook-pro-production.up.railway.app
// Compiled to .exe using pkg

const { exec } = require('child_process');
const https = require('https');

const SERVER_URL = 'https://bizbook-pro-production.up.railway.app';
const APP_NAME = 'BizBook Pro';
const VERSION = 'v4.88';
const COMPANY = 'Tahigo International';

console.log('============================================');
console.log(`  ${APP_NAME} Desktop Application`);
console.log(`  ${VERSION} - by ${COMPANY}`);
console.log('============================================');
console.log('');
console.log('Connecting to main server...');
console.log(`Server: ${SERVER_URL}`);
console.log('');

// Check if server is reachable
const req = https.get(SERVER_URL, (res) => {
  console.log(`Server status: ${res.statusCode === 200 ? 'ONLINE' : 'Status ' + res.statusCode}`);
  console.log('Launching application in browser...');
  console.log('');

  // Determine the platform and open the browser
  const platform = process.platform;
  let command;

  if (platform === 'win32') {
    // Windows: use 'start' command
    command = `start "" "${SERVER_URL}"`;
  } else if (platform === 'darwin') {
    // macOS: use 'open' command
    command = `open "${SERVER_URL}"`;
  } else {
    // Linux: use 'xdg-open' command
    command = `xdg-open "${SERVER_URL}"`;
  }

  exec(command, (error) => {
    if (error) {
      console.log('Could not open browser automatically.');
      console.log(`Please open your browser and go to: ${SERVER_URL}`);
    } else {
      console.log('Application launched successfully!');
      console.log('Your browser should now show BizBook Pro.');
    }
    console.log('');
    console.log('If the browser did not open, manually visit:');
    console.log(`  ${SERVER_URL}`);
    console.log('');
    console.log('Press Ctrl+C to exit this launcher.');
    console.log('(The application will continue running in your browser)');

    // Keep the process alive for a few seconds so the user sees the message
    setTimeout(() => {
      process.exit(0);
    }, 5000);
  });
});

req.on('error', (error) => {
  console.log('WARNING: Could not verify server connection.');
  console.log(`Error: ${error.message}`);
  console.log('');
  console.log('Attempting to launch browser anyway...');
  console.log(`Please visit: ${SERVER_URL}`);
  console.log('');

  const platform = process.platform;
  let command;

  if (platform === 'win32') {
    command = `start "" "${SERVER_URL}"`;
  } else if (platform === 'darwin') {
    command = `open "${SERVER_URL}"`;
  } else {
    command = `xdg-open "${SERVER_URL}"`;
  }

  exec(command, () => {
    setTimeout(() => process.exit(0), 3000);
  });
});

req.setTimeout(5000, () => {
  req.destroy();
  console.log('Server check timed out. Launching browser anyway...');
  const platform = process.platform;
  let command;

  if (platform === 'win32') {
    command = `start "" "${SERVER_URL}"`;
  } else if (platform === 'darwin') {
    command = `open "${SERVER_URL}"`;
  } else {
    command = `xdg-open "${SERVER_URL}"`;
  }

  exec(command, () => {
    setTimeout(() => process.exit(0), 3000);
  });
});
