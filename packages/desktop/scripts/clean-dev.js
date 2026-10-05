#!/usr/bin/env node

import { execFileSync, execSync } from 'node:child_process';

const isWindows = process.platform === 'win32';
const APP_NAME = 'qwen-code-desktop';
const APP_EXE = `${APP_NAME}.exe`;

function run(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Kill the desktop app process (Windows: releases the locked exe). */
function killApp() {
  if (isWindows) {
    if (run('taskkill', ['/F', '/IM', APP_EXE])) {
      console.log(`Terminated ${APP_EXE}`);
    }
    return;
  }
  if (run('pkill', ['-f', APP_NAME])) {
    console.log(`Terminated ${APP_NAME}`);
  }
}

/**
 * Find node processes whose command line mentions this desktop-shell package.
 * Those are the daemon (`cli-entry.js serve ...`) and its ACP children
 * (`cli.js --acp`) left orphaned when the app died uncleanly.
 */
function findOrphanNodePids() {
  if (!isWindows) {
    return [];
  }
  const candidates = [];
  // Prefer wmic (present on most Windows); fall back to PowerShell's
  // Get-CimInstance on systems where wmic was removed.
  try {
    const output = execSync(
      'wmic process where "name=\'node.exe\'" get processid,commandline',
      { encoding: 'utf8' },
    );
    for (const line of output.split(/\r?\n/)) {
      if (!line.includes('desktop-shell')) continue;
      const pid = line.trim().split(/\s+/).pop();
      if (pid && /^\d+$/.test(pid)) candidates.push(pid);
    }
  } catch {
    try {
      const output = execSync(
        'powershell -NoProfile -Command ' +
          '"Get-CimInstance Win32_Process -Filter \\"name=\'node.exe\'\\" | ' +
          'Select-Object -ExpandProperty ProcessId,CommandLine"',
        { encoding: 'utf8' },
      );
      for (const line of output.split(/\r?\n/)) {
        if (!line.includes('desktop-shell')) continue;
        const pid = line.trim().split(/\s+/).pop();
        if (pid && /^\d+$/.test(pid)) candidates.push(pid);
      }
    } catch {
      // Neither tool available; report rather than silently pass.
      console.log(
        'Could not enumerate node processes. Kill orphaned daemons manually.',
      );
    }
  }
  return candidates;
}

function killOrphans(pids) {
  for (const pid of pids) {
    if (run('taskkill', ['/F', '/PID', pid])) {
      console.log(`Terminated orphaned node PID ${pid}`);
    }
  }
}

killApp();
killOrphans(findOrphanNodePids());
console.log('Desktop dev processes cleaned.');
