// Staff app (owner/manager). All data comes from the server API; text is inserted with textContent
// only, so mail content can never become markup. No guest data is written to persistent storage.
// Layout and colours follow Mathias's visual concept "Driftsoverblik" (Dag/Aften, October 2026).
const $main = document.getElementById('main');
const $top = document.getElementById('top');
const $side = document.getElementById('side');
const $bottom = document.getElementById('bottom');
const $live = document.getElementById('live');
const S = { token: sessionStorage.getItem('hos-token'), instance: null, session: null, notifications: [], cases: [], tasksOpen: 0, showNotes: false, poll: null };

const OCC = { birthday: 'Fødselsdag', anniversary: 'Jubilæum', colleagues: 'Kollegaer', bachelor: 'Polterabend/privatfest', other: 'Andet' };
const TYPE = { followup: 'Svar i eksisterende tråd', booking_request: 'Reservationsforslag', cancellation: 'Foreslået aflysning', change: 'Ændringsønske', rules_ack: 'Svar på regler' };
const STATUS = { open: 'Afventer', approved: 'Godkendt', closed: 'Lukket', answered_externally: 'Besvaret i Mail – afklar' };
const OUT = { held_draft_only: 'Ikke sendt (kun udkast)', held_not_test_recipient: 'Ikke sendt (ikke testmodtager)', queued: 'I kø', sending: 'Sender…',
  sent: 'Sendt', failed: 'Fejlet – ikke sendt', unknown: 'Ukendt om sendt – kontrollér', superseded: 'Erstattet' };
const RULES = { pending: 'Regler: afventer gæstens ok', accepted: 'Regler: accepteret', not_required: 'Regler: ikke krævet' };
const ROLE = { owner: 'Ejer', manager: 'Manager' };
const ERR = { large_group_requires_mathias: 'STOR GRUPPE: kun Mathias kan godkende eller lukke denne sag.', stale_version: 'Sagen er ændret siden du åbnede den. Indlæs igen og gennemgå den nye version.',
  case_decided: 'Sagen er allerede afgjort.', acknowledgement_required: 'Bekræft de markerede regler først.', fields_incomplete: 'Udfyld navn, antal, dato og tid før bekræftelse.',
  unresolved_placeholders: 'Svaret indeholder stadig felter i [klammer].', template_action_mismatch: 'Skabelonen passer ikke til handlingen.', role_not_allowed: 'Din rolle må ikke dette.',
  answered_outside_app: 'Sagen er besvaret direkte i Mail. Luk den eller registrér uden at sende.', reservation_required: 'Vælg hvilken reservation det gælder.',
  draft_only_mode: 'Kun-udkast-tilstand: intet kan sendes.', duplicate_risk_not_accepted: 'Bekræft at du accepterer risiko for dobbelt mail.', no_membership: 'Du har ikke adgang til denne bar.',
  photo_too_large: 'Billedet er for stort (maks 5 MB).', photo_type_not_allowed: 'Kun JPEG, PNG eller WebP.', invalid_assignee: 'Vælg en ansvarlig fra baren.', last_owner: 'Der skal være mindst én aktiv ejer.',
  sign_in_required: 'Log ind igen.', network: 'Ingen forbindelse til serveren.', unknown_user: 'Adressen er ikke inviteret.' };

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
// DOM append() would print null/false as text; conditional children use this instead.
const put = (el, ...kids) => { for (const k of kids.flat()) if (k != null && k !== false) el.append(k); };
const say = msg => { $live.textContent = ''; setTimeout(() => { $live.textContent = msg; }, 30); };
const fmtDate = d => d ? new Intl.DateTimeFormat('da-DK', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`)) : '—';
const fmtLong = d => new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const fmtTime = ms => new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Copenhagen' }).format(new Date(ms));
// The static demo pins its clock to the moment the synthetic snapshot was made.
const nowMs = () => S.instance?.demoNow ? S.instance.demoNow + (Date.now() - S.instance.loadedAt) : Date.now();
const todayCph = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(new Date(nowMs()));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const shortName = n => { const p = String(n ?? '').split(/\s+/); return p.length > 1 ? `${p[0]} ${p[1][0]}.` : p[0]; };

async function api(path, { method = 'GET', body } = {}) {
  const base = path.startsWith('/api/') ? path : `/api/c/${S.instance.company.id}${path}`;
  let res;
  try {
    res = await fetch(base, { method, headers: { ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw Object.assign(new Error('network'), { code: 'network' }); }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : res;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/dev')) { logout(); }
    throw Object.assign(new Error(data.error), { code: data.error, details: data.details });
  }
  return data;
}
const errText = e => ERR[e.code] ?? `Fejl: ${e.code ?? 'ukendt'}`;
function errorBox(e) { return h('p', { class: 'error', role: 'alert' }, errText(e), e.details ? ` (${[].concat(e.details).join(', ')})` : ''); }

function logout() { S.token = null; S.session = null; sessionStorage.removeItem('hos-token'); clearInterval(S.poll); location.hash = ''; render(); }
function setTheme(t) { localStorage.setItem('hos-theme', t); document.documentElement.dataset.theme = t; header(); }
const theme = () => document.documentElement.dataset.theme;
// Company marks from the concept: waves for Søhesten, a cup for Rannør (simple inline SVG).
function companyMark(id) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '18'); svg.setAttribute('height', '18'); svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round');
  const paths = id === 'rannor' ? ['M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z', 'M16 10h1.5a2.5 2.5 0 0 1 0 5H16', 'M9 4v2M12 4v2']
    : ['M3 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0', 'M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0'];
  for (const d of paths) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p); }
  return h('span', { class: `mark mark-${id}`, 'aria-hidden': 'true' }, svg);
}

// ---------- shell: sidebar (desktop), top bar, bottom nav (mobile), notifications ----------
const NAV = () => [['#/home', 'Overblik', 0], ['#/inbox', 'Afventer', S.cases.length], ['#/reservations', 'Reservationer', 0], ['#/tasks', 'Opgaver', S.tasksOpen], ['#/settings', 'Indstillinger', 0]];
function isActive(href) {
  const hsh = location.hash || '#/home';
  return hsh.startsWith(href) || (href === '#/inbox' && hsh.startsWith('#/case')) || (href === '#/home' && (hsh === '#/' || hsh === ''));
}
function navLink(href, label, count, cls) {
  const active = isActive(href);
  return h('a', { href, class: `${cls}${active ? ' active' : ''}`, 'aria-current': active ? 'page' : null }, h('span', {}, label),
    count ? h('span', { class: 'count-badge', 'aria-label': `${count}` }, String(count)) : null);
}
function header() {
  const c = S.instance.company;
  document.body.dataset.company = c.id;
  const authed = Boolean(S.session) && !location.hash.startsWith('#/choose');
  document.body.classList.toggle('auth', !authed);
  $side.replaceChildren(); $top.replaceChildren(); $bottom.replaceChildren();
  if (!authed) return;
  const u = S.session.user;
  const unread = S.notifications.filter(n => !n.readAt).length;
  const urgent = S.notifications.some(n => !n.readAt && n.urgent);
  const multi = (S.session.companies ?? []).length > 1;
  put($side,
    h('div', { class: 'side-brand' }, h('p', { class: 'side-name' }, h('span', { class: 'dot-co', 'aria-hidden': 'true' }), c.displayName ?? c.name),
      h('p', { class: 'side-who' }, `${shortName(u.name)} · ${ROLE[u.role]}`)),
    h('nav', { class: 'side-nav', 'data-nav': 'side', 'aria-label': 'Hovedmenu' }, ...NAV().map(([href, label, n]) => navLink(href, label, n, 'side-link'))),
    h('div', { class: 'side-foot' },
      h('button', { type: 'button', class: 'linkish', onclick: () => setTheme(theme() === 'aften' ? 'dag' : 'aften') }, `Tema: ${theme() === 'aften' ? 'Aften' : 'Dag'}`),
      multi ? h('a', { href: '#/choose', class: 'linkish' }, 'Skift virksomhed →') : null,
      h('button', { type: 'button', class: 'linkish', onclick: logout }, 'Log ud')));
  put($top,
    h('div', { class: 'top-row' },
      h('p', { class: 'top-name' }, h('span', { class: 'dot-co', 'aria-hidden': 'true' }), c.name),
      h('div', { class: 'top-actions' },
        S.session.sendMode === 'draft_only' ? h('span', { class: 'pill warn', title: 'Godkendelser registreres, men ingen mails sendes.' }, 'Kun udkast', h('span', { class: 'wide-only' }, ' – intet sendes')) :
          S.session.sendMode === 'test_accounts' ? h('span', { class: 'pill warn' }, 'Testtilstand') : null,
        h('button', { type: 'button', class: `notif-btn${urgent ? ' urgent' : ''}`, 'aria-expanded': String(S.showNotes), 'aria-controls': 'notes', onclick: () => { S.showNotes = !S.showNotes; header(); } },
          h('span', { class: 'wide-only' }, 'Notifikationer'), h('span', { class: 'narrow-only' }, 'Beskeder'), h('span', { class: 'count', 'aria-label': `${unread} ulæste` }, String(unread))),
        )),
    S.showNotes ? notePanel() : null);
  put($bottom, ...NAV().map(([href, label, n]) => navLink(href, label === 'Indstillinger' ? 'Mere' : label, n, 'bottom-link')));
}
function notePanel() {
  const list = h('ul', { class: 'notes' });
  if (!S.notifications.length) put(list, h('li', { class: 'empty' }, 'Ingen notifikationer.'));
  for (const n of S.notifications) put(list, h('li', { class: `${n.readAt ? 'read' : 'unread'}${n.urgent ? ' urgent' : ''}` },
    h('a', { href: link(n), onclick: () => markRead(n.id) }, n.urgent ? h('strong', {}, 'VIGTIGT: ') : null, n.title),
    h('span', { class: 'meta' }, `${fmtTime(n.createdAt)} · ${n.readAt ? 'Læst' : 'Ulæst'}`)));
  return h('section', { id: 'notes', class: 'panel', 'aria-label': 'Notifikationer' }, list,
    h('button', { class: 'ghost', onclick: () => markRead('all') }, 'Markér alle som læst'));
}
const link = n => n.kind.startsWith('task') ? '#/tasks' : n.kind.startsWith('send_') ? '#/reservations' : `#/case/${n.ref}`;
async function markRead(id) { try { await api(`/notifications/${id}/read`, { method: 'POST', body: {} }); await refreshMeta(); header(); } catch (e) { say(errText(e)); } }
async function refreshMeta() {
  const [n, c, t] = await Promise.all([api('/notifications'), api('/cases'), api('/tasks')]);
  S.notifications = n; S.cases = c; S.tasksOpen = t.filter(x => x.status !== 'resolved').length;
}

// ---------- login and company choice (Mathias's concept, section 02) ----------
async function loginView() {
  const email = h('input', { id: 'login-email', type: 'email', autocomplete: 'username', required: true, placeholder: 'navn@firma.dk' });
  const err = h('div', { 'aria-live': 'polite' });
  const form = h('form', { class: 'auth-card' },
    h('p', { class: 'eyebrow' }, 'Driftsoverblik'), h('h1', {}, 'Log ind'),
    h('p', {}, 'Skriv din firmamail, så sender vi et login-link.'),
    h('label', { for: 'login-email', class: 'sr-only' }, 'Firmamail'), email,
    h('button', { type: 'submit', class: 'dark', disabled: !S.instance.devLogin }, 'Send login-link →'),
    h('p', { class: 'fine' }, 'Kun inviterede brugere. Ingen delte koder.'), err);
  const signIn = async key => {
    try { const { token } = await api('/api/dev/login', { method: 'POST', body: { email: key } }); S.token = token; sessionStorage.setItem('hos-token', token); S.justLoggedIn = true; await start(); }
    catch (e) { err.replaceChildren(errorBox(e)); }
  };
  form.addEventListener('submit', ev => { ev.preventDefault(); signIn(email.value); });
  if (!S.instance.devLogin) { put(form, h('p', { class: 'fine' }, 'Login-link aktiveres, når produktionslogin er sat op.')); return h('section', { class: 'auth-wrap' }, form); }
  const users = await api('/api/dev/users');
  put(form, h('div', { class: 'dev-users' }, h('p', { class: 'fine' }, S.instance.demo ? 'Demo med syntetiske data: vælg en bruger.' : 'Lokal test: login-linket simuleres. Vælg en syntetisk bruger:'),
    h('div', { class: 'chips' }, ...users.map(u => h('button', { type: 'button', class: 'chip user', 'data-user': u.id, onclick: () => signIn(u.email) }, u.name)))));
  return h('section', { class: 'auth-wrap' }, form);
}
function chooserView() {
  const list = h('ul', { class: 'choose' });
  for (const co of S.session.companies) put(list, h('li', {}, h('a', {
    href: co.current ? '#/home' : `${co.url}#/dev-login/${encodeURIComponent(S.session.user.email ?? '')}`, class: 'choose-row', 'data-company': co.id },
    companyMark(co.id), h('span', { class: 'choose-text' }, h('strong', {}, co.name), h('span', {}, ROLE[co.role] ?? co.role)), h('span', { 'aria-hidden': 'true' }, '→'))));
  return h('section', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
    h('p', { class: 'eyebrow' }, `Logget ind som ${shortName(S.session.user.name)}`), h('h1', {}, 'Vælg virksomhed'),
    h('p', {}, 'To selvstændige selskaber. Du er inde i én ad gangen.'), list,
    h('button', { type: 'button', class: 'ghost', onclick: logout }, 'Log ud')));
}

