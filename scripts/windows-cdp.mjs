import assert from 'node:assert/strict';

export async function connectReader(endpoint = 'http://127.0.0.1:9223') {
  const targets = await (await fetch(`${endpoint}/json/list`)).json();
  const target = targets.find(item => item.type === 'page' && item.url.includes('tauri.localhost'));
  assert(target, 'Native reader WebView not found');
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
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 30_000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression, label) => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 75));
    }
    throw new Error(`Timeout: ${label}: ${await evaluate('document.body.innerText')}`);
  };
  const click = async label => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent.trim() === ${JSON.stringify(label)}); if (!b || b.disabled) throw new Error('Unavailable button: '+${JSON.stringify(label)}); b.click(); })()`);
  const pageReady = page => until(`(() => { const i=document.querySelector('img.comic-page'); return i && i.complete && i.naturalWidth>0 && document.querySelector('input[aria-label="Página atual"]').value === '${page}'; })()`, `decoded page ${page}`);
  await cdp('Runtime.enable');
  return { cdp, evaluate, until, click, pageReady, exceptions, close: () => socket.close() };
}
