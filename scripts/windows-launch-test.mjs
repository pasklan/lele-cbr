// Run with Windows Node.js. A dedicated WebView profile preserves real user progress.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const label = process.argv[2];
if (!label || !/^[a-zA-Z0-9_-]+$/.test(label)) throw new Error('Supply a unique test profile label');
const executable = process.argv[3] ?? path.join(root, 'artifacts', 'LeitorLele.exe');
const library = process.argv[4] ?? path.join(root, 'hqs');
if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) throw new Error('Use Windows Node.js');
const profile = path.join(process.env.LOCALAPPDATA, 'LeleCBR-Tests', label);
const child = spawn(executable, [], {
  detached: true,
  stdio: 'ignore',
  cwd: process.env.USERPROFILE,
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9223', WEBVIEW2_USER_DATA_FOLDER: profile, LELE_LIBRARY_DIR: library },
});
await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
child.unref();
console.log(JSON.stringify({ pid: child.pid, executable, profile, library }));