// ---------- overview (Mathias's concept, section 03, with V1 content) ----------
const WD = d => new Intl.DateTimeFormat('da-DK', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const clock = ms => new Intl.DateTimeFormat('da-DK', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Copenhagen' }).format(new Date(ms));
const ago = ms => { const m = Math.round((nowMs() - ms) / 60000); return m < 1 ? 'lige nu' : m < 60 ? `for ${m} min. siden` : `kl. ${clock(ms)}`; };
// Status card: whole background carries the state, and a word/arrow always accompanies the colour.
function statusCard(state, label, badge, value, sub, href, extra = null) {
  return h('a', { class: `stat ${state}`, href }, h('span', { class: 'stat-head' }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-badge' }, badge)),
    h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-sub' }, sub), extra);
}
function panel(title, tag, ...body) {
  return h('section', { class: 'panel-card' }, h('div', { class: 'panel-head' }, h('h2', {}, title), tag ? h('span', { class: 'tag' }, tag) : null), ...body);
}
function deviceLine(devices) {
  if (!devices.length) return 'Ingen aktiv iPad';
  const seen = devices.map(d => d.lastSeenAt).filter(Boolean).sort((a, b) => b - a)[0];
  return `${devices.length === 1 ? '1 aktiv' : `${devices.length} aktive`} · ${seen ? `sidst set ${ago(seen)}` : 'ikke set endnu'}`;
}
async function homeView() {
  const o = await api('/overview');
  const wrap = h('section', { class: 'home' },
    h('div', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow' }, `${cap(fmtLong(o.today.date))} · reservationer og opgaver`), h('h1', {}, 'Overblik')),
      // Segmented control in the place the concept uses for "Samme ugedag | Samme dato".
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Tema' }, ...[['dag', 'Dag'], ['aften', 'Aften']].map(([k, l]) =>
        h('button', { type: 'button', 'aria-pressed': String(theme() === k), onclick: () => { setTheme(k); route(); } }, l)))));
  const urgent = o.attention.filter(a => a.urgent);
  const first = urgent[0] ?? o.attention[0];
  if (first) put(wrap, h('div', { class: `banner-act ${urgent.length ? 'bad' : 'warn'}`, role: 'note' },
    h('span', { class: 'bang', 'aria-hidden': 'true' }, '!'),
    h('p', {}, h('strong', {}, first.text), first.date ? `, ${fmtDate(first.date)}` : '', o.attention.length > 1 ? ` · ${o.attention.length - 1} mere kræver opmærksomhed` : ''),
    h('a', { class: 'banner-btn', href: first.kind === 'task' ? '#/tasks' : `#/case/${first.ref}` }, first.kind === 'task' ? 'Se opgave' : 'Se sag')));
  else put(wrap, h('div', { class: 'banner-act good', role: 'note' }, h('span', { class: 'bang', 'aria-hidden': 'true' }, '✓'),
    h('p', {}, h('strong', {}, 'Intet kræver handling'), ` · reservationsmail tjekket ${o.mail.lastSyncAt ? ago(o.mail.lastSyncAt) : '—'}.`)));
  const ap = o.approvals; const tk = o.tasks; const rl = o.rules;
  put(wrap, h('div', { class: 'stats' },
    statusCard(ap.pending === 0 ? 'good' : ap.large ? 'bad' : 'warn', 'Afventer', ap.pending === 0 ? '✓ Ingen' : ap.large ? '! Stor gruppe' : '● Afventer',
      String(ap.pending), ap.pending ? `${ap.large ? `${ap.large} stor gruppe · ` : ''}ældste ${ago(ap.oldestAt)}` : 'Alle mails er besvaret', '#/inbox'),
    statusCard(o.today.note && !o.today.reservations ? 'neutral' : 'good', 'I dag', o.today.note && !o.today.reservations ? 'Lukket' : '✓ Bekræftet',
      `${o.today.reservations} res.`, `${o.today.guests} gæster${o.today.rows.some(r => r.status === 'cancelled') ? ` · ${o.today.rows.filter(r => r.status === 'cancelled').length} annulleret` : ''}`, '#/reservations'),
    statusCard(rl.pending === 0 ? 'good' : 'warn', 'Regel-ok · 7 dage', rl.pending === 0 ? '✓ Alle' : `● ${rl.pending} afventer ok`,
      `${rl.upcoming - rl.pending}/${rl.upcoming}`, 'Gæster der har svaret ok på reglerne', '#/reservations'),
    statusCard(tk.urgent ? 'bad' : tk.open + tk.inProgress ? 'warn' : 'good', 'Opgaver', tk.urgent ? `! ${tk.urgent} akut` : tk.open + tk.inProgress ? '● Åbne' : '✓ Alt løst',
      String(tk.open + tk.inProgress), `${tk.open} åbne · ${tk.inProgress} i gang`, '#/tasks')));
  // Next 7 days: same visual language as the "Timefordeling" chart.
  const max = Math.max(1, ...o.week.map(d => d.guests));
  const top = o.week.reduce((a, d) => (d.guests > a.guests ? d : a), o.week[0]);
  const chart = h('div', { class: 'chart', role: 'img', 'aria-label': o.week.map(d => `${WD(d.date)} ${d.guests} gæster`).join(', ') },
    ...o.week.map(d => h('div', { class: 'col-bar' }, h('span', { class: `colfill${d.large ? ' large' : d.guests === top.guests && d.guests ? ' peak' : ''}`, 'data-h': String(Math.round(d.guests / max * 100)) }),
      h('span', { class: 'col-lbl' }, `${WD(d.date).replace('.', '')} ${Number(d.date.slice(8))}`))));
  const todayList = h('ul', { class: 'rows' });
  if (o.today.note) put(todayList, h('li', { class: 'row warn' }, h('span', {}, o.today.note)));
  if (!o.today.rows.length) put(todayList, h('li', { class: 'row neutral empty' }, 'Ingen reservationer i dag.'));
  for (const r of o.today.rows) {
    const st = r.status === 'cancelled' ? 'bad' : r.rulesAccepted === 'pending' ? 'warn' : 'good';
    put(todayList, h('li', { class: `row ${st}` }, h('span', { class: 'row-main' }, h('strong', {}, `${r.time} · ${r.name ?? '—'}`),
      h('span', {}, `${r.count} pers.${r.occasion ? ` · ${OCC[r.occasion]}` : ''}`)),
      h('span', { class: 'row-state' }, r.status === 'cancelled' ? 'Annulleret' : r.rulesAccepted === 'pending' ? 'Regler afventer' : 'Godkendt')));
  }
  put(wrap, h('div', { class: 'grid-2' },
    panel('Næste 7 dage', 'Bekræftede gæster', chart, h('p', { class: 'fine' }, top.guests ? `Travleste dag: ${fmtDate(top.date)} · ${top.guests} gæster · ${top.reservations} reservationer. Ingen kapacitetsmodel – vurder selv.` : 'Ingen bekræftede reservationer de næste 7 dage.')),
    panel('I dag', `${o.today.reservations} res. · ${o.today.guests} gæster`, todayList)));
  // Lower row: pending, tasks, mail + iPad.
  const pend = h('ul', { class: 'rows' });
  if (!ap.list.length) put(pend, h('li', { class: 'row good' }, h('span', {}, 'Ingen mails afventer.')));
  for (const c of ap.list) put(pend, h('li', { class: `row ${c.large ? 'bad' : 'warn'}` }, h('a', { class: 'row-main', href: `#/case/${c.id}` },
    h('strong', {}, `${c.large ? 'STOR GRUPPE · ' : ''}${TYPE[c.type]}`), h('span', {}, `${c.name ?? 'Navn mangler'} · ${c.count ?? '?'} pers. · ${fmtDate(c.date)}`))));
  const tl = h('ul', { class: 'rows' });
  if (!tk.list.length) put(tl, h('li', { class: 'row good' }, h('span', {}, 'Ingen åbne opgaver.')));
  for (const t of tk.list) put(tl, h('li', { class: `row ${t.priority === 'urgent' ? 'bad' : t.status === 'in_progress' ? 'warn' : t.status === 'resolved' ? 'good' : 'neutral'}` },
    h('span', { class: `box${t.status === 'resolved' ? ' done' : ''}`, 'aria-hidden': 'true' }),
    h('a', { class: 'row-main', href: '#/tasks' }, h('strong', {}, t.description), h('span', {}, `${t.priority === 'urgent' ? 'Akut · ' : ''}${t.status === 'in_progress' ? 'I gang' : t.status === 'resolved' ? 'Løst' : 'Åben'}${t.location ? ` · ${t.location}` : ''}`)),
    h('span', { class: 'at' }, `@${t.assignee}`)));
  const m = o.mail;
  const fresh = m.lastSyncAt && nowMs() - m.lastSyncAt < 15 * 60000;
  put(wrap, h('div', { class: 'grid-3' },
    panel('Afventer godkendelse', `${ap.pending} mails`, pend, h('a', { class: 'more', href: '#/inbox' }, 'Gennemse alle →')),
    panel('Opgaver', `${tk.open + tk.inProgress} åbne`, tl, h('a', { class: 'more', href: '#/tasks' }, '+ Ny opgave · ☐ Akut')),
    panel('Mail og iPad', null, h('ul', { class: 'rows' },
      h('li', { class: `row ${fresh ? 'good' : 'warn'}` }, h('span', { class: 'row-main' }, h('strong', {}, 'Reservationsmail'), h('span', {}, m.lastSyncAt ? `Tjekket ${ago(m.lastSyncAt)}` : 'Ikke tjekket endnu')), h('span', { class: 'row-state' }, fresh ? 'Opdateret' : 'Forældet')),
      h('li', { class: `row ${m.problems ? 'bad' : 'neutral'}` }, h('span', { class: 'row-main' }, h('strong', {}, 'Udsendelse'), h('span', {}, m.sendMode === 'draft_only' ? `${m.held} godkendte svar holdt tilbage (kun udkast)` : `${m.sent} svar sendt`)), h('span', { class: 'row-state' }, m.problems ? `${m.problems} kræver kontrol` : 'OK')),
      o.devices ? h('li', { class: `row ${o.devices.length ? 'neutral' : 'warn'}` }, h('span', { class: 'row-main' }, h('strong', {}, 'Bar-iPad'), h('span', {}, deviceLine(o.devices))), h('span', { class: 'row-state' }, 'Kun visning')) : null))));
  // Source line as in the concept; later sources are listed but not connected.
  put(wrap, h('p', { class: 'sources' },
    h('span', { class: `src ${fresh ? 'ok' : 'stale'}` }, `Reservationsmail · ${m.lastSyncAt ? clock(m.lastSyncAt) : 'ikke tjekket'}`),
    ...o.later.map(l => h('span', { class: 'src later' }, `${l.sources} · version ${l.version}, ikke koblet på`))));
  requestAnimationFrame(() => wrap.querySelectorAll('.colfill[data-h]').forEach(b => { b.style.height = `${Math.max(3, Number(b.dataset.h))}%`; }));
  return wrap;
}

// ---------- inbox ----------
function inboxView() {
  const wrap = h('section', {}, h('h1', {}, 'Afventer godkendelse'),
    h('p', { class: 'hint' }, 'Forslag fra reservationsmails. Intet er bekræftet, før en ejer eller manager har godkendt.'));
  if (!S.cases.length) { put(wrap, h('p', { class: 'empty' }, 'Ingen sager afventer.')); return wrap; }
  const list = h('ul', { class: 'cases' });
  for (const c of S.cases) put(list, h('li', {}, h('a', { href: `#/case/${c.id}`, class: `case-card${c.large ? ' large' : ''}` },
    c.large ? h('span', { class: 'badge large' }, 'STOR GRUPPE') : null,
    c.externalReply ? h('span', { class: 'badge warn' }, 'Besvaret i Mail') : null,
    h('span', { class: 'type' }, TYPE[c.type] ?? c.type),
    h('span', { class: 'line' }, `${c.name ?? 'Navn mangler'} · ${c.count ?? '?'} pers. · ${fmtDate(c.date)} ${c.time ?? ''}`),
    c.issues.length ? h('span', { class: 'issues' }, `Mangler/tvetydigt: ${c.issues.map(i => FIELD[i] ?? i).join(', ')}`) : null)));
  put(wrap, list);
  return wrap;
}
const FIELD = { name: 'navn', count: 'antal', date: 'dato', time: 'tid', occasion: 'anledning', notes: 'note' };
const ISSUE = { missing: 'mangler', ambiguous: 'tvetydigt – kontrollér', approximate: 'cirka-angivelse' };
const DETAIL = { weekday_only: 'kun ugedag angivet', multiple_dates: 'flere datoer', weekday_mismatch: 'ugedag passer ikke med dato', multiple_times: 'flere tider',
  twelve_hour: 'tid uden am/pm eller 24-timers format', range: 'interval', multiple_counts: 'flere antal', from_thread: 'fra tidligere mail i tråden' };

// ---------- case review ----------
async function caseView(id) {
  const c = await api(`/cases/${id}`);
  const d = c.draft;
  const decided = !['open', 'answered_externally'].includes(c.status);
  const wrap = h('section', { class: 'case' });
  put(wrap, h('p', {}, h('a', { href: '#/inbox' }, '← Tilbage til listen')),
    h('h1', {}, TYPE[c.type] ?? c.type, ' ', h('span', { class: 'status' }, `(${STATUS[c.status]})`)));
  if (c.large) put(wrap, h('div', { class: 'banner large', role: 'note' }, h('strong', {}, 'STOR GRUPPE'), ` – kræver Mathias’ gennemgang. Intet svar sendes, før Mathias har godkendt.`,
    !c.canApprove ? h('span', {}, ' Du kan læse og redigere, men ikke godkende.') : null));
  if (c.externalReply) put(wrap, h('div', { class: 'banner warn', role: 'note' }, 'Der er svaret direkte fra Mail i denne tråd. Appen sender ikke et svar mere; luk sagen eller registrér uden at sende.'));

  // Original mail as plain text.
  const orig = h('section', { class: 'card' }, h('h2', {}, 'Original mail'));
  for (const m of c.original) put(orig, h('p', { class: 'meta' }, `Fra: ${m.from.name ? `${m.from.name} ` : ''}<${m.from.address}> · ${m.date ? fmtTime(m.date) : ''}`),
    h('p', { class: 'meta' }, `Emne: ${m.subject}`), h('pre', { class: 'mail' }, m.text || '(ingen tekst)'),
    m.truncated ? h('p', { class: 'warn-text' }, 'Mailen var for stor og er afkortet – læs den i Mail.') : null,
    m.attachments ? h('p', { class: 'warn-text' }, `${m.attachments} vedhæftning(er) vises ikke i appen.`) : null);

  // Extracted, editable fields.
  const f = d.fields;
  const fieldForm = h('form', { class: 'card fields', 'aria-label': 'Udtrukne oplysninger' }, h('h2', {}, 'Oplysninger fra mailen'));
  const issue = k => d.issues?.[k] ? h('span', { class: `issue ${d.issues[k]}`, id: `issue-${k}` }, `${ISSUE[d.issues[k]] ?? d.issues[k]}${c.details?.[k] ? ` (${DETAIL[c.details[k]] ?? c.details[k]})` : ''}`) : null;
  const input = (k, label, attrs) => h('div', { class: 'field' }, h('label', { for: `f-${k}` }, label), h('input', { id: `f-${k}`, name: k, ...attrs, 'aria-describedby': d.issues?.[k] ? `issue-${k}` : null, disabled: decided }), issue(k));
  put(fieldForm, 
    input('name', 'Navn', { value: f.name ?? '', maxlength: 80, autocomplete: 'off' }),
    input('count', 'Antal gæster', { type: 'number', min: 1, max: 500, value: f.count ?? '', inputmode: 'numeric' }),
    input('date', 'Dato', { type: 'date', value: f.date ?? '' }),
    c.details?.dateSuggestion && !f.date ? h('p', { class: 'hint' }, `Mulig dato: ${fmtDate(c.details.dateSuggestion)} – kun ugedagen står i mailen. Bekræft selv.`) : null,
    input('time', 'Tidspunkt', { type: 'time', value: f.time ?? '' }),
    h('div', { class: 'field' }, h('label', { for: 'f-occasion' }, 'Anledning/type'),
      h('select', { id: 'f-occasion', name: 'occasion', disabled: decided }, h('option', { value: '' }, '—'),
        ...Object.entries(OCC).map(([k, v]) => h('option', { value: k, selected: f.occasion === k }, v)))),
    h('div', { class: 'field' }, h('label', { for: 'f-notes' }, 'Note'), h('textarea', { id: 'f-notes', name: 'notes', rows: 2, maxlength: 300, disabled: decided }, f.notes ?? '')),
    h('div', { class: 'field' }, h('label', { for: 'f-language' }, 'Svarsprog'),
      h('select', { id: 'f-language', name: 'language', disabled: decided }, h('option', { value: 'da', selected: d.language === 'da' }, 'Dansk'), h('option', { value: 'en', selected: d.language === 'en' }, 'Engelsk')),
      d.languageIssue ? h('span', { class: 'issue ambiguous' }, 'sprog tvetydigt – kontrollér') : null));
  if (!decided) put(fieldForm, h('button', { type: 'submit' }, 'Gem oplysninger og opdatér svar'));
  fieldForm.addEventListener('submit', async ev => {
    ev.preventDefault();
    const fd = new FormData(fieldForm);
    const fields = { name: fd.get('name') || null, count: fd.get('count') ? Number(fd.get('count')) : null, date: fd.get('date') || null,
      time: fd.get('time') || null, occasion: fd.get('occasion') || null, notes: fd.get('notes') || null };
    await saveDraft(c, { fields, language: fd.get('language') });
  });

  // Day context and rules.
  const ctx = h('section', { class: 'card' }, h('h2', {}, 'Dagen og reglerne'));
  put(ctx, c.day ? h('p', {}, `${fmtDate(c.day.date)}: ${c.day.reservations} bekræftede reservationer, ${c.day.guests} gæster.`) : h('p', {}, 'Dato ikke fastlagt.'));
  const acks = new Set();
  const flagList = h('ul', { class: 'flags' });
  for (const fl of d.flags) {
    const li = h('li', { class: `flag ${fl.severity}` });
    if (fl.severity === 'warn' && !decided) {
      const cb = h('input', { type: 'checkbox', id: `ack-${fl.code}`, onchange: e => e.target.checked ? acks.add(fl.code) : acks.delete(fl.code) });
      put(li, cb, h('label', { for: `ack-${fl.code}` }, fl.text, h('span', { class: 'ack-hint' }, ' Jeg har vurderet dette.')));
    } else put(li, h('span', { class: 'sev' }, fl.severity === 'gate' ? 'Spærre: ' : fl.severity === 'warn' ? 'Advarsel: ' : 'Info: '), fl.text);
    put(flagList, li);
  }
  put(ctx, flagList);
  if (c.target) put(ctx, h('p', {}, `Gælder reservation: ${c.target.name ?? ''}, ${c.target.count} pers., ${fmtDate(c.target.date)} ${c.target.time} (${c.target.status === 'cancelled' ? 'Annulleret' : 'Godkendt'})`));
  if (['cancellation', 'change', 'rules_ack'].includes(c.type) && !decided) {
    const sel = h('select', { id: 'target' }, h('option', { value: '' }, '— vælg reservation —'),
      ...c.candidates.map(r => h('option', { value: r.id, selected: r.id === d.targetReservationId }, `${r.name}, ${r.count} pers., ${fmtDate(r.date)} ${r.time}`)));
    put(ctx, h('div', { class: 'field' }, h('label', { for: 'target' }, c.candidates.length ? 'Hvilken reservation gælder det?' : 'Ingen sikker match – vælg i reservationslisten eller luk sagen'), sel,
      h('button', { type: 'button', onclick: () => saveDraft(c, { targetReservationId: sel.value || null }) }, 'Brug valgt reservation')));
  }

  // Reply.
  const reply = h('section', { class: 'card reply' }, h('h2', {}, 'Svar'));
  const tplSel = h('select', { id: 'tpl', disabled: decided }, h('option', { value: '' }, '— intet svar —'),
    ...c.templates.map(t => h('option', { value: t.id, selected: t.id === d.templateId }, `${t.id}. ${t.label}${t.manualOnly ? ' (manuelt valg)' : ''}`)));
  put(reply, h('p', { class: 'hint' }, `Foreslået: ${d.reason ?? '—'}`),
    h('div', { class: 'field' }, h('label', { for: 'tpl' }, 'Skabelon'), tplSel),
    !decided ? h('button', { type: 'button', onclick: () => saveDraft(c, { templateId: tplSel.value ? Number(tplSel.value) : null }) }, 'Brug skabelon') : null,
    h('p', { class: 'effect' }, effectText(d)));
  const extraNeeded = (d.body.match(/\[[^\]\n]{1,40}\]/g) ?? []);
  if (extraNeeded.length) put(reply, h('p', { class: 'warn-text' }, `Udfyld: ${[...new Set(extraNeeded)].join(', ')} – ret i oplysningerne eller direkte i teksten.`));
  put(reply, h('p', { class: 'meta' }, `Til: ${d.to} · Emne: ${d.subject}`));
  const bodyArea = h('textarea', { id: 'body', rows: 14, disabled: decided, 'aria-label': 'Svartekst' }, d.body);
  put(reply, bodyArea);
  if (d.body.includes('{godkender}')) put(reply, h('p', { class: 'hint' }, '{godkender} i signaturen erstattes med navnet på den, der godkender.'));
  if (!decided) put(reply, h('div', { class: 'row' },
    h('button', { type: 'button', onclick: () => saveDraft(c, { body: bodyArea.value }) }, 'Gem tekst'),
    d.bodyEdited ? h('button', { type: 'button', class: 'ghost', onclick: () => saveDraft(c, { body: null }) }, 'Gendan skabelontekst') : null));

  // Approve.
  const approveBox = h('section', { class: 'card approve' }, h('h2', {}, 'Godkendelse'));
  if (!decided) {
    const sendCb = h('input', { type: 'checkbox', id: 'send', checked: d.send, disabled: d.action === 'rules_accept' });
    put(approveBox, 
      h('div', { class: 'field inline' }, sendCb, h('label', { for: 'send' }, 'Send svaret fra reservationsmailen (fravælg hvis allerede besvaret i Mail)')),
      h('button', { type: 'button', class: 'ghost', onclick: () => saveDraft(c, { send: sendCb.checked }) }, 'Gem valg'),
      h('p', { class: 'hint' }, `Du godkender version ${d.version}: modtager, svartekst og ændring som vist ovenfor.`),
      h('button', { type: 'button', class: 'primary', disabled: !c.canApprove, onclick: async ev => {
        ev.target.disabled = true;
        try {
          const r = await api(`/cases/${c.id}/approve`, { method: 'POST', body: { version: d.version, hash: d.hash, acknowledged: [...acks] } });
          say(r.idempotent ? 'Allerede godkendt.' : 'Godkendt.'); await refreshMeta(); route();
        } catch (e) { put(approveBox, errorBox(e)); ev.target.disabled = !c.canApprove; }
      } }, d.send ? (S.session.sendMode === 'draft_only' ? 'Godkend (sendes ikke – kun udkast)' : 'Godkend og send') : 'Godkend uden at sende'),
      h('details', {}, h('summary', {}, 'Luk sagen uden svar'), h('div', { class: 'row' },
        ...[['no_reply_needed', 'Intet svar nødvendigt'], ['answered_in_mail', 'Besvaret i Mail'], ['duplicate', 'Dublet'], ['spam', 'Spam']].map(([k, label]) =>
          h('button', { type: 'button', class: 'ghost', onclick: async () => { try { await api(`/cases/${c.id}/close`, { method: 'POST', body: { reason: k } }); await refreshMeta(); location.hash = '#/inbox'; } catch (e) { put(approveBox, errorBox(e)); } } }, label)))));
  } else {
    put(approveBox, h('p', {}, `Sagen er ${STATUS[c.status].toLowerCase()}.`),
      h('button', { type: 'button', class: 'ghost', onclick: async () => { try { await api(`/cases/${c.id}/reopen`, { method: 'POST', body: {} }); route(); } catch (e) { put(approveBox, errorBox(e)); } } }, 'Opret nyt svar i sagen'));
  }
  for (const o of c.outbox) put(approveBox, outboxRow(o));
  const auditList = h('ul', { class: 'audit' }, ...c.audit.map(a => h('li', {}, `${fmtTime(a.at)} · ${a.actorName} (${a.role}) · ${a.action}${a.version ? ` · v${a.version}` : ''}`)));
  put(approveBox, h('details', {}, h('summary', {}, 'Revisionsspor'), auditList));

  put(wrap, h('div', { class: 'grid' }, h('div', {}, orig, ctx), h('div', {}, fieldForm, reply, approveBox)));
  return wrap;
}
function effectText(d) {
  const t = { confirm: 'Godkendelse opretter en bekræftet reservation.', change: 'Godkendelse ændrer den valgte reservation.', cancel: 'Godkendelse annullerer den valgte reservation (den bevares med status Annulleret).',
    rules_accept: 'Godkendelse registrerer gæstens accept af reglerne. Der sendes intet svar.', reply_only: 'Almindelig korrespondance: reservationslisten ændres ikke.' };
  return t[d.action] ?? '';
}
async function saveDraft(c, patch) {
  try { await api(`/cases/${c.id}/draft`, { method: 'POST', body: { baseVersion: c.draft.version, ...patch } }); say('Gemt som ny version.'); route(); }
  catch (e) { $main.prepend(errorBox(e)); window.scrollTo(0, 0); }
}
function outboxRow(o) {
  const row = h('div', { class: `outbox ${o.status}` }, h('p', {}, h('strong', {}, 'Udsendelse: '), OUT[o.status] ?? o.status, o.verifiedInSent ? ' · fundet i Sendt' : '', o.attempts ? ` · forsøg: ${o.attempts}` : ''));
  const act = (label, path, body = {}) => h('button', { type: 'button', class: 'ghost', onclick: async () => { try { await api(`/outbox/${o.id}/${path}`, { method: 'POST', body }); route(); } catch (e) { put(row, errorBox(e)); } } }, label);
  if (o.status === 'unknown') put(row, h('p', { class: 'warn-text' }, 'Vi ved ikke, om mailen nåede frem. Send ikke igen uden at kontrollere Sendt-mappen.'),
    h('div', { class: 'row' }, act('Kontrollér Sendt-mappen', 'check'), act('Jeg har set den i Sendt – markér som sendt', 'mark-sent'), act('Send igen (accepter mulig dublet)', 'resend', { acceptDuplicateRisk: true })));
  if (o.status === 'failed') put(row, act('Prøv igen', 'resend'));
  return row;
}

// ---------- reservations ----------
async function reservationsView() {
  const from = sessionStorage.getItem('hos-from') || todayCph();
  const list = await api(`/reservations?from=${from}&days=14`);
  const wrap = h('section', {}, h('h1', {}, 'Reservationer'));
  const dateIn = h('input', { type: 'date', id: 'from', value: from });
  put(wrap, h('div', { class: 'row' }, h('label', { for: 'from' }, 'Fra dato'), dateIn,
    h('button', { type: 'button', onclick: () => { sessionStorage.setItem('hos-from', dateIn.value || todayCph()); route(); } }, 'Vis 14 dage'),
    h('button', { type: 'button', class: 'ghost', onclick: () => { sessionStorage.removeItem('hos-from'); route(); } }, 'I dag')));
  if (!list.length) { put(wrap, h('p', { class: 'empty' }, 'Ingen reservationer i perioden.')); return wrap; }
  const byDay = {};
  for (const r of list) (byDay[r.date] ??= []).push(r);
  for (const [day, rows] of Object.entries(byDay)) {
    const active = rows.filter(r => r.status === 'confirmed');
    const table = h('table', { class: 'res' }, h('caption', {}, `${fmtDate(day)} – ${active.length} aktive, ${active.reduce((s, r) => s + r.count, 0)} gæster`),
      h('thead', {}, h('tr', {}, ...['Tid', 'Status', 'Navn', 'Antal', 'Anledning', 'Regler', 'Note', 'Svar'].map(t => h('th', { scope: 'col' }, t)), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Handlinger')))));
    const tb = h('tbody');
    for (const r of rows) {
      const cancelled = r.status === 'cancelled';
      const confirmBox = h('div', { class: 'confirm-cancel', hidden: true }, h('span', {}, 'Annullér reservationen?'),
        h('button', { type: 'button', class: 'danger', onclick: async () => { try { await api(`/reservations/${r.id}/cancel`, { method: 'POST', body: { reason: 'manual' } }); say('Annulleret.'); route(); } catch (e) { tb.before(errorBox(e)); } } }, 'Ja, annullér'),
        h('button', { type: 'button', class: 'ghost', onclick: () => { confirmBox.hidden = true; } }, 'Fortryd'));
      put(tb, h('tr', { class: cancelled ? 'cancelled' : null },
        h('td', { 'data-label': 'Tid' }, r.time),
        h('td', { 'data-label': 'Status' }, cancelled ? h('span', { class: 'chip-st bad status-cancel' }, `Annulleret ${r.cancelledAt ? fmtTime(r.cancelledAt) : ''}`) : h('span', { class: 'chip-st good' }, '✓ Godkendt')),
        h('td', { 'data-label': 'Navn' }, r.name ?? 'Anonymiseret'), h('td', { 'data-label': 'Antal' }, String(r.count)),
        h('td', { 'data-label': 'Anledning' }, OCC[r.occasion] ?? '—'),
        h('td', { 'data-label': 'Regler' }, r.rulesAccepted === 'accepted' ? h('span', { class: 'chip-st good' }, '✓ Accepteret') : r.rulesAccepted === 'pending' ? h('span', { class: 'chip-st warn' }, '● Afventer ok') : h('span', { class: 'chip-st' }, 'Ikke krævet'), ' ', !cancelled && r.rulesAccepted !== 'not_required' ? h('button', { type: 'button', class: 'link', onclick: async () => { await api(`/reservations/${r.id}/rules`, { method: 'POST', body: { accepted: r.rulesAccepted !== 'accepted' } }); route(); } }, r.rulesAccepted === 'accepted' ? 'Nulstil' : 'Markér accepteret') : null),
        h('td', { 'data-label': 'Note' }, r.note ?? ''),
        h('td', { 'data-label': 'Svar' }, r.outbox.map(o => OUT[o.status] ?? o.status).join(', ') || '—'),
        h('td', {}, !cancelled ? h('button', { type: 'button', class: 'ghost', onclick: () => { confirmBox.hidden = false; } }, 'Annullér') : null, confirmBox)));
    }
    put(table, tb);
    put(wrap, h('div', { class: 'table-wrap' }, table));
  }
  return wrap;
}

// ---------- tasks ----------
async function tasksView() {
  const [tasks, members] = await Promise.all([api('/tasks'), api('/members')]);
  const staff = members.filter(m => m.enabled);
  const name = id => staff.find(m => m.id === id)?.name ?? members.find(m => m.id === id)?.name ?? '—';
  // As in the concept's mobile screen: list first (urgent on top), then the short new-task form.
  const wrap = h('section', {}, h('div', { class: 'page-head' }, h('h1', {}, 'Opgaver'),
    h('button', { type: 'button', class: 'dark', onclick: () => { form.scrollIntoView({ behavior: 'smooth' }); form.querySelector('#t-desc').focus(); } }, '+ Ny')));
  const form = h('form', { class: 'card task-form' }, h('h2', {}, 'Ny opgave'),
    h('div', { class: 'field' }, h('label', { for: 't-photo' }, 'Billede (valgfrit)'), h('input', { id: 't-photo', type: 'file', accept: 'image/jpeg,image/png,image/webp', capture: 'environment' })),
    h('div', { class: 'field' }, h('label', { for: 't-desc' }, 'Beskrivelse'), h('textarea', { id: 't-desc', rows: 2, required: true, maxlength: 1000 })),
    h('fieldset', {}, h('legend', {}, 'Prioritet'),
      h('label', {}, h('input', { type: 'radio', name: 'prio', value: 'normal', checked: true }), ' Normal'),
      h('label', {}, h('input', { type: 'radio', name: 'prio', value: 'urgent' }), ' Akut')),
    h('div', { class: 'field' }, h('label', { for: 't-loc' }, 'Lokation'), h('input', { id: 't-loc', maxlength: 120 })),
    h('div', { class: 'field' }, h('label', { for: 't-who' }, 'Ansvarlig'), h('select', { id: 't-who', required: true }, ...staff.map(m => h('option', { value: m.id }, m.name)))),
    h('button', { type: 'submit', class: 'primary' }, 'Opret opgave'));
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const file = form.querySelector('#t-photo').files[0];
      const photo = file ? await shrink(file) : null;
      await api('/tasks', { method: 'POST', body: { description: form.querySelector('#t-desc').value, priority: form.querySelector('input[name=prio]:checked').value,
        location: form.querySelector('#t-loc').value, assigneeId: form.querySelector('#t-who').value, photo } });
      say('Opgave oprettet.'); route();
    } catch (e) { put(form, errorBox(e)); btn.disabled = false; }
  });
  if (!tasks.length) put(wrap, h('p', { class: 'empty' }, 'Ingen opgaver.'));
  const list = h('ul', { class: 'tasks' });
  for (const t of tasks) {
    const img = h('img', { alt: t.photo ? `Billede til opgave: ${t.description.slice(0, 60)}` : '', class: 'thumb', hidden: !t.photo });
    if (t.photo) loadPhoto(t.id, img);
    const sel = h('select', { 'aria-label': 'Status', onchange: async e => { await api(`/tasks/${t.id}`, { method: 'POST', body: { status: e.target.value } }); route(); } },
      ...[['open', 'Åben'], ['in_progress', 'I gang'], ['resolved', 'Løst']].map(([k, v]) => h('option', { value: k, selected: t.status === k }, v)));
    put(list, h('li', { class: `task ${t.priority}${t.status === 'resolved' ? ' done' : t.status === 'in_progress' ? ' in-progress' : ''}` }, img,
      h('div', {}, t.priority === 'urgent' ? h('span', { class: 'badge urgent' }, 'AKUT') : h('span', { class: 'badge' }, 'Normal'),
        h('p', { class: 'desc' }, t.description), h('p', { class: 'meta' }, `${t.location || 'Ingen lokation'} · Ansvarlig: ${name(t.assigneeId)} · ${fmtTime(t.createdAt)}`), sel)));
  }
  put(wrap, list, form);
  return wrap;
}
async function loadPhoto(id, img) {
  try {
    const res = await fetch(`/api/c/${S.instance.company.id}/tasks/${id}/photo`, { headers: { Authorization: `Bearer ${S.token}` } });
    if (res.ok) img.src = URL.createObjectURL(await res.blob());
  } catch { /* thumbnail is optional */ }
}
// Re-encode in the browser: applies orientation, drops metadata and keeps uploads small.
async function shrink(file) {
  if (file.size > 15 * 1024 * 1024) throw Object.assign(new Error(), { code: 'photo_too_large' });
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw Object.assign(new Error(), { code: 'photo_type_not_allowed' });
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.82);
}

