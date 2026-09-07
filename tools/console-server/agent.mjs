#!/usr/bin/env node
// Installs the console as a per-user launchd agent so it is simply there in the
// browser, the way ops.focx.ai is. It stays bound to 127.0.0.1: this makes the
// server survive a closed terminal, not reachable from anywhere new.
//
// Paths are resolved from this checkout at install time rather than committed,
// because a plist naming one machine's paths is not shared configuration.
import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const LABEL = 'ai.focx.console';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const escape = value => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function plist({ node = process.execPath, cwd = root, port = 4174, logDir } = {}) {
  const logs = logDir ?? join(homedir(), 'Library/Logs');
  const args = [node, resolve(cwd, 'tools/console-server/index.mjs')];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>${args.map(a => `\n    <string>${escape(a)}</string>`).join('')}
  </array>
  <key>WorkingDirectory</key><string>${escape(cwd)}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PORT</key><string>${Number(port)}</string></dict>
  <key>StandardOutPath</key><string>${escape(join(logs, LABEL + '.out.log'))}</string>
  <key>StandardErrorPath</key><string>${escape(join(logs, LABEL + '.err.log'))}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>5</integer>
</dict>
</plist>
`;
}

export const agentPath = (home = homedir()) => join(home, 'Library/LaunchAgents', `${LABEL}.plist`);

function main() {
  const verb = process.argv[2] ?? 'status';
  const path = agentPath();
  const uid = process.getuid();
  const run = (...args) => {
    try { execFileSync('launchctl', args, { stdio: 'pipe' }); return true; } catch { return false; }
  };
  if (verb === 'install') {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, plist({ port: process.env.PORT ?? 4174 }), { mode: 0o644 });
    run('bootout', `gui/${uid}/${LABEL}`);            // replace any earlier copy
    if (!run('bootstrap', `gui/${uid}`, path)) { console.error(`Wrote ${path}, but launchctl bootstrap failed.`); process.exitCode = 1; return; }
    console.log(`Installed ${LABEL}. The console starts at login and restarts if it exits.`);
    console.log(`  plist: ${path}`);
    return;
  }
  if (verb === 'uninstall') {
    run('bootout', `gui/${uid}/${LABEL}`);
    if (existsSync(path)) unlinkSync(path);
    console.log(`Removed ${LABEL}.`);
    return;
  }
  if (verb === 'status') {
    console.log(existsSync(path) ? `installed: ${path}` : 'not installed');
    try { console.log(execFileSync('launchctl', ['print', `gui/${uid}/${LABEL}`], { encoding: 'utf8' }).split('\n').filter(l => /state|pid|last exit/.test(l)).join('\n').trim() || '(not loaded)'); }
    catch { console.log('(not loaded)'); }
    return;
  }
  console.error('Usage: node tools/console-server/agent.mjs [install|uninstall|status]');
  process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
