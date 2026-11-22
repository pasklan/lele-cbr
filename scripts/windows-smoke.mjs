// Run with Windows Node.js against a debug-enabled WebView2 instance.
// Example: node scripts/windows-smoke.mjs http://127.0.0.1:9223 artifacts
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const endpoint = process.argv[2] ?? 'http://127.0.0.1:9223';
const output = process.argv[3] ?? 'artifacts';
const targets = await (await fetch(`${endpoint}/json/list`)).json();
const target = targets.find(t => t.type === 'page' && /tauri\.localhost|localhost/.test(t.url));
assert(target, 'Leitor Lelê WebView2 page not found');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let nextId = 0;
const pending = new Map();
const exceptions = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
  const callback = pending.get(message.id);
  if (callback) { pending.delete(message.id); message.error ? callback.reject(message.error) : callback.resolve(message.result); }
});
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 30_000);
    pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(expression, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw new Error(`Timeout waiting for ${label}: ${await evaluate('document.body.innerText')}`);
}
async function click(label) {
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent.trim() === ${JSON.stringify(label)}); if (!b || b.disabled) throw new Error('Button unavailable: '+${JSON.stringify(label)}); b.click(); })()`);
}
async function pageReady(page) {
  await until(`(() => {const i=document.querySelector('img.comic-page'); return i && i.complete && i.naturalWidth > 0 && document.querySelector('input[aria-label="Página atual"]').value === '${page}';})()`, `decoded page ${page}`);
}
try {
  await cdp('Runtime.enable');
  await until('document.querySelectorAll(".library-item").length === 5', 'five real books');
  const summaries = [];
  const counts = [36, 28, 26, 23, 21];
  for (let book = 0; book < counts.length; book++) {
    await evaluate(`document.querySelectorAll('.library-item')[${book}].click()`);
    await pageReady(1);
    assert.equal(await evaluate('document.querySelector(".navigation-controls button").disabled'), true);
    await click('Última página');
    await pageReady(counts[book]);
    assert.equal(await evaluate(`document.querySelector('button[aria-label="Próxima página"]').disabled`), true);
    await click('Primeira página');
    await pageReady(1);
    await click('Próxima página');
    await pageReady(2);
    await click('Página anterior');
    await pageReady(1);
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', {key:'End', bubbles:true}))`);
    await pageReady(counts[book]);
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', {key:'Home', bubbles:true}))`);
    await pageReady(1);
    summaries.push(await evaluate(`({title:document.querySelector('h1').textContent, pages: Number(document.querySelector('[role="progressbar"]').getAttribute('aria-valuemax')), width:document.querySelector('img').naturalWidth, height:document.querySelector('img').naturalHeight})`));
    assert.equal(summaries.at(-1).pages, counts[book]);
  }
  await click('Largura');
  assert.equal(await evaluate('document.querySelector(".canvas").classList.contains("fit-width")'), true);
  await click('Aumentar zoom');
  assert.equal(await evaluate('document.querySelector(".zoom-value").textContent'), '125%');
  // Rapid navigation must eventually show only the latest page.
  await evaluate(`for(let n=0;n<10;n++) window.dispatchEvent(new KeyboardEvent('keydown',{key:n%2?'Home':'End',bubbles:true}))`);
  await pageReady(1);
  await mkdir(output, { recursive: true });
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(output, 'windows-reader.png'), Buffer.from(screenshot.data, 'base64'));
  await evaluate(`document.querySelector('.reader-header button').click()`);
  await until('!document.querySelector("img.comic-page") && !document.querySelector(".reader-header button")', 'closed book');
  assert.equal(await evaluate(`window.__TAURI_INTERNALS__.invoke('read_page',{index:0,documentId:'stale'}).then(()=>false,()=>true)`), true);
  assert.equal(await evaluate('document.querySelectorAll("[role=alert]").length'), 0);
  assert.deepEqual(exceptions, []);
  const report = { platform: 'Windows WebView2 / Tauri native IPC', books: summaries, checks: ['library', 'image decoding', 'first/last', 'next/previous', 'keyboard Home/End', 'navigation bounds', 'width fit', 'zoom', 'rapid navigation', 'close', 'stale ID rejected', 'no JS exceptions'] };
  await writeFile(path.join(output, 'windows-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { socket.close(); }