// ---------- settings ----------
async function settingsView() {
  const owner = S.session.user.role === 'owner';
  const [st, members, devices] = await Promise.all([api('/settings'), api('/members'), owner ? api('/devices') : Promise.resolve([])]);
  const wrap = h('section', {}, h('h1', {}, 'Indstillinger'));
  put(wrap, h('section', { class: 'card' }, h('h2', {}, 'Reservationsmail'),
    h('p', {}, `${st.mailAddress} (${st.provider})`),
    h('p', {}, `Afsendelse: ${st.sendMode === 'draft_only' ? 'Kun udkast – intet sendes (server-låst)' : st.sendMode === 'test_accounts' ? 'Kun godkendte testadresser' : 'Live'}`),
    h('p', {}, `Stor gruppe fra ${st.largeGroupMin} gæster · seneste reservationstid ${st.latestTime}`),
    h('button', { type: 'button', onclick: async ev => { ev.target.disabled = true; try { const r = await api('/mail/sync', { method: 'POST', body: {} }); say(`Tjekket: ${r.inbound} nye mails.`); await refreshMeta(); route(); } catch (e) { put(wrap, errorBox(e)); } } }, 'Tjek mail nu')));
  const sig = h('textarea', { id: 'sig', rows: 3, maxlength: 500, disabled: !owner }, st.signature ?? '');
  put(wrap, h('section', { class: 'card' }, h('h2', {}, 'Signatur'),
    h('p', { class: 'hint' }, 'Svar sendt fra appen får ikke Apple Mails signatur – kun teksten her. Skriv {godkender}, hvor navnet på den, der godkender svaret, skal stå.'),
    !st.signature ? h('p', { class: 'warn-text' }, 'Ingen signatur er sat: svar fra appen sendes uden signatur.') : null,
    h('label', { for: 'sig' }, 'Signatur til svar fra appen'), sig,
    owner ? h('button', { type: 'button', onclick: async () => { await api('/settings', { method: 'POST', body: { signature: sig.value } }); say('Signatur gemt.'); route(); } }, 'Gem signatur') : h('p', { class: 'hint' }, 'Kun ejere kan ændre indstillinger.')));

  const mlist = h('ul', { class: 'members' });
  for (const m of members) put(mlist, h('li', {}, `${m.name} – ${m.role === 'owner' ? 'Ejer' : 'Manager'}${m.enabled ? '' : ' (deaktiveret)'}${m.largeGroupApprover ? ' · godkender store grupper' : ''}${m.email ? ` · ${m.email}` : ''}`,
    owner ? h('button', { type: 'button', class: 'link', onclick: async () => { try { await api(`/members/${m.id}`, { method: 'POST', body: { enabled: !m.enabled } }); route(); } catch (e) { mlist.after(errorBox(e)); } } }, m.enabled ? 'Deaktivér' : 'Aktivér') : null));
  const access = h('section', { class: 'card' }, h('h2', {}, 'Adgange'), mlist);
  if (owner) {
    const inv = h('form', { class: 'row' }, h('label', { for: 'inv-name' }, 'Navn'), h('input', { id: 'inv-name', required: true, maxlength: 60 }),
      h('label', { for: 'inv-email' }, 'Firmamail'), h('input', { id: 'inv-email', type: 'email', required: true }),
      h('label', { for: 'inv-role' }, 'Rolle'), h('select', { id: 'inv-role' }, h('option', { value: 'manager' }, 'Manager'), h('option', { value: 'owner' }, 'Ejer')),
      h('button', { type: 'submit' }, 'Invitér'));
    inv.addEventListener('submit', async ev => { ev.preventDefault(); try { await api('/members', { method: 'POST', body: { name: inv.querySelector('#inv-name').value, email: inv.querySelector('#inv-email').value, role: inv.querySelector('#inv-role').value } }); route(); } catch (e) { inv.after(errorBox(e)); } });
    put(access, inv);
  } else put(access, h('p', { class: 'hint' }, 'Kun ejere kan ændre adgange.'));
  put(wrap, access);

  if (owner) {
    const dev = h('section', { class: 'card' }, h('h2', {}, 'iPad-visning'),
      h('p', { class: 'hint' }, 'Én fælles visning pr. bar. Opret en engangskode og indtast den på iPaden under /device. Koden udløber efter 10 minutter.'),
      S.instance.demo ? h('p', { class: 'warn-text' }, 'Demo: alt gemmes kun i denne browser, så en kode herfra virker ikke på en anden enhed. Åbn ', h('a', { href: 'device.html' }, 'iPad-visningen'), ' i samme browser, eller tryk »Prøv iPad-visningen« direkte på iPaden.') : null);
    const codeOut = h('p', { class: 'code', 'aria-live': 'polite' });
    put(dev, h('button', { type: 'button', onclick: async () => { const r = await api('/devices/pairing', { method: 'POST', body: { label: 'Bar-iPad' } }); codeOut.textContent = `Kode: ${r.code} (gyldig i 10 minutter)`; } }, 'Opret parringskode'), codeOut);
    const dl = h('ul', {});
    for (const d of devices) put(dl, h('li', {}, `${d.label} · oprettet ${fmtTime(d.createdAt)} · udløber ${fmtTime(d.expiresAt)} · ${d.revokedAt ? 'Tilbagekaldt' : d.expiresAt < nowMs() ? 'Udløbet' : 'Aktiv'}${d.lastSeenAt ? ` · sidst set ${fmtTime(d.lastSeenAt)}` : ''}`,
      !d.revokedAt ? h('button', { type: 'button', class: 'danger', onclick: async () => { await api(`/devices/${d.id}/revoke`, { method: 'POST', body: {} }); route(); } }, 'Tilbagekald') : null));
    put(dev, dl, h('p', { class: 'hint' }, 'Tilbagekaldelse virker, når iPaden er online. Oplysninger, der allerede vises på skærmen, kan ikke fjernes fra en offline iPad. Brug kode og automatisk lås på iPaden.'));
    put(wrap, dev);
  }
  put(wrap, h('section', { class: 'card' }, h('h2', {}, 'Konto og visning'),
    h('p', {}, `${S.session.user.name} · ${ROLE[S.session.user.role]} · ${S.instance.company.displayName ?? S.instance.company.name}`),
    h('div', { class: 'row' },
      h('button', { type: 'button', onclick: () => { setTheme(theme() === 'aften' ? 'dag' : 'aften'); route(); } }, `Tema: ${theme() === 'aften' ? 'Aften' : 'Dag'}`),
      (S.session.companies ?? []).length > 1 ? h('a', { href: '#/choose', class: 'linkish' }, 'Skift virksomhed →') : null,
      h('button', { type: 'button', class: 'ghost', onclick: logout }, 'Log ud'))));
  put(wrap, pushCard());
  if (S.instance.devLogin && !S.instance.demo) put(wrap, await devCard());
  return wrap;
}
function pushCard() {
  const card = h('section', { class: 'card' }, h('h2', {}, 'Push-notifikationer'));
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  put(card, h('p', { class: 'hint' }, 'Push er en ekstra kanal uden gæstenavne. Listen øverst i appen er altid den gældende.'));
  if (ios && !standalone) put(card, h('p', {}, 'På iPhone/iPad (iOS/iPadOS 16.4 eller nyere): tryk Del → "Føj til hjemmeskærm" og åbn appen derfra for at kunne slå push til.'));
  else if (!supported) put(card, h('p', {}, 'Denne browser understøtter ikke web-push.'));
  else if (!S.session.push.publicKey) put(card, h('p', {}, `Push-afsendelse er ikke konfigureret på serveren (lokal tilstand: ${S.session.push.mode}).`));
  else put(card, h('button', { type: 'button', onclick: async () => {
    try {
      if (await Notification.requestPermission() !== 'granted') return say('Tilladelse ikke givet.');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: S.session.push.publicKey });
      await api('/push/subscribe', { method: 'POST', body: sub.toJSON() }); say('Push slået til.');
    } catch (e) { put(card, errorBox(e)); }
  } }, 'Slå push til på denne enhed'));
  return card;
}
async function devCard() {
  const names = await api('/api/dev/scenarios');
  const sel = h('select', { id: 'scenario' }, ...names.map(n => h('option', { value: n }, n)));
  const smtp = h('select', { id: 'smtp' }, ...['ok', 'reject', 'timeout', 'timeout_after_accept'].map(n => h('option', { value: n }, n)));
  const out = h('p', { 'aria-live': 'polite' });
  return h('section', { class: 'card dev' }, h('h2', {}, 'Lokal test (syntetisk)'),
    h('p', { class: 'hint' }, 'Lægger en syntetisk mail i den falske postkasse. Ingen rigtige konti bruges.'),
    h('label', { for: 'scenario' }, 'Scenarie'), sel,
    h('button', { type: 'button', onclick: async () => { const r = await api('/api/dev/deliver', { method: 'POST', body: { scenario: sel.value } }); const s = await api('/mail/sync', { method: 'POST', body: {} }); out.textContent = `Leveret ${r.scenario}; ${s.inbound} nye i indbakken, ${s.sent} i Sendt.`; await refreshMeta(); header(); } }, 'Lever og tjek mail'),
    h('label', { for: 'smtp' }, 'Falsk SMTP-udfald (kun i testtilstand)'), smtp,
    h('button', { type: 'button', class: 'ghost', onclick: async () => { await api('/api/dev/smtp-mode', { method: 'POST', body: { mode: smtp.value } }); out.textContent = `SMTP: ${smtp.value}`; } }, 'Sæt SMTP-udfald'), out);
}

