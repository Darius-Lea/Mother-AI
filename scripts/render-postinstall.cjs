'use strict';
// Existing Render services can retain their original `npm install` build command.
// Build the browser UI there, without launching or importing Electron.
if (process.env.RENDER === 'true') {
  const path = require('node:path');
  const fs = require('node:fs');
  const {spawnSync} = require('node:child_process');
  const vite = path.resolve(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(vite)) {
    console.error('Mother web build needs Vite. Set the Render build command to: npm ci --include=dev && npm run build');
    process.exitCode = 1;
  } else {
    console.log('[Mother] Preparing the Render web preview.');
    const result = spawnSync(process.execPath, [vite, 'build'], {cwd:path.resolve(__dirname,'..'),stdio:'inherit'});
    process.exitCode = result.status ?? 1;
  }
}
