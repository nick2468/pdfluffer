// Minimal Chrome DevTools Protocol client for driving the production PDFluffer window.
// PDFluffer's own WebView2 port. The fixtures script passes its own, for a headless Edge.
const PORT = 9223;
export async function connect(port = PORT) {
  let targets;
  for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some(t => t.type === 'page')) break; } catch {}
    await sleep(500);
  }
  if (!targets) throw new Error('no debugging endpoint on port ' + port);
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const events = [];
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id) { pending.get(msg.id)?.(msg); pending.delete(msg.id); } else events.push(msg); };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  return { send, ev, events, targets, url: page.url, close: () => ws.close() };
}
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export async function until(fn, ms = 30000, step = 300) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(step); } }
export function problems(events) {
  const out = [];
  for (const e of events) {
    if (e.method === 'Log.entryAdded') { const x = e.params.entry; if (x.level === 'error' || x.level === 'warning' || x.source === 'security' || x.source === 'violation') out.push(`[log ${x.source}/${x.level}] ${x.text} ${x.url || ''}`); }
    if (e.method === 'Runtime.consoleAPICalled' && (e.params.type === 'error' || e.params.type === 'warning')) out.push(`[console.${e.params.type}] ` + e.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (e.method === 'Runtime.exceptionThrown') out.push('[exception] ' + (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text).slice(0, 300));
    if (e.method === 'Page.javascriptDialogOpening') out.push(`[NATIVE DIALOG ${e.params.type}] ${e.params.message}`);
  }
  return out;
}
export const TABS = `JSON.stringify([...document.querySelectorAll('.tab')].map(t => ({ name: t.querySelector('.tab-name')?.textContent, active: t.classList.contains('active'), dirty: !!t.querySelector('.tab-dirty'), signed: !!t.querySelector('.tab-signed') })))`;
export const DIALOG = `(() => { const d = document.querySelector('dialog[open]'); return d ? JSON.stringify({ title: d.querySelector('h2')?.textContent, body: d.querySelector('.dialog-body')?.textContent, buttons: [...d.querySelectorAll('button')].map(b => b.textContent) }) : null; })()`;
export const clickButton = (label) => `(() => { const b = [...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`;
// The visible viewer's PDF.js application object (same origin, so reachable from the parent).
export const APP = `([...document.querySelectorAll('.viewer-host iframe')].find(f => getComputedStyle(f).visibility !== 'hidden')?.contentWindow?.PDFViewerApplication)`;