// ---------- routing ----------
async function route() {
  if (!S.session) return;
  const hash = location.hash || '#/home';
  let view;
  try {
    await refreshMeta();
    if (hash === '#/choose') view = chooserView();
    else if (hash.startsWith('#/case/')) view = await caseView(decodeURIComponent(hash.slice(7)));
    else if (hash === '#/reservations') view = await reservationsView();
    else if (hash === '#/tasks') view = await tasksView();
    else if (hash === '#/settings') view = await settingsView();
    else if (hash === '#/inbox') view = inboxView();
    else view = await homeView();
  } catch (e) { view = h('section', {}, errorBox(e)); }
  header();
  $main.replaceChildren(view);
  // Move focus to the new heading on navigation, but not on first load (skip link stays first).
  const h1 = $main.querySelector('h1');
  if (h1) { h1.tabIndex = -1; if (S.navigated) h1.focus({ preventScroll: true }); }
  S.navigated = true;
}
async function start() {
  try {
    S.session = await api('/session');
    await refreshMeta();
  } catch (e) { S.session = null; header(); $main.replaceChildren(await loginView()); $main.querySelector('form')?.append(errorBox(e)); return; }
  clearInterval(S.poll);
  S.poll = setInterval(async () => { try { await refreshMeta(); header(); } catch { /* offline: keep showing last state */ } }, 30_000);
  // Someone with access to both companies chooses one after logging in (one at a time, never combined).
  if (S.justLoggedIn && (S.session.companies ?? []).length > 1) { S.justLoggedIn = false; location.hash = '#/choose'; if (location.hash === '#/choose') return route(); }
  S.justLoggedIn = false;
  route();
}
async function render() {
  header();
  if (!S.token) { $main.replaceChildren(await loginView()); return; }
  await start();
}
window.addEventListener('hashchange', () => { S.showNotes = false; route(); }); // the notification panel closes on navigation
window.addEventListener('offline', () => { document.body.classList.add('offline'); say('Ingen forbindelse.'); });
window.addEventListener('online', () => { document.body.classList.remove('offline'); say('Forbindelse genoprettet.'); });
// No service worker in the static demo.
(async () => {
  try { S.instance = await api('/api/instance'); } catch (e) { $main.replaceChildren(errorBox(e)); return; }
  document.title = `Driftsoverblik – ${S.instance.company.displayName ?? S.instance.company.name}`;
  if (S.instance.demo) { S.instance.loadedAt = Date.now(); document.body.classList.add('demo'); }
  // Local only: the company chooser hands over to the other company's separate app (loopback dev login).
  const handoff = /^#\/dev-login\/(.+)$/.exec(location.hash);
  if (handoff && S.instance.devLogin) {
    try { const { token } = await api('/api/dev/login', { method: 'POST', body: { email: decodeURIComponent(handoff[1]) } }); S.token = token; sessionStorage.setItem('hos-token', token); } catch { /* falls back to the login page */ }
    history.replaceState(null, '', '#/home');
  }
  render();
})();
