// Native tests. Run 'prepare', restart the app with the same isolated profile,
// then run 'verify'. The script never clears reading history.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectReader } from './windows-cdp.mjs';

const phase = process.argv[2] ?? 'prepare';
const output = process.argv[3] ?? 'artifacts';
assert(['prepare', 'verify'].includes(phase));
const { cdp, evaluate, until, click, pageReady, exceptions, close } = await connectReader();
const key = 'lele.reading.v1';
const openBook = async index => {
  await evaluate(`document.querySelectorAll('.library-item')[${index}].click()`);
  await until('!!document.querySelector("img.comic-page") && document.querySelector("img.comic-page").naturalWidth>0', 'opened book');
};
const keypress = async key => evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true}))`);
const fullscreen = () => evaluate(`window.__TAURI_INTERNALS__.invoke('plugin:window|is_fullscreen',{label:'main'})`);
const goTo = async target => {
  await keypress('Home');
  await pageReady(1);
  for (let number = 2; number <= target; number++) { await keypress('ArrowRight'); await pageReady(number); }
};
try {
  await until('document.querySelectorAll(".library-item").length === 5', 'real local library');
  if (phase === 'verify') {
    assert.equal(await evaluate('document.querySelector(".app-shell").classList.contains("sidebar-collapsed")'), true);
    await click('Mostrar biblioteca');
    await openBook(0);
    await pageReady(7);
    assert.equal(await evaluate('document.querySelector(".zoom-value").textContent'), '125%');
    assert.equal(await evaluate('document.querySelector(".canvas").classList.contains("fit-width")'), true);
    await openBook(1);
    await pageReady(3);
    const report = { phase, appRestartRestoredBothBooks: true, preferencesRestored: true, profileHistoryCleared: false };
    await writeFile(path.join(output, 'windows-usability-restart.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } else {
    if (await fullscreen()) { await click('Sair da tela cheia'); await until(`!!document.querySelector('button[aria-label="Tela cheia"]')`, 'reset fullscreen'); }
    if (await evaluate('document.querySelector(".app-shell").classList.contains("sidebar-collapsed")')) await click('Mostrar biblioteca');
    await openBook(0);
    await goTo(7);
    await click('Largura');
    await click('Aumentar zoom');
    assert.equal(await evaluate('document.querySelector(".zoom-value").textContent'), '125%');
    await openBook(1);
    await goTo(3);
    await click('Página inteira');
    await openBook(0);
    await pageReady(7);
    assert.equal(await evaluate('document.querySelector(".zoom-value").textContent'), '125%');

    const layouts = [];
    for (const [width, height, scale] of [[1280,900,1],[760,540,1],[760,540,1.25],[760,540,1.5]]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
      const layout = await evaluate(`(() => {
        const sample = s => {const e=document.querySelector(s),r=e.getBoundingClientRect();return {font:parseFloat(getComputedStyle(e).fontSize),width:r.width,height:r.height};};
        return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,root:parseFloat(getComputedStyle(document.documentElement).fontSize),page:sample('.page-control'),input:sample('.page-control input'),arrow:sample('.navigation-controls>button'),fit:sample('.segmented button'),book:sample('.book-title'),canvasHeight:document.querySelector('.canvas').clientHeight,controls:[...document.querySelectorAll('.toolbar button,.page-control')].map(e=>{const r=e.getBoundingClientRect();return {label:e.getAttribute('aria-label')||e.textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};})};
      })()`);
      assert(layout.documentWidth <= width, `Horizontal overflow: ${JSON.stringify(layout)}`);
      assert(layout.root >= 16 && layout.page.font >= 16 && layout.input.font >= 16);
      assert(layout.arrow.font >= 28 && layout.arrow.width >= 44 && layout.arrow.height >= 44);
      assert(layout.fit.font >= 15 && layout.book.font >= 15);
      assert(layout.canvasHeight >= 100, `Not enough reading space: ${layout.canvasHeight}`);
      assert(layout.controls.every(control => control.left >= 0 && control.right <= width + 1 && control.top >= 0 && control.bottom <= height), 'Clipped controls');
      layouts.push({ width, height, scale, ...layout });
    }
    await cdp('Emulation.clearDeviceMetricsOverride');
    await click('Ocultar biblioteca');
    assert.equal(await evaluate('document.querySelector("#library-sidebar").hidden'), true);
    await keypress('F11');
    await until(`!!document.querySelector('button[aria-label="Sair da tela cheia"]')`, 'fullscreen label');
    assert.equal(await fullscreen(), true);
    await keypress('Escape');
    await until(`!!document.querySelector('button[aria-label="Tela cheia"]')`, 'windowed label');
    assert.equal(await fullscreen(), false);
    await click('Tela cheia');
    await until(`!!document.querySelector('button[aria-label="Sair da tela cheia"]')`, 'button fullscreen');
    assert.equal(await fullscreen(), true);
    await click('Sair da tela cheia');
    await until(`!!document.querySelector('button[aria-label="Tela cheia"]')`, 'button windowed');
    assert.equal(await fullscreen(), false);

    // Exercise real Tauri event transport. OS drop authorization is covered by Rust
    // tests; this event test is not a claim that a physical Explorer drag occurred.
    const ids = await evaluate(`window.__TAURI_INTERNALS__.invoke('list_library').then(items=>items.map(item=>item.id))`);
    await evaluate(`window.__TAURI_INTERNALS__.invoke('plugin:event|emit',{event:'comic-dropped',payload:{id:${JSON.stringify(ids[1])}}})`);
    await pageReady(3);
    await evaluate(`window.__TAURI_INTERNALS__.invoke('plugin:event|emit',{event:'comic-dropped',payload:{id:${JSON.stringify(ids[0])}}})`);
    await pageReady(7);
    const saved = await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`);
    assert.equal(saved.books[ids[0]].page, 6);
    assert.equal(saved.books[ids[1]].page, 2);
    assert.equal(saved.preferences.collapsed, true);
    assert.deepEqual(exceptions, []);
    await mkdir(output, { recursive: true });
    const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(output, 'windows-reader-v0.2.0.png'), Buffer.from(screenshot.data, 'base64'));
    const report = { phase, layouts, fullscreenNativeVerified: true, independentBookPositions: [7,3], sidebarCollapsed: true, trustedEventTransportVerified: true, physicalExplorerDropVerified: false, profileHistoryCleared: false, jsExceptions: exceptions };
    await writeFile(path.join(output, 'windows-usability.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, layouts: layouts.map(item => ({width:item.width,height:item.height,scale:item.scale,root:item.root,page:item.page,arrow:item.arrow,canvasHeight:item.canvasHeight})) }, null, 2));
  }
} finally {
  await cdp('Emulation.clearDeviceMetricsOverride').catch(() => {});
  close();
}
