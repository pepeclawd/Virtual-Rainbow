// Bar iPad view. Uses only the device credential and the restricted reservation endpoint.
// Reservation data lives in memory only (no storage, no service-worker cache); only the opaque
// device token is kept in localStorage so the iPad survives a reload until it expires or is revoked.
const $main = document.getElementById('main');
const $conn = document.getElementById('conn');
const KEY = 'hos-device-token';
const OCC = { birthday: 'Fødselsdag', anniversary: 'Jubilæum', colleagues: 'Kollegaer', bachelor: 'Polterabend/privatfest', other: 'Andet' };
let company = null; let day = null; let timer = null; let lastOk = null;

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k === 'class') el.className = v; else el.setAttribute(k, v === true ? '' : v); }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
const fmtDay = d => new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const clock = ms => new Intl.DateTimeFormat('da-DK', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Copenhagen' }).format(new Date(ms));
const shift = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

function setConn(state, text) { $conn.className = `conn ${state}`; $conn.textContent = text; }

function pairView(message) {
  clearInterval(timer); timer = null;
  const input = h('input', { id: 'code', autocomplete: 'off', autocapitalize: 'characters', inputmode: 'text', maxlength: 9, required: true, placeholder: 'XXXX-XXXX' });
  const err = h('p', { class: 'error', role: 'alert', hidden: !message }, message ?? '');
  const form = h('form', { class: 'card login' }, h('h1', {}, 'Aktivér iPad-visning'),
    h('p', {}, 'En ejer opretter en engangskode under Indstillinger → iPad-visning.'),
    h('label', { for: 'code' }, 'Parringskode'), input, h('button', { type: 'submit', class: 'primary' }, 'Aktivér'), err);
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    try {
      const res = await fetch(`/api/c/${company.id}/device/activate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: input.value }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error === 'too_many_attempts' ? 'For mange forsøg. Vent 10 minutter.' : 'Koden er ugyldig eller udløbet.');
      localStorage.setItem(KEY, data.token); load();
    } catch (e) { err.hidden = false; err.textContent = e.message; }
  });
  $main.replaceChildren(form);
  setConn('idle', 'Ikke aktiveret');
}

async function load() {
  const token = localStorage.getItem(KEY);
  if (!token) return pairView();
  if (!timer) timer = setInterval(load, 60_000);
  try {
    const q = day ? `?date=${day}&days=1` : '?days=1';
    const res = await fetch(`/api/c/${company.id}/device/reservations${q}`, { headers: { Authorization: `Device ${token}` }, cache: 'no-store' });
    if (res.status === 401) {
      const data = await res.json();
      localStorage.removeItem(KEY);
      $main.replaceChildren();
      return pairView(data.error === 'device_session_expired' ? 'Visningen er udløbet. Aktivér igen.' : 'Visningen er tilbagekaldt eller ugyldig. Aktivér igen.');
    }
    if (!res.ok) throw new Error('server');
    const data = await res.json();
    lastOk = Date.now();
    day = day ?? data.today;
    render(data);
    setConn('ok', `Forbundet · opdateret ${clock(lastOk)}`);
  } catch {
    setConn('offline', lastOk ? `Ingen forbindelse · sidst opdateret ${clock(lastOk)}` : 'Ingen forbindelse');
  }
}

function render(data) {
  const rows = data.reservations;
  const active = rows.filter(r => r.status === 'confirmed');
  const nav = h('nav', { class: 'daynav', 'aria-label': 'Vælg dag' },
    h('button', { type: 'button', onclick: () => { day = shift(day, -1); load(); }, disabled: day <= data.today }, '← Forrige dag'),
    h('button', { type: 'button', onclick: () => { day = data.today; load(); }, 'aria-pressed': String(day === data.today) }, 'I dag'),
    h('button', { type: 'button', onclick: () => { day = shift(day, 1); load(); }, disabled: day >= shift(data.today, 13) }, 'Næste dag →'));
  const list = h('ul', { class: 'device-list' });
  if (!rows.length) list.append(h('li', { class: 'empty' }, 'Ingen reservationer denne dag.'));
  for (const r of rows) {
    const cancelled = r.status === 'cancelled';
    list.append(h('li', { class: cancelled ? 'cancelled' : null },
      h('span', { class: 'time' }, r.time), h('span', { class: 'name' }, r.name ?? '—'),
      h('span', { class: 'count' }, `${r.count} pers.`), h('span', { class: 'occ' }, OCC[r.occasion] ?? ''),
      h('span', { class: 'state' }, cancelled ? 'ANNULLERET' : 'Godkendt')));
  }
  $main.replaceChildren(h('section', {}, nav, h('h1', {}, `${day === data.today ? 'I dag – ' : ''}${fmtDay(day)}`),
    h('p', { class: 'summary' }, `${active.length} reservationer · ${active.reduce((s, r) => s + r.count, 0)} gæster`), list));
}

(async () => {
  try { company = (await (await fetch('/api/instance', { cache: 'no-store' })).json()).company; } catch { setConn('offline', 'Ingen forbindelse'); return; }
  document.body.dataset.company = company.id;
  document.getElementById('name').textContent = `${company.displayName ?? company.name} · reservationer`;
  const themeBtn = document.getElementById('theme');
  const label = () => { themeBtn.textContent = `Tema: ${document.documentElement.dataset.theme === 'aften' ? 'Aften' : 'Dag'}`; };
  themeBtn.addEventListener('click', () => { const t = document.documentElement.dataset.theme === 'aften' ? 'dag' : 'aften'; localStorage.setItem('hos-theme', t); document.documentElement.dataset.theme = t; label(); });
  label();
  load();
  window.addEventListener('online', load);
  window.addEventListener('offline', () => setConn('offline', lastOk ? `Ingen forbindelse · sidst opdateret ${clock(lastOk)}` : 'Ingen forbindelse'));
})();
