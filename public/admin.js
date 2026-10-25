// ============================================================
// Админка: заявки, оценка, объекты, контент, цены, команда, настройки, пользователи.
// Права проверяет RLS в базе; здесь — только удобный интерфейс.
// ============================================================
import {
  DEMO, db, auth, getSettings, esc, num, money, moneyShort, fmtDateRu, fmtDateTimeRu, icon, logoMark, planSvg, toast, errText,
  openModal, uploadFile, signedUrl, phoneDigits, waLink, formatPhone, makeMap, pricePin, listingTitle, applyTheme, toggleTheme, store,
  DEAL, PTYPE, LISTING_STATUS, LEAD_KIND, LEAD_STATUS, VAL_CAT, VAL_STATUS, SERVICE_CAT, demoReset, link
} from './app.js';

const app = document.getElementById('app');
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const toNum = v => { const s = String(v ?? '').replace(/\s/g, '').replace(',', '.'); return s === '' ? null : Number(s); };

let profile = null, settings = null;
const cache = {};
async function ref(table, opts) {
  if (!cache[table]) cache[table] = await db.list(table, opts || { order: 'id' });
  return cache[table];
}
const drop = (...tables) => tables.forEach(t => delete cache[t]);
const isAdmin = () => profile?.role === 'admin';

// ============================================================
// Вход
// ============================================================
async function start() {
  if (location.hash.includes('type=recovery')) return recoveryScreen();
  const user = await auth.user().catch(() => null);
  if (!user) return loginScreen();
  profile = await auth.profile().catch(e => { toast(errText(e), true); return null; });
  if (!profile) return loginScreen('Профиль не найден. Попробуйте войти заново.');
  if (profile.role === 'user') return pendingScreen();
  settings = await getSettings();
  shell();
}

async function loginScreen(msg = '') {
  const hasAdmin = DEMO ? true : await db.rpc('has_admin').catch(() => true);
  app.innerHTML = `<div class="wrap"><div class="login-box stack" style="gap:18px">
    <a class="logo" href="index.html">${logoMark()}<span><span class="logo-name">Qadam</span><span class="logo-sub">кабинет сотрудника</span></span></a>
    ${DEMO ? `<div class="callout">Демо-режим: база не подключена. Вход без пароля, изменения сохраняются только в этом браузере.</div>` : ''}
    ${!hasAdmin ? `<div class="callout"><b>Первичная настройка.</b> Администратора ещё нет — первый созданный аккаунт получит полные права. Остальные сотрудники регистрируются здесь же, а вы выдаёте им роль в разделе «Пользователи».</div>` : ''}
    <div class="panel-box stack">
      <div class="seg" id="mode" role="group">
        <button type="button" data-m="in" aria-pressed="${hasAdmin}">Вход</button>
        <button type="button" data-m="up" aria-pressed="${!hasAdmin}">${hasAdmin ? 'Регистрация сотрудника' : 'Создать администратора'}</button>
      </div>
      <form class="stack" id="lf" novalidate>
        <div class="field" data-up hidden><label for="l-name">Имя и фамилия</label><input class="input" id="l-name" autocomplete="name"></div>
        <div class="field"><label for="l-email">E-mail</label><input class="input" id="l-email" type="email" autocomplete="email" ${DEMO ? 'value="demo@qadam.kz"' : ''}></div>
        <div class="field"><label for="l-pass">Пароль</label><input class="input" id="l-pass" type="password" autocomplete="current-password" ${DEMO ? 'value="demo"' : ''}></div>
        <p class="error-text" id="l-err" ${msg ? '' : 'hidden'}>${esc(msg)}</p>
        <button class="btn lg block" type="submit" id="l-go">Войти</button>
        <button class="btn ghost sm" type="button" id="l-forgot" data-in>Забыли пароль?</button>
      </form>
    </div>
    <a class="small" href="index.html">← На сайт</a>
  </div></div>`;
  let mode = hasAdmin ? 'in' : 'up';
  const setMode = m => {
    mode = m;
    $$('#mode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === m));
    $$('[data-up]').forEach(e => { e.hidden = m !== 'up'; });
    $$('[data-in]').forEach(e => { e.hidden = m !== 'in'; });
    $('#l-go').textContent = m === 'in' ? 'Войти' : 'Создать аккаунт';
    $('#l-pass').autocomplete = m === 'in' ? 'current-password' : 'new-password';
  };
  setMode(mode);
  $('#mode').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.m); });
  $('#l-forgot').addEventListener('click', async () => {
    const email = $('#l-email').value.trim();
    if (!email) return showErr('Введите e-mail, на который отправить ссылку.');
    try { await auth.resetPassword(email); toast('Письмо со ссылкой для смены пароля отправлено'); } catch (e) { showErr(errText(e)); }
  });
  function showErr(t) { $('#l-err').textContent = t; $('#l-err').hidden = false; }
  $('#lf').addEventListener('submit', async e => {
    e.preventDefault();
    $('#l-err').hidden = true;
    const email = $('#l-email').value.trim(), pass = $('#l-pass').value;
    if (!DEMO && (!email || pass.length < 6)) return showErr('Введите e-mail и пароль не короче 6 символов.');
    const btn = $('#l-go'); btn.disabled = true;
    try {
      if (mode === 'in') { await auth.signIn(email, pass); return start(); }
      const res = await auth.signUp(email, pass, $('#l-name').value.trim());
      if (res?.session || DEMO) return start();
      app.querySelector('.panel-box').innerHTML = `<div class="success-state"><div class="tick">${icon('mail')}</div><h3>Проверьте почту</h3>
        <p class="muted">Мы отправили письмо на ${esc(email)}. Перейдите по ссылке в письме, затем вернитесь сюда и войдите.</p>
        <button class="btn" type="button" onclick="location.reload()">Ко входу</button></div>`;
    } catch (ex) { showErr(errText(ex)); btn.disabled = false; }
  });
}

function recoveryScreen() {
  app.innerHTML = `<div class="wrap"><div class="login-box panel-box stack">
    <h2 style="font-size:var(--fs-xl)">Новый пароль</h2>
    <form class="stack" id="rf"><div class="field"><label for="r-pass">Пароль (не короче 6 символов)</label><input class="input" id="r-pass" type="password" autocomplete="new-password"></div>
    <p class="error-text" id="r-err" hidden></p><button class="btn" type="submit">Сохранить пароль</button></form></div></div>`;
  $('#rf').addEventListener('submit', async e => {
    e.preventDefault();
    try { await auth.updatePassword($('#r-pass').value); history.replaceState(null, '', 'admin.html'); toast('Пароль изменён'); start(); }
    catch (ex) { $('#r-err').textContent = errText(ex); $('#r-err').hidden = false; }
  });
}

function pendingScreen() {
  app.innerHTML = `<div class="wrap"><div class="login-box panel-box stack">
    <h2 style="font-size:var(--fs-xl)">Доступ ещё не выдан</h2>
    <p class="muted">Аккаунт ${esc(profile.email || '')} создан. Попросите администратора открыть раздел «Пользователи» и назначить вам роль агента.</p>
    <div class="row"><button class="btn ghost" type="button" id="out">Выйти</button><button class="btn" type="button" onclick="location.reload()">Проверить снова</button></div></div></div>`;
  $('#out').addEventListener('click', async () => { await auth.signOut(); location.reload(); });
}

// ============================================================
// Каркас
// ============================================================
const TABS = [
  ['dash', 'Обзор', 'chart', false],
  ['leads', 'Заявки', 'chat', false],
  ['valuations', 'Оценка', 'ruler', false],
  ['listings', 'Объекты', 'house', false],
  ['reviews', 'Отзывы', 'star', true],
  ['content', 'Контент сайта', 'book', true],
  ['prices', 'Цены и коэффициенты', 'calc', true],
  ['team', 'Команда', 'user', true],
  ['settings', 'Настройки', 'pen', true],
  ['users', 'Пользователи', 'shield', true]
];
let current = null;
function shell() {
  const tabs = TABS.filter(t => !t[3] || isAdmin());
  app.innerHTML = `<div class="admin">
    <aside class="admin-side" id="side">
      <a class="logo" href="index.html" target="_blank">${logoMark()}<span><span class="logo-name">${esc(settings.company.name)}</span><span class="logo-sub">админка</span></span></a>
      <nav class="admin-nav stack" style="gap:2px">${tabs.map(([k, l, ic]) => `<button type="button" data-tab="${k}"><span class="row" style="gap:10px">${icon(ic)}${l}</span><span class="cnt" data-cnt="${k}" hidden></span></button>`).join('')}</nav>
      <div style="margin-top:auto" class="stack">
        <div class="small muted" style="padding:0 8px">${esc(profile.full_name || profile.email || '')}<br><span class="xs">${profile.role === 'admin' ? 'администратор' : 'агент'}</span></div>
        <div class="row" style="padding:0 8px">
          <button class="icon-btn" type="button" id="theme" aria-label="Тема">${icon('moon')}</button>
          <a class="icon-btn" href="index.html" target="_blank" aria-label="Открыть сайт">${icon('eye')}</a>
          <button class="icon-btn" type="button" id="logout" aria-label="Выйти">${icon('logout')}</button>
        </div>
        ${DEMO ? '<button class="btn ghost sm" type="button" id="demo-reset">Сбросить демо-данные</button>' : ''}
      </div>
    </aside>
    <div>
      <div class="admin-mobile-top"><button class="icon-btn" type="button" id="burger" aria-label="Меню">${icon('menu')}</button><b id="m-title"></b></div>
      <main class="admin-main" id="main"></main>
    </div>
  </div>`;
  $('#side').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (b) { go(b.dataset.tab); $('#side').classList.remove('open'); }
  });
  $('#burger').addEventListener('click', () => $('#side').classList.toggle('open'));
  $('#theme').addEventListener('click', toggleTheme);
  $('#logout').addEventListener('click', async () => { await auth.signOut(); location.reload(); });
  $('#demo-reset')?.addEventListener('click', () => confirmBox('Вернуть демо-данные к исходным? Ваши изменения в этом браузере пропадут.', demoReset));
  const initial = location.hash.slice(1);
  go(tabs.find(t => t[0] === initial) ? initial : 'dash');
  refreshCounters();
  setInterval(refreshCounters, 60000);
}
async function refreshCounters() {
  try {
    const [leads, vals, revs] = await Promise.all([
      db.list('leads', { eq: { status: 'new' }, select: 'id' }),
      db.list('valuation_orders', { eq: { status: 'new' }, select: 'id' }),
      isAdmin() ? db.list('reviews', { eq: { is_published: false }, select: 'id' }) : []
    ]);
    const set = (k, n) => { const el = $(`[data-cnt="${k}"]`); if (el) { el.textContent = n; el.hidden = !n; } };
    set('leads', leads.length); set('valuations', vals.length); set('reviews', revs.length);
  } catch { /* счётчики не критичны */ }
}
function go(tab) {
  current = tab;
  $$('#side [data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
  const t = TABS.find(x => x[0] === tab);
  $('#m-title').textContent = t[1];
  try { history.replaceState(null, '', '#' + tab); } catch { /* предпросмотр */ }
  const main = $('#main');
  main.onclick = null;
  main.innerHTML = '<p class="muted">Загрузка…</p>';
  VIEWS[tab](main).catch(e => { console.error(e); main.innerHTML = `<div class="notice">Ошибка: ${esc(errText(e))}</div>`; });
}

// ---------- Общие элементы ----------
function head(title, actions = '') {
  return `<div class="admin-top"><h1>${esc(title)}</h1><div class="row">${actions}</div></div>`;
}
function statusClass(s) {
  return { new: 'st-new', in_work: 'st-work', meeting: 'st-work', deal: 'st-work', agreed: 'st-work', inspection: 'st-work', report: 'st-work',
    done: 'st-done', published: 'st-done', rejected: 'st-bad', cancelled: 'st-bad', draft: 'st-off', archived: 'st-off', reserved: 'st-work', sold: 'st-off' }[s] || 'st-off';
}
function confirmBox(text, onYes, yesLabel = 'Да, выполнить') {
  const { el, close } = openModal(`<div class="modal-head"><h2>Подтвердите</h2><button class="icon-btn" type="button" data-close aria-label="Закрыть">${icon('close')}</button></div>
    <p>${esc(text)}</p><div class="row" style="justify-content:flex-end"><button class="btn ghost" type="button" data-close>Отмена</button><button class="btn danger" type="button" id="yes">${esc(yesLabel)}</button></div>`);
  $('#yes', el).addEventListener('click', async () => { close(); await onYes(); });
}
function downloadCsv(name, rows) {
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name; document.body.append(a); a.click(); a.remove();
}
function contactLinks(phone, text = '') {
  const d = phoneDigits(phone);
  return d ? `<a class="mono" href="tel:+${d}">${esc(phone)}</a> · <a href="${waLink(d, text)}" target="_blank" rel="noopener">WhatsApp</a>` : '';
}
async function attachments(bucket, paths) {
  if (!paths?.length) return '';
  const urls = await Promise.all(paths.map(p => signedUrl(bucket, p).catch(() => null)));
  return `<div class="att">${urls.map((u, i) => u ? (/\.pdf($|\?)/i.test(paths[i]) ? `<a href="${esc(u)}" target="_blank" rel="noopener">PDF</a>` : `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt=""></a>`) : '').join('')}</div>`;
}

// ============================================================
// Разделы
// ============================================================
const VIEWS = {};

// ---------- Обзор ----------
VIEWS.dash = async main => {
  const [leads, vals, listings, revs, priv] = await Promise.all([
    db.list('leads', { order: ['created_at', 'desc'] }),
    db.list('valuation_orders', { order: ['created_at', 'desc'] }),
    db.list('listings'),
    isAdmin() ? db.list('reviews', { eq: { is_published: false } }) : [],
    isAdmin() ? db.list('private_settings').catch(() => []) : []
  ]);
  const week = Date.now() - 7 * 86400000;
  const published = listings.filter(l => l.status === 'published');
  const views = listings.reduce((a, l) => a + (l.views || 0), 0);
  const c = settings.contacts;
  const demoListings = listings.filter(l => l.is_demo).length;
  const tgOk = priv.find(p => p.key === 'telegram_bot_token')?.value && priv.find(p => p.key === 'telegram_chat_id')?.value;
  const setup = isAdmin() ? [
    [c.phone && !/000-00-00/.test(c.phone), 'Телефон, WhatsApp и адрес офиса', 'settings'],
    [settings.company.legal_name && !/укажите/i.test(settings.company.legal_name), 'Название компании и БИН', 'settings'],
    [tgOk, 'Уведомления о заявках в Telegram', 'settings'],
    [!demoListings, demoListings ? `Удалить демо-объекты (${demoListings}) и добавить свои` : 'Демо-объекты удалены', 'listings'],
    [!(cache.agents || []).some(a => a.is_demo), 'Заменить демо-команду на своих сотрудников', 'team'],
    [true, 'Проверить цены м² по своим городам', 'prices']
  ] : [];
  if (isAdmin() && !cache.agents) { cache.agents = await db.list('agents', { order: 'sort' }); setup[4][0] = !cache.agents.some(a => a.is_demo); }
  const kpi = (n, t, attn) => `<div class="kpi ${attn ? 'attn' : ''}"><b>${num(n)}</b><span>${t}</span></div>`;
  main.innerHTML = head('Обзор', `<a class="btn ghost sm" href="index.html" target="_blank">${icon('eye')} Открыть сайт</a>`) + `
    <div class="kpis">
      ${kpi(leads.filter(l => l.status === 'new').length, 'новых заявок', leads.some(l => l.status === 'new'))}
      ${kpi(leads.filter(l => Date.parse(l.created_at) > week).length, 'заявок за 7 дней')}
      ${kpi(vals.filter(v => v.status === 'new').length, 'новых заказов на оценку', vals.some(v => v.status === 'new'))}
      ${kpi(published.length, 'объектов опубликовано')}
      ${kpi(views, 'просмотров объектов')}
      ${isAdmin() ? kpi(revs.length, 'отзывов на модерации', revs.length) : ''}
    </div>
    <div class="grid g2" style="align-items:start">
      <div class="panel-box stack"><div class="row between"><h3>Последние заявки</h3><button class="btn ghost sm" type="button" data-go="leads">Все</button></div>
        <div class="stack" style="gap:0">${leads.slice(0, 6).map(l => `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)">
          <span><span class="status ${statusClass(l.status)}">${LEAD_STATUS[l.status]}</span> <b>${esc(LEAD_KIND[l.kind])}</b> · ${esc(l.name || '')} <span class="mono small">${esc(l.phone)}</span></span>
          <span class="xs muted">${fmtDateTimeRu(l.created_at)}</span></div>`).join('') || '<p class="muted small">Заявок пока нет.</p>'}</div></div>
      <div class="stack">
        ${isAdmin() ? `<div class="panel-box stack"><h3>Перед запуском</h3><ul class="setup" style="list-style:none;margin:0;padding:0">${setup.map(([ok, t, tab]) => `<li>
          <span class="dot" style="background:${ok ? 'var(--ok)' : 'var(--warn)'}"></span><span style="flex:1">${esc(t)}</span><button class="btn ghost sm" type="button" data-go="${tab}">Открыть</button></li>`).join('')}</ul></div>` : ''}
        <div class="panel-box stack"><div class="row between"><h3>Заказы на оценку</h3><button class="btn ghost sm" type="button" data-go="valuations">Все</button></div>
          ${vals.slice(0, 5).map(v => `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line)"><span><span class="status ${statusClass(v.status)}">${VAL_STATUS[v.status]}</span> ${esc(VAL_CAT[v.object_category])} · ${esc(v.purpose || '')}</span><span class="xs muted">${fmtDateRu(v.created_at)}</span></div>`).join('') || '<p class="muted small">Заказов пока нет.</p>'}</div>
      </div>
    </div>`;
  main.onclick = e => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); };
};

// ---------- Заявки ----------
VIEWS.leads = async main => {
  const [agents, listings] = await Promise.all([db.list('agents', { order: 'sort' }), db.list('listings', { select: 'id, code, title, property_type, rooms, area_total' })]);
  const lmap = new Map(listings.map(l => [l.id, l]));
  let rows = await db.list('leads', { order: ['created_at', 'desc'] });
  let fStatus = 'open', fKind = '', q = '';
  main.innerHTML = head('Заявки', `<button class="btn ghost sm" type="button" id="csv">${icon('download')} CSV</button>`) + `
    <div class="toolbar">
      <select class="input" id="f-status"><option value="open">Активные</option><option value="">Все статусы</option>${Object.entries(LEAD_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <select class="input" id="f-kind"><option value="">Все типы</option>${Object.entries(LEAD_KIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <input class="input" id="f-q" placeholder="Имя, телефон, текст">
      <span class="small muted" id="cnt"></span>
    </div>
    <div class="lead-list" id="list"></div>`;
  const filtered = () => rows.filter(r =>
    (fStatus === 'open' ? !['done', 'rejected'].includes(r.status) : !fStatus || r.status === fStatus) &&
    (!fKind || r.kind === fKind) &&
    (!q || [r.name, r.phone, r.message, JSON.stringify(r.payload)].join(' ').toLowerCase().includes(q)));
  async function render() {
    const list = filtered();
    $('#cnt').textContent = `${list.length} из ${rows.length}`;
    $('#list').innerHTML = list.map(r => {
      const l = r.listing_id ? lmap.get(r.listing_id) : null;
      const payload = Object.entries(r.payload || {}).filter(([k, v]) => k !== 'photos' && v !== '' && v !== null && v !== undefined);
      return `<div class="lead-row" data-id="${r.id}">
        <div>
          <div class="row" style="gap:8px"><span class="status ${statusClass(r.status)}">${LEAD_STATUS[r.status]}</span><b>${esc(LEAD_KIND[r.kind] || r.kind)}</b><span class="xs muted">№${r.id} · ${fmtDateTimeRu(r.created_at)} · ${esc(r.source || '')}</span></div>
          <div style="margin-top:6px"><b>${esc(r.name || 'Без имени')}</b> · ${contactLinks(r.phone, 'Здравствуйте! Вы оставляли заявку на сайте.')}${r.email ? ` · <a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : ''}</div>
          ${r.message ? `<p class="small" style="margin-top:6px;white-space:pre-line">${esc(r.message)}</p>` : ''}
          ${l ? `<div class="small" style="margin-top:4px">Объект: <a href="${link('object.html', { id: l.id })}" target="_blank">${esc(l.code)} — ${esc(listingTitle(l))}</a></div>` : ''}
          ${payload.length ? `<div class="kv">${payload.map(([k, v]) => `<span>${esc(k)}: <b>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</b></span>`).join('')}</div>` : ''}
          <div data-att></div>
        </div>
        <div class="lead-actions">
          <select class="input" data-f="status" style="min-height:36px;padding:6px 8px">${Object.entries(LEAD_STATUS).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <select class="input" data-f="agent_id" style="min-height:36px;padding:6px 8px"><option value="">Без ответственного</option>${agents.map(a => `<option value="${a.id}" ${a.id === r.agent_id ? 'selected' : ''}>${esc(a.full_name)}</option>`).join('')}</select>
          <textarea class="input" data-f="admin_note" rows="2" placeholder="Заметка" style="min-height:56px;font-size:var(--fs-xs)">${esc(r.admin_note || '')}</textarea>
          ${isAdmin() ? `<button class="btn ghost sm" type="button" data-del>${icon('trash')} Удалить</button>` : ''}
        </div></div>`;
    }).join('') || '<div class="empty">Заявок нет.</div>';
    for (const r of list) if (r.payload?.photos?.length) {
      const el = $(`[data-id="${r.id}"] [data-att]`);
      attachments('incoming', r.payload.photos).then(h => { if (el) el.innerHTML = h; });
    }
  }
  $('#list').addEventListener('change', async e => {
    const f = e.target.dataset.f; if (!f) return;
    const id = Number(e.target.closest('[data-id]').dataset.id);
    const value = f === 'agent_id' ? (e.target.value ? Number(e.target.value) : null) : e.target.value;
    try {
      const upd = await db.update('leads', id, { [f]: value });
      rows = rows.map(r => r.id === id ? upd : r);
      toast('Сохранено');
      if (f === 'status') { render(); refreshCounters(); }
    } catch (ex) { toast(errText(ex), true); }
  });
  $('#list').addEventListener('click', e => {
    if (!e.target.closest('[data-del]')) return;
    const id = Number(e.target.closest('[data-id]').dataset.id);
    confirmBox(`Удалить заявку №${id}?`, async () => {
      try { await db.remove('leads', id); rows = rows.filter(r => r.id !== id); render(); refreshCounters(); } catch (ex) { toast(errText(ex), true); }
    }, 'Удалить');
  });
  $('#f-status').addEventListener('change', e => { fStatus = e.target.value; render(); });
  $('#f-kind').addEventListener('change', e => { fKind = e.target.value; render(); });
  $('#f-q').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); render(); });
  $('#csv').addEventListener('click', () => downloadCsv(`zayavki-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['№', 'Дата', 'Тип', 'Статус', 'Имя', 'Телефон', 'E-mail', 'Сообщение', 'Объект', 'Детали', 'Ответственный', 'Заметка'],
    ...filtered().map(r => [r.id, fmtDateTimeRu(r.created_at), LEAD_KIND[r.kind], LEAD_STATUS[r.status], r.name, r.phone, r.email, r.message,
      lmap.get(r.listing_id)?.code || '', Object.entries(r.payload || {}).filter(([k]) => k !== 'photos').map(([k, v]) => `${k}: ${v}`).join('; '),
      agents.find(a => a.id === r.agent_id)?.full_name || '', r.admin_note])
  ]));
  render();
};

// ---------- Заказы на оценку ----------
VIEWS.valuations = async main => {
  const [agents, vtypes] = await Promise.all([db.list('agents', { order: 'sort' }), db.list('valuation_types', { order: 'sort' })]);
  let rows = await db.list('valuation_orders', { order: ['created_at', 'desc'] });
  let fStatus = 'open', q = '';
  main.innerHTML = head('Заказы на оценку', `<button class="btn ghost sm" type="button" id="csv">${icon('download')} CSV</button>`) + `
    <div class="toolbar">
      <select class="input" id="f-status"><option value="open">В работе</option><option value="">Все</option>${Object.entries(VAL_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <input class="input" id="f-q" placeholder="Имя, телефон, описание, № отчёта"><span class="small muted" id="cnt"></span>
    </div>
    <div class="lead-list" id="list"></div>`;
  const filtered = () => rows.filter(r => (fStatus === 'open' ? !['done', 'cancelled'].includes(r.status) : !fStatus || r.status === fStatus) &&
    (!q || [r.name, r.phone, r.object_description, r.report_number, r.city, r.purpose].join(' ').toLowerCase().includes(q)));
  function render() {
    const list = filtered();
    $('#cnt').textContent = `${list.length} из ${rows.length}`;
    $('#list').innerHTML = list.map(r => `<div class="lead-row" data-id="${r.id}">
      <div>
        <div class="row" style="gap:8px"><span class="status ${statusClass(r.status)}">${VAL_STATUS[r.status]}</span><b>${esc(VAL_CAT[r.object_category])}</b>
          <span>${esc(vtypes.find(v => v.id === r.valuation_type_id)?.title || '')}</span><span class="xs muted">№${r.id} · ${fmtDateTimeRu(r.created_at)}</span></div>
        <div style="margin-top:6px"><b>${esc(r.name || 'Без имени')}</b> · ${contactLinks(r.phone, 'Здравствуйте! Вы заказывали оценку на сайте.')}${r.email ? ` · <a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : ''}</div>
        <div class="kv"><span>Цель: <b>${esc(r.purpose || '—')}</b></span>${r.city ? `<span>Город: <b>${esc(r.city)}</b></span>` : ''}${r.preliminary_value ? `<span>Онлайн-оценка: <b>${money(r.preliminary_value)}</b></span>` : ''}</div>
        ${r.object_description ? `<p class="small" style="margin-top:6px;white-space:pre-line">${esc(r.object_description)}</p>` : ''}
        <div data-att></div>
      </div>
      <div class="lead-actions" style="min-width:230px">
        <select class="input" data-f="status" style="min-height:36px;padding:6px 8px">${Object.entries(VAL_STATUS).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <select class="input" data-f="appraiser_id" style="min-height:36px;padding:6px 8px"><option value="">Оценщик не назначен</option>${agents.map(a => `<option value="${a.id}" ${a.id === r.appraiser_id ? 'selected' : ''}>${esc(a.full_name)}${a.is_appraiser ? ' (оценщик)' : ''}</option>`).join('')}</select>
        <input class="input" data-f="price" data-num placeholder="Стоимость работ, ₸" value="${r.price ?? ''}" style="min-height:36px;padding:6px 8px">
        <input class="input" data-f="report_number" placeholder="№ отчёта" value="${esc(r.report_number || '')}" style="min-height:36px;padding:6px 8px">
        <input class="input" data-f="report_date" type="date" value="${r.report_date || ''}" style="min-height:36px;padding:6px 8px">
        <input class="input" data-f="final_value" data-num placeholder="Итоговая стоимость, ₸" value="${r.final_value ?? ''}" style="min-height:36px;padding:6px 8px">
        <textarea class="input" data-f="admin_note" rows="2" placeholder="Заметка" style="min-height:56px;font-size:var(--fs-xs)">${esc(r.admin_note || '')}</textarea>
        ${isAdmin() ? `<button class="btn ghost sm" type="button" data-del>${icon('trash')} Удалить</button>` : ''}
      </div></div>`).join('') || '<div class="empty">Заказов нет.</div>';
    for (const r of list) if (r.files?.length) {
      const el = $(`[data-id="${r.id}"] [data-att]`);
      attachments('incoming', r.files).then(h => { if (el) el.innerHTML = h; });
    }
  }
  $('#list').addEventListener('change', async e => {
    const f = e.target.dataset.f; if (!f) return;
    const id = Number(e.target.closest('[data-id]').dataset.id);
    let value = e.target.value;
    if (e.target.dataset.num !== undefined) value = toNum(value);
    else if (f === 'appraiser_id') value = value ? Number(value) : null;
    else if (value === '') value = null;
    try {
      const upd = await db.update('valuation_orders', id, { [f]: value });
      rows = rows.map(r => r.id === id ? upd : r);
      toast('Сохранено');
      if (f === 'status') { render(); refreshCounters(); }
    } catch (ex) { toast(errText(ex), true); }
  });
  $('#list').addEventListener('click', e => {
    if (!e.target.closest('[data-del]')) return;
    const id = Number(e.target.closest('[data-id]').dataset.id);
    confirmBox(`Удалить заказ №${id}?`, async () => { try { await db.remove('valuation_orders', id); rows = rows.filter(r => r.id !== id); render(); } catch (ex) { toast(errText(ex), true); } }, 'Удалить');
  });
  $('#f-status').addEventListener('change', e => { fStatus = e.target.value; render(); });
  $('#f-q').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); render(); });
  $('#csv').addEventListener('click', () => downloadCsv(`ocenka-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['№', 'Дата', 'Категория', 'Объект', 'Цель', 'Статус', 'Имя', 'Телефон', 'Город', 'Описание', 'Стоимость работ', '№ отчёта', 'Дата отчёта', 'Итоговая стоимость'],
    ...filtered().map(r => [r.id, fmtDateTimeRu(r.created_at), VAL_CAT[r.object_category], vtypes.find(v => v.id === r.valuation_type_id)?.title || '', r.purpose, VAL_STATUS[r.status],
      r.name, r.phone, r.city, r.object_description, r.price, r.report_number, r.report_date, r.final_value])
  ]));
  render();
};

// ---------- Объекты ----------
VIEWS.listings = async main => {
  const [cities, districts, agents] = await Promise.all([
    db.list('cities', { order: 'sort' }), db.list('districts', { order: 'sort' }), db.list('agents', { order: 'sort' })
  ]);
  let rows = await db.list('listings', { order: ['created_at', 'desc'] });
  let fStatus = '', fDeal = '', q = '';
  const cmap = new Map(cities.map(c => [c.id, c]));
  function frame() {
    const demo = rows.filter(r => r.is_demo).length;
    main.innerHTML = head('Объекты', `${demo ? `<button class="btn danger sm" type="button" id="del-demo">Удалить демо-объекты (${demo})</button>` : ''}<button class="btn sm" type="button" id="add">${icon('plus')} Добавить объект</button>`) + `
      <div class="toolbar">
        <select class="input" id="f-status"><option value="">Все статусы</option>${Object.entries(LISTING_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <select class="input" id="f-deal"><option value="">Все сделки</option>${Object.entries(DEAL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <input class="input" id="f-q" placeholder="Артикул, название, адрес"><span class="small muted" id="cnt"></span>
      </div>
      <div class="table-wrap"><table class="t"><thead><tr><th></th><th>Объект</th><th>Город</th><th class="num">Цена</th><th>Статус</th><th class="num">Просм.</th><th></th></tr></thead><tbody id="tb"></tbody></table></div>`;
    $('#add').addEventListener('click', () => editListing(null));
    $('#del-demo')?.addEventListener('click', () => confirmBox(`Удалить ${demo} демо-объектов? Ваши объекты не пострадают.`, async () => {
      try { for (const r of rows.filter(x => x.is_demo)) await db.remove('listings', r.id); rows = rows.filter(r => !r.is_demo); frame(); toast('Демо-объекты удалены'); }
      catch (ex) { toast(errText(ex), true); }
    }, 'Удалить'));
    $('#f-status').value = fStatus; $('#f-deal').value = fDeal; $('#f-q').value = q;
    $('#f-status').addEventListener('change', e => { fStatus = e.target.value; render(); });
    $('#f-deal').addEventListener('change', e => { fDeal = e.target.value; render(); });
    $('#f-q').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); render(); });
    $('#tb').addEventListener('click', e => {
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      if (e.target.closest('a')) return;
      editListing(rows.find(r => r.id === Number(tr.dataset.id)));
    });
    render();
  }
  function render() {
    const list = rows.filter(r => (!fStatus || r.status === fStatus) && (!fDeal || r.deal_type === fDeal) &&
      (!q || [r.code, r.title, r.address, r.complex_name].join(' ').toLowerCase().includes(q)));
    $('#cnt').textContent = `${list.length} из ${rows.length}`;
    $('#tb').innerHTML = list.map(r => `<tr class="click" data-id="${r.id}">
      <td><div class="thumb">${r.photos?.length ? `<img src="${esc(r.photos[0])}" alt="">` : planSvg(r)}</div></td>
      <td><div class="clip"><b>${esc(listingTitle(r))}</b></div><div class="xs muted mono">${esc(r.code || '')} · ${DEAL[r.deal_type]} · ${PTYPE[r.property_type]}${r.is_featured ? ' · ★ на главной' : ''}${r.is_demo ? ' · демо' : ''}</div></td>
      <td>${esc(cmap.get(r.city_id)?.name || '')}</td>
      <td class="num">${money(r.price)}</td>
      <td><span class="status ${statusClass(r.status)}">${LISTING_STATUS[r.status]}</span></td>
      <td class="num">${num(r.views || 0)}</td>
      <td><a class="btn ghost sm" href="${link('object.html', { id: r.id })}" target="_blank" aria-label="Открыть на сайте">${icon('eye')}</a></td></tr>`).join('') ||
      '<tr><td colspan="7" class="muted">Объектов нет. Нажмите «Добавить объект».</td></tr>';
  }

  async function editListing(l) {
    const isNew = !l;
    l = l ? { ...l } : { deal_type: 'sale', property_type: 'apartment', status: 'draft', photos: [], features: [], city_id: cities[0]?.id, price: null };
    let priv = { owner_name: '', owner_phone: '', commission: '', contract_until: '', notes: '' };
    if (!isNew) { const p = await db.get('listing_private', l.id, 'listing_id').catch(() => null); if (p) priv = p; }
    const sel = (id, entries, val, empty) => `<select class="input" id="${id}">${empty ? `<option value="">${empty}</option>` : ''}${entries.map(([k, v]) => `<option value="${k}" ${String(k) === String(val ?? '') ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
    const inp = (id, val, attrs = '') => `<input class="input" id="${id}" value="${esc(val ?? '')}" ${attrs}>`;
    const fld = (label, html, cls = '') => `<div class="field ${cls}"><label>${label}</label>${html}</div>`;
    const chk = (id, label, val) => `<label class="check"><input type="checkbox" id="${id}" ${val ? 'checked' : ''}> ${label}</label>`;
    const { el, close } = openModal(`
      <div class="modal-head"><div><span class="eyebrow">${isNew ? 'Новый объект' : esc(l.code || '')}</span><h2>${isNew ? 'Добавить объект' : esc(listingTitle(l))}</h2></div>
        <button class="icon-btn" type="button" data-close aria-label="Закрыть">${icon('close')}</button></div>
      <form class="stack" id="lf" novalidate>
        <div class="ed-sec"><span class="eyebrow">Основное</span><div class="ed-grid">
          ${fld('Сделка', sel('e-deal', Object.entries(DEAL), l.deal_type))}
          ${fld('Тип', sel('e-type', Object.entries(PTYPE), l.property_type))}
          ${fld('Статус', sel('e-status', Object.entries(LISTING_STATUS), l.status))}
          ${fld('Заголовок', inp('e-title', l.title, 'placeholder="2-комнатная квартира с видом на парк"'), 'w2')}
          ${fld('Вид коммерции', inp('e-ckind', l.commercial_kind, 'placeholder="Офис, склад, магазин…"'))}
          ${fld('Ответственный агент', sel('e-agent', agents.map(a => [a.id, a.full_name]), l.agent_id, 'Не назначен'))}
          <div class="field w2" style="justify-content:flex-end;flex-direction:row;flex-wrap:wrap;gap:14px">${chk('e-featured', 'Показывать на главной', l.is_featured)}${chk('e-isdemo', 'Демо-объект', l.is_demo)}</div>
        </div></div>
        <div class="ed-sec"><span class="eyebrow">Цена и условия</span><div class="ed-grid">
          ${fld('Цена, ₸ (для аренды — в месяц)', inp('e-price', l.price, 'inputmode="numeric"'))}
          <div class="field w2" style="justify-content:flex-end;flex-direction:row;flex-wrap:wrap;gap:14px">
            ${chk('e-neg', 'Торг', l.price_negotiable)}${chk('e-mort', 'Ипотека', l.mortgage_ok)}${chk('e-inst', 'Рассрочка', l.installment_ok)}${chk('e-exch', 'Обмен', l.exchange_ok)}${chk('e-pledged', 'В залоге', l.pledged)}${chk('e-new', 'Новостройка', l.is_new_building)}</div>
        </div></div>
        <div class="ed-sec"><span class="eyebrow">Расположение</span><div class="ed-grid">
          ${fld('Город', sel('e-city', cities.map(c => [c.id, c.name]), l.city_id))}
          ${fld('Район', `<select class="input" id="e-district"></select>`)}
          ${fld('ЖК / бизнес-центр', inp('e-complex', l.complex_name))}
          ${fld('Адрес (как показывать на сайте)', inp('e-addr', l.address), 'w3')}
          ${fld('Широта', inp('e-lat', l.lat, 'inputmode="decimal"'))}${fld('Долгота', inp('e-lng', l.lng, 'inputmode="decimal"'))}
          <div class="field" style="justify-content:flex-end"><span class="form-note">Кликните по карте, чтобы поставить точку</span></div>
          <div class="w3"><div class="map-box small" id="e-map" style="height:240px"></div></div>
        </div></div>
        <div class="ed-sec"><span class="eyebrow">Параметры</span><div class="ed-grid">
          ${fld('Общая площадь, м²', inp('e-area', l.area_total, 'inputmode="decimal"'))}${fld('Жилая, м²', inp('e-living', l.area_living, 'inputmode="decimal"'))}${fld('Кухня, м²', inp('e-kitchen', l.area_kitchen, 'inputmode="decimal"'))}
          ${fld('Участок, соток', inp('e-land', l.land_area, 'inputmode="decimal"'))}${fld('Комнат', inp('e-rooms', l.rooms, 'inputmode="numeric"'))}${fld('Потолки, м', inp('e-ceil', l.ceiling_height, 'inputmode="decimal"'))}
          ${fld('Этаж', inp('e-floor', l.floor, 'inputmode="numeric"'))}${fld('Этажей в доме', inp('e-floors', l.floors_total, 'inputmode="numeric"'))}${fld('Год постройки', inp('e-year', l.year_built, 'inputmode="numeric"'))}
          ${fld('Материал стен', inp('e-build', l.building_type, 'list="dl-build"'))}${fld('Состояние', inp('e-cond', l.condition, 'list="dl-cond"'))}${fld('Санузел', inp('e-bath', l.bathroom))}
          ${fld('Балкон', inp('e-balc', l.balcony))}${fld('Парковка', inp('e-park', l.parking))}${fld('Мебель', inp('e-furn', l.furniture, 'list="dl-furn"'))}
        </div>
        <datalist id="dl-build"><option>Монолит</option><option>Кирпич</option><option>Панель</option><option>Блочный</option><option>Каркасно-камышитовый</option><option>Дерево</option></datalist>
        <datalist id="dl-cond"><option>Дизайнерский ремонт</option><option>Евроремонт</option><option>Свежий косметический ремонт</option><option>Предчистовая отделка (white box)</option><option>Черновая отделка</option><option>Требует ремонта</option></datalist>
        <datalist id="dl-furn"><option>Полностью</option><option>Частично</option><option>Без мебели</option></datalist></div>
        <div class="ed-sec"><span class="eyebrow">Описание</span>
          <textarea class="input" id="e-desc" rows="5">${esc(l.description || '')}</textarea>
          ${fld('Особенности — через запятую', inp('e-feat', (l.features || []).join(', '), 'placeholder="Закрытый двор, Лифт, Видеонаблюдение"'))}
          <div class="ed-grid">${fld('Ссылка на видео', inp('e-video', l.video_url))}${fld('Ссылка на 3D-тур', inp('e-tour', l.tour_url))}</div>
        </div>
        <div class="ed-sec"><div class="row between"><span class="eyebrow">Фото (первое — обложка)</span>
          <label class="btn ghost sm" for="e-files">${icon('camera')} Загрузить фото</label><input id="e-files" type="file" accept="image/*" multiple hidden></div>
          <div class="photo-grid" id="e-photos"></div></div>
        <div class="ed-sec"><span class="eyebrow">Только для сотрудников</span><div class="ed-grid">
          ${fld('Собственник', inp('p-owner', priv.owner_name))}${fld('Телефон собственника', inp('p-phone', priv.owner_phone, 'type="tel"'))}${fld('Комиссия', inp('p-comm', priv.commission, 'placeholder="1,5% / 300 000 ₸"'))}
          ${fld('Договор до', inp('p-until', priv.contract_until, 'type="date"'))}${fld('Заметки', `<textarea class="input" id="p-notes" rows="2">${esc(priv.notes || '')}</textarea>`, 'w2')}
        </div></div>
        <p class="error-text" id="e-err" hidden></p>
        <div class="row between">
          <div class="row">${!isNew ? `<button class="btn danger sm" type="button" id="e-del">${icon('trash')} Удалить</button><button class="btn ghost sm" type="button" id="e-dup">Дублировать</button>` : ''}</div>
          <div class="row"><button class="btn ghost" type="button" data-close>Отмена</button><button class="btn" type="submit">Сохранить</button></div>
        </div>
      </form>`, { wide: true });
    const E = id => $('#' + id, el);
    function fillD() {
      const list = districts.filter(d => String(d.city_id) === E('e-city').value);
      E('e-district').innerHTML = '<option value="">—</option>' + list.map(d => `<option value="${d.id}" ${d.id === l.district_id ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
    }
    fillD();
    // Карта-указатель
    let mp = null, marker = null;
    const city = () => cmap.get(Number(E('e-city').value));
    makeMap(E('e-map'), { lat: l.lat || city()?.lat || 48, lng: l.lng || city()?.lng || 68, zoom: l.lat ? 15 : 12 }).then(m => {
      mp = m;
      const place = (lat, lng) => {
        if (marker) marker.setLatLng([lat, lng]);
        else marker = m.L.marker([lat, lng], { icon: pricePin(m.L, 'здесь') }).addTo(m.map);
      };
      if (l.lat && l.lng) place(l.lat, l.lng);
      m.map.on('click', ev => { const { lat, lng } = ev.latlng; E('e-lat').value = lat.toFixed(6); E('e-lng').value = lng.toFixed(6); place(lat, lng); });
    }).catch(() => { E('e-map').hidden = true; });
    E('e-city').addEventListener('change', () => { l.district_id = null; fillD(); const c = city(); if (mp && c) mp.map.setView([c.lat, c.lng], 12); });
    // Фото
    let photos = [...(l.photos || [])];
    const renderPhotos = () => {
      E('e-photos').innerHTML = photos.map((p, i) => `<div class="ph"><img src="${esc(p)}" alt=""><div class="ctl">
        ${i ? `<button type="button" data-left="${i}" aria-label="Левее">←</button>` : ''}<button type="button" data-rm="${i}" aria-label="Удалить">✕</button></div></div>`).join('') ||
        '<p class="small muted">Фото нет — на сайте будет схема планировки.</p>';
    };
    renderPhotos();
    E('e-photos').addEventListener('click', e => {
      const rm = e.target.closest('[data-rm]'), lf = e.target.closest('[data-left]');
      if (rm) photos.splice(Number(rm.dataset.rm), 1);
      if (lf) { const i = Number(lf.dataset.left); [photos[i - 1], photos[i]] = [photos[i], photos[i - 1]]; }
      renderPhotos();
    });
    E('e-files').addEventListener('change', async e => {
      const files = [...e.target.files];
      for (const [i, f] of files.entries()) {
        toast(`Загрузка фото ${i + 1} из ${files.length}…`);
        try { photos.push((await uploadFile('photos', f, 'listings')).url); renderPhotos(); } catch (ex) { toast(errText(ex), true); }
      }
      e.target.value = '';
    });
    const collect = () => ({
      deal_type: E('e-deal').value, property_type: E('e-type').value, status: E('e-status').value,
      title: E('e-title').value.trim(), commercial_kind: E('e-ckind').value.trim() || null,
      agent_id: E('e-agent').value ? Number(E('e-agent').value) : null,
      is_featured: E('e-featured').checked, is_demo: E('e-isdemo').checked,
      price: toNum(E('e-price').value), price_negotiable: E('e-neg').checked, mortgage_ok: E('e-mort').checked, installment_ok: E('e-inst').checked,
      exchange_ok: E('e-exch').checked, pledged: E('e-pledged').checked, is_new_building: E('e-new').checked,
      city_id: E('e-city').value ? Number(E('e-city').value) : null, district_id: E('e-district').value ? Number(E('e-district').value) : null,
      complex_name: E('e-complex').value.trim() || null, address: E('e-addr').value.trim() || null, lat: toNum(E('e-lat').value), lng: toNum(E('e-lng').value),
      area_total: toNum(E('e-area').value), area_living: toNum(E('e-living').value), area_kitchen: toNum(E('e-kitchen').value), land_area: toNum(E('e-land').value),
      rooms: toNum(E('e-rooms').value), ceiling_height: toNum(E('e-ceil').value), floor: toNum(E('e-floor').value), floors_total: toNum(E('e-floors').value),
      year_built: toNum(E('e-year').value), building_type: E('e-build').value.trim() || null, condition: E('e-cond').value.trim() || null,
      bathroom: E('e-bath').value.trim() || null, balcony: E('e-balc').value.trim() || null, parking: E('e-park').value.trim() || null, furniture: E('e-furn').value.trim() || null,
      description: E('e-desc').value.trim() || null, features: E('e-feat').value.split(',').map(s => s.trim()).filter(Boolean),
      video_url: E('e-video').value.trim() || null, tour_url: E('e-tour').value.trim() || null, photos
    });
    const collectPriv = () => ({ owner_name: E('p-owner').value.trim() || null, owner_phone: E('p-phone').value.trim() || null, commission: E('p-comm').value.trim() || null,
      contract_until: E('p-until').value || null, notes: E('p-notes').value.trim() || null });
    E('lf').addEventListener('submit', async e => {
      e.preventDefault();
      const row = collect();
      const err = E('e-err'); err.hidden = true;
      if (!row.title) row.title = listingTitle(row);
      if (row.price === null || isNaN(row.price)) { err.textContent = 'Укажите цену.'; err.hidden = false; return; }
      const btn = e.submitter; btn.disabled = true;
      try {
        const saved = isNew ? await db.insert('listings', row) : await db.update('listings', l.id, row);
        const p = collectPriv();
        if (Object.values(p).some(Boolean) || !isNew) await db.upsert('listing_private', { listing_id: saved.id, ...p }, 'listing_id');
        rows = isNew ? [saved, ...rows] : rows.map(r => r.id === saved.id ? saved : r);
        close(); frame(); toast(isNew ? `Объект ${saved.code} добавлен` : 'Сохранено');
      } catch (ex) { err.textContent = errText(ex); err.hidden = false; btn.disabled = false; }
    });
    E('e-del')?.addEventListener('click', () => confirmBox(`Удалить объект ${l.code}? Если он продан, лучше поставить статус «Продан / сдан».`, async () => {
      try { await db.remove('listings', l.id); rows = rows.filter(r => r.id !== l.id); close(); frame(); toast('Объект удалён'); } catch (ex) { toast(errText(ex), true); }
    }, 'Удалить'));
    E('e-dup')?.addEventListener('click', async () => {
      try {
        const { id, code, created_at, updated_at, published_at, views, ...rest } = { ...l, ...collect() };
        const copy = await db.insert('listings', { ...rest, status: 'draft', title: rest.title + ' (копия)', is_demo: false });
        rows = [copy, ...rows]; close(); frame(); editListing(copy);
      } catch (ex) { toast(errText(ex), true); }
    });
  }
  frame();
};

// ---------- Универсальный редактор таблиц ----------
const ICON_NAMES = ['key', 'crane', 'house', 'tag', 'swap', 'camera', 'sofa', 'door', 'search', 'shield', 'office', 'chart', 'ruler', 'car', 'drop', 'check', 'pen', 'folder', 'plan', 'chat', 'bank', 'calc', 'book', 'user', 'star'];
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i' };
const slugify = s => String(s).toLowerCase().split('').map(c => TR[c] ?? c).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/**
 * spec: { table, title, order, columns:[[key,label,fmt?]], fields:[{key,label,type,options,w}], defaults, search:[keys], note, noDelete }
 * type: text | textarea | md | number | bool | select | lines | items | date | photo
 */
async function crud(box, spec) {
  let rows = await db.list(spec.table, { order: spec.order || 'id' });
  let q = '';
  box.innerHTML = `${spec.note ? `<div class="notice">${spec.note}</div>` : ''}
    <div class="toolbar"><input class="input" data-q placeholder="Поиск"><span class="small muted" data-cnt></span><span style="flex:1"></span>
    ${spec.noAdd ? '' : `<button class="btn sm" type="button" data-add>${icon('plus')} Добавить</button>`}</div>
    <div class="table-wrap"><table class="t"><thead><tr>${spec.columns.map(c => `<th>${esc(c[1])}</th>`).join('')}</tr></thead><tbody data-tb></tbody></table></div>`;
  const tb = $('[data-tb]', box);
  const render = () => {
    const list = rows.filter(r => !q || (spec.search || spec.columns.map(c => c[0])).some(k => String(r[k] ?? '').toLowerCase().includes(q)));
    $('[data-cnt]', box).textContent = `${list.length} из ${rows.length}`;
    tb.innerHTML = list.map(r => `<tr class="click" data-id="${r.id}">${spec.columns.map(([k, , fmt]) => `<td><div class="clip">${fmt ? fmt(r[k], r) : esc(r[k] ?? '')}</div></td>`).join('')}</tr>`).join('') ||
      `<tr><td colspan="${spec.columns.length}" class="muted">Записей нет</td></tr>`;
  };
  $('[data-q]', box).addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); render(); });
  $('[data-add]', box)?.addEventListener('click', () => edit(null));
  tb.addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) edit(rows.find(r => String(r.id) === tr.dataset.id)); });
  render();

  function fieldHtml(f, v) {
    const id = 'cf-' + f.key;
    const cls = f.type === 'textarea' || f.type === 'md' || f.type === 'lines' || f.type === 'items' || f.w === 3 ? 'w3' : f.w === 2 ? 'w2' : '';
    let input;
    if (f.type === 'bool') return `<div class="field ${cls}" style="justify-content:flex-end"><label class="check" style="text-transform:none;letter-spacing:0;font-family:var(--font-body);font-size:var(--fs-sm);color:var(--ink)"><input type="checkbox" id="${id}" ${v ? 'checked' : ''}> ${esc(f.label)}</label></div>`;
    if (f.type === 'select') {
      const opts = typeof f.options === 'function' ? f.options() : f.options;
      input = `<select class="input" id="${id}">${f.empty ? `<option value="">${esc(f.empty)}</option>` : ''}${opts.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea' || f.type === 'md') {
      input = `<textarea class="input" id="${id}" rows="${f.type === 'md' ? 16 : 4}" ${f.type === 'md' ? 'style="font-family:var(--font-mono);font-size:13px"' : ''}>${esc(v ?? '')}</textarea>`;
    } else if (f.type === 'lines') {
      input = `<textarea class="input" id="${id}" rows="5" placeholder="Каждый пункт с новой строки">${esc((v || []).join('\n'))}</textarea>`;
    } else if (f.type === 'items') {
      input = `<textarea class="input" id="${id}" rows="8" placeholder="Пункт | примечание — по одному на строку">${esc((v || []).map(i => i.note ? `${i.title} | ${i.note}` : i.title).join('\n'))}</textarea>`;
    } else if (f.type === 'photo') {
      input = `<div class="row"><div class="avatar">${v ? `<img src="${esc(v)}" alt="">` : icon('user')}</div><input class="input" id="${id}" value="${esc(v ?? '')}" placeholder="Ссылка на фото" style="flex:1;min-width:0">
        <label class="btn ghost sm" for="${id}-file">Загрузить</label><input type="file" id="${id}-file" accept="image/*" hidden></div>`;
    } else {
      const type = f.type === 'date' ? 'date' : 'text';
      const val = f.type === 'date' && v ? String(v).slice(0, 10) : v ?? '';
      input = `<input class="input" id="${id}" type="${type}" value="${esc(val)}" ${f.type === 'number' ? 'inputmode="decimal"' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}>`;
    }
    return `<div class="field ${cls}"><label for="${id}">${esc(f.label)}</label>${input}${f.hint ? `<span class="form-note">${f.hint}</span>` : ''}</div>`;
  }
  function edit(r) {
    const isNew = !r;
    r = r || { ...(spec.defaults || {}) };
    const { el, close } = openModal(`<div class="modal-head"><h2>${isNew ? 'Новая запись' : 'Редактирование'} · ${esc(spec.title)}</h2><button class="icon-btn" type="button" data-close aria-label="Закрыть">${icon('close')}</button></div>
      <form class="stack" novalidate><div class="ed-grid">${spec.fields.map(f => fieldHtml(f, r[f.key])).join('')}</div>
      <p class="error-text" data-err hidden></p>
      <div class="row between"><div>${!isNew && !spec.noDelete ? `<button class="btn danger sm" type="button" data-del>${icon('trash')} Удалить</button>` : ''}</div>
      <div class="row"><button class="btn ghost" type="button" data-close>Отмена</button><button class="btn" type="submit">Сохранить</button></div></div></form>`, { wide: spec.fields.length > 6 });
    for (const f of spec.fields.filter(f => f.type === 'photo')) {
      $(`#cf-${f.key}-file`, el).addEventListener('change', async e => {
        const file = e.target.files[0]; if (!file) return;
        try { const { url } = await uploadFile('photos', file, spec.table); $(`#cf-${f.key}`, el).value = url; $('.avatar', el).innerHTML = `<img src="${esc(url)}" alt="">`; } catch (ex) { toast(errText(ex), true); }
      });
    }
    $('form', el).addEventListener('submit', async e => {
      e.preventDefault();
      const row = {};
      for (const f of spec.fields) {
        const inp = $(`#cf-${f.key}`, el);
        let v;
        if (f.type === 'bool') v = inp.checked;
        else if (f.type === 'number') v = toNum(inp.value);
        else if (f.type === 'lines') v = inp.value.split('\n').map(s => s.trim()).filter(Boolean);
        else if (f.type === 'items') v = inp.value.split('\n').map(s => s.trim()).filter(Boolean).map(s => { const [title, ...rest] = s.split('|'); return { title: title.trim(), note: rest.join('|').trim() }; });
        else if (f.type === 'select' && f.numeric) v = inp.value ? Number(inp.value) : null;
        else v = inp.value.trim() === '' ? (f.type === 'date' ? null : (f.required ? '' : null)) : inp.value.trim();
        if (f.type === 'date' && v && f.timestamp) v = new Date(v + 'T10:00:00').toISOString();
        row[f.key] = v;
      }
      if ('slug' in row && !row.slug) row.slug = slugify(row.title || row.name || row.term || '') || null;
      if (spec.beforeSave) spec.beforeSave(row);
      const missing = spec.fields.find(f => f.required && (row[f.key] === null || row[f.key] === ''));
      const err = $('[data-err]', el);
      if (missing) { err.textContent = `Заполните поле «${missing.label}».`; err.hidden = false; return; }
      try {
        const saved = isNew ? await db.insert(spec.table, row) : await db.update(spec.table, r.id, row);
        rows = isNew ? [...rows, saved] : rows.map(x => x.id === saved.id ? saved : x);
        drop(spec.table); close(); render(); toast('Сохранено');
        spec.onChange?.();
      } catch (ex) { err.textContent = errText(ex); err.hidden = false; }
    });
    $('[data-del]', el)?.addEventListener('click', () => confirmBox('Удалить запись?', async () => {
      try { await db.remove(spec.table, r.id); rows = rows.filter(x => x.id !== r.id); drop(spec.table); close(); render(); toast('Удалено'); spec.onChange?.(); }
      catch (ex) { toast(errText(ex), true); }
    }, 'Удалить'));
  }
}
const yesno = v => v ? '<span class="status st-done">да</span>' : '<span class="status st-off">нет</span>';
const short = n => v => esc(String(v ?? '').slice(0, n));

function subTabs(main, title, specs, note = '') {
  const keys = Object.keys(specs);
  let cur = keys[0];
  main.innerHTML = head(title) + (note ? `<p class="muted small">${note}</p>` : '') + `<div class="sub-tabs">${keys.map(k => `<button class="chip" type="button" data-s="${k}">${esc(specs[k].label || specs[k].title)}</button>`).join('')}</div><div id="sub" class="stack"></div>`;
  const show = k => {
    cur = k;
    $$('.sub-tabs .chip', main).forEach(c => c.setAttribute('aria-pressed', c.dataset.s === k));
    crud($('#sub', main), specs[k]).catch(e => { $('#sub', main).innerHTML = `<div class="notice">${esc(errText(e))}</div>`; });
  };
  $('.sub-tabs', main).addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (b) show(b.dataset.s); });
  show(cur);
}

// ---------- Отзывы ----------
VIEWS.reviews = async main => {
  main.innerHTML = head('Отзывы') + '<p class="muted small">Новые отзывы с сайта приходят неопубликованными. Откройте отзыв, при желании ответьте и отметьте «Опубликован».</p><div id="box" class="stack"></div>';
  await crud($('#box', main), {
    table: 'reviews', title: 'Отзыв', order: ['created_at', 'desc'], noAdd: false,
    columns: [['is_published', 'Опубликован', yesno], ['author', 'Автор'], ['rating', 'Оценка', v => '★'.repeat(v || 0)], ['text', 'Текст', short(80)], ['created_at', 'Дата', v => fmtDateRu(v)]],
    fields: [
      { key: 'author', label: 'Автор', required: true }, { key: 'rating', label: 'Оценка 1–5', type: 'number' }, { key: 'service', label: 'Услуга' },
      { key: 'text', label: 'Текст', type: 'textarea', required: true }, { key: 'reply', label: 'Ответ агентства', type: 'textarea' },
      { key: 'is_published', label: 'Опубликован на сайте', type: 'bool' }
    ],
    defaults: { rating: 5, is_published: false }, onChange: refreshCounters
  });
};

// ---------- Контент ----------
VIEWS.content = async main => {
  subTabs(main, 'Контент сайта', {
    services: {
      label: 'Услуги', table: 'services', title: 'Услуга', order: 'sort',
      columns: [['title', 'Услуга'], ['category', 'Раздел', v => esc(SERVICE_CAT[v] || v)], ['price_text', 'Цена', short(50)], ['sort', '№'], ['is_active', 'Показ', yesno]],
      fields: [
        { key: 'title', label: 'Название', required: true, w: 2 }, { key: 'category', label: 'Раздел', type: 'select', options: Object.entries(SERVICE_CAT) },
        { key: 'short', label: 'Коротко (для плиток)', w: 3 }, { key: 'description', label: 'Описание', type: 'textarea' },
        { key: 'includes', label: 'Что входит', type: 'lines' },
        { key: 'price_from', label: 'Цена от, ₸ (число)', type: 'number' }, { key: 'price_text', label: 'Цена текстом', w: 2, placeholder: '1–2% от цены сделки' },
        { key: 'duration', label: 'Срок' }, { key: 'icon', label: 'Иконка', type: 'select', options: ICON_NAMES.map(i => [i, i]) }, { key: 'slug', label: 'Адрес (slug)', hint: 'Пусто — создастся из названия' },
        { key: 'sort', label: 'Порядок', type: 'number' }, { key: 'is_active', label: 'Показывать на сайте', type: 'bool' }
      ], defaults: { is_active: true, category: 'buy', icon: 'key', sort: 100 }
    },
    vtypes: {
      label: 'Виды оценки', table: 'valuation_types', title: 'Вид оценки', order: 'sort',
      columns: [['title', 'Объект'], ['category', 'Категория', v => esc(VAL_CAT[v])], ['price_text', 'Цена'], ['duration', 'Срок'], ['is_active', 'Показ', yesno]],
      fields: [
        { key: 'title', label: 'Название', required: true, w: 2 }, { key: 'category', label: 'Категория', type: 'select', options: Object.entries(VAL_CAT) },
        { key: 'short', label: 'Коротко', w: 3 }, { key: 'description', label: 'Описание', type: 'textarea' },
        { key: 'purposes', label: 'Цели (по строке)', type: 'lines' }, { key: 'documents', label: 'Документы (по строке)', type: 'lines' },
        { key: 'price_from', label: 'Цена от, ₸', type: 'number' }, { key: 'price_text', label: 'Цена текстом' }, { key: 'duration', label: 'Срок' },
        { key: 'slug', label: 'Slug' }, { key: 'sort', label: 'Порядок', type: 'number' }, { key: 'is_active', label: 'Показывать', type: 'bool' }
      ], defaults: { is_active: true, category: 'real_estate', sort: 100 }
    },
    purposes: {
      label: 'Цели оценки', table: 'valuation_purposes', title: 'Цель оценки', order: 'sort',
      columns: [['title', 'Цель'], ['required_by', 'Кто требует'], ['value_kind', 'Вид стоимости']],
      fields: [{ key: 'title', label: 'Цель', required: true, w: 2 }, { key: 'sort', label: 'Порядок', type: 'number' }, { key: 'required_by', label: 'Кто требует' }, { key: 'value_kind', label: 'Вид стоимости', w: 2 }, { key: 'description', label: 'Пояснение', type: 'textarea' }]
    },
    articles: {
      label: 'Статьи', table: 'articles', title: 'Статья', order: ['published_at', 'desc'],
      columns: [['title', 'Заголовок'], ['category', 'Рубрика'], ['published_at', 'Дата', v => fmtDateRu(v)], ['is_published', 'Опубликована', yesno]],
      note: 'Разметка текста: <b>## Заголовок</b>, <b>- пункт списка</b>, <b>1. нумерованный</b>, <b>&gt; врезка</b>, <b>**жирный**</b>, таблица — строки вида <b>| ячейка | ячейка |</b>, ссылка — <b>[текст](https://…)</b>.',
      fields: [
        { key: 'title', label: 'Заголовок', required: true, w: 2 }, { key: 'category', label: 'Рубрика', required: true },
        { key: 'excerpt', label: 'Анонс', w: 3 }, { key: 'body', label: 'Текст статьи', type: 'md' },
        { key: 'tags', label: 'Теги (по строке)', type: 'lines' }, { key: 'reading_min', label: 'Минут чтения', type: 'number' },
        { key: 'published_at', label: 'Дата публикации', type: 'date', timestamp: true }, { key: 'slug', label: 'Адрес (slug)' },
        { key: 'is_published', label: 'Опубликована', type: 'bool' }
      ], defaults: { is_published: true, category: 'Покупка' },
      beforeSave: r => { if (!r.published_at) r.published_at = new Date().toISOString(); }
    },
    faq: {
      label: 'Вопросы и ответы', table: 'faq', title: 'Вопрос', order: 'sort',
      columns: [['question', 'Вопрос'], ['category', 'Раздел'], ['sort', '№'], ['is_active', 'Показ', yesno]],
      fields: [{ key: 'question', label: 'Вопрос', required: true, w: 2 }, { key: 'category', label: 'Раздел', required: true, placeholder: 'Покупка, Продажа, Оценка…' },
        { key: 'answer', label: 'Ответ', type: 'textarea', required: true }, { key: 'sort', label: 'Порядок', type: 'number' }, { key: 'is_active', label: 'Показывать', type: 'bool' }],
      defaults: { is_active: true, sort: 100 }
    },
    checklists: {
      label: 'Чек-листы документов', table: 'checklists', title: 'Чек-лист', order: 'sort',
      columns: [['title', 'Чек-лист'], ['audience', 'Для кого'], ['items', 'Пунктов', v => (v || []).length]],
      fields: [{ key: 'title', label: 'Название', required: true, w: 2 }, { key: 'audience', label: 'Для кого' }, { key: 'intro', label: 'Вступление', type: 'textarea' },
        { key: 'items', label: 'Пункты: «название | примечание», по одному на строку', type: 'items' }, { key: 'slug', label: 'Slug' }, { key: 'sort', label: 'Порядок', type: 'number' }]
    },
    steps: {
      label: 'Этапы работы', table: 'process_steps', title: 'Этап', order: 'step_no',
      columns: [['process', 'Процесс', v => esc({ buy: 'Покупка', sell: 'Продажа', rent: 'Аренда', valuation: 'Оценка', mortgage: 'Ипотека' }[v] || v)], ['step_no', 'Шаг'], ['title', 'Этап'], ['duration', 'Срок']],
      search: ['process', 'title', 'description'],
      fields: [{ key: 'process', label: 'Процесс', type: 'select', options: [['buy', 'Покупка'], ['sell', 'Продажа'], ['rent', 'Аренда'], ['valuation', 'Оценка'], ['mortgage', 'Ипотека']] },
        { key: 'step_no', label: 'Номер шага', type: 'number' }, { key: 'duration', label: 'Срок' }, { key: 'title', label: 'Название', required: true, w: 3 }, { key: 'description', label: 'Описание', type: 'textarea' }]
    },
    glossary: {
      label: 'Словарь', table: 'glossary', title: 'Термин', order: 'term',
      columns: [['term', 'Термин'], ['definition', 'Определение', short(90)]],
      fields: [{ key: 'term', label: 'Термин', required: true, w: 3 }, { key: 'definition', label: 'Определение', type: 'textarea', required: true }]
    },
    mortgage: {
      label: 'Ипотечные программы', table: 'mortgage_programs', title: 'Программа', order: 'sort',
      columns: [['name', 'Программа'], ['bank', 'Банк'], ['rate', 'Ставка %'], ['down_payment_pct', 'Взнос %'], ['checked_at', 'Проверено', v => fmtDateRu(v)], ['is_active', 'Показ', yesno]],
      fields: [
        { key: 'name', label: 'Название', required: true }, { key: 'bank', label: 'Банк / оператор', w: 2 },
        { key: 'rate', label: 'Ставка, % (число для калькулятора)', type: 'number' }, { key: 'rate_text', label: 'Ставка текстом', w: 2 },
        { key: 'down_payment_pct', label: 'Взнос от, %', type: 'number' }, { key: 'term_years', label: 'Срок до, лет', type: 'number' }, { key: 'max_amount', label: 'Лимит, ₸', type: 'number' },
        { key: 'max_amount_text', label: 'Лимит текстом', w: 3 }, { key: 'housing', label: 'Какое жильё', w: 3 }, { key: 'who', label: 'Кто может участвовать', type: 'textarea' },
        { key: 'notes', label: 'Примечания', type: 'textarea' }, { key: 'url', label: 'Сайт' }, { key: 'checked_at', label: 'Дата проверки условий', type: 'date' },
        { key: 'sort', label: 'Порядок', type: 'number' }, { key: 'is_active', label: 'Показывать', type: 'bool' }
      ], defaults: { is_active: true, sort: 100 }, beforeSave: r => { if (!r.checked_at) r.checked_at = new Date().toISOString().slice(0, 10); }
    }
  });
};

// ---------- Цены и коэффициенты ----------
VIEWS.prices = async main => {
  const cities = await db.list('cities', { order: 'sort' });
  const cityOpts = () => cities.map(c => [c.id, c.name]);
  const cityName = v => esc(cities.find(c => c.id === v)?.name || '');
  subTabs(main, 'Цены и коэффициенты', {
    index: {
      label: 'Цены м² по городам', table: 'price_index', title: 'Цены города', order: 'city_id',
      columns: [['city_id', 'Город', cityName], ['apt_sale_m2', 'Квартира, ₸/м²', v => num(v)], ['apt_rent_m2', 'Аренда, ₸/м²', v => num(v)], ['land_sotka', 'Земля, ₸/сотка', v => num(v)], ['updated_at', 'Обновлено', v => fmtDateRu(v)]],
      search: ['source', 'period'],
      note: 'Из этих цифр считается онлайн-оценка. Обновляйте раз в месяц по аналитике krisha.kz или stat.gov.kz.',
      fields: [
        { key: 'city_id', label: 'Город', type: 'select', options: cityOpts, numeric: true }, { key: 'apt_sale_m2', label: 'Квартира, продажа ₸/м²', type: 'number' }, { key: 'apt_rent_m2', label: 'Квартира, аренда ₸/м² в месяц', type: 'number' },
        { key: 'house_sale_m2', label: 'Дом, ₸/м²', type: 'number' }, { key: 'land_sotka', label: 'Земля, ₸ за сотку', type: 'number' }, { key: 'commercial_sale_m2', label: 'Коммерция, продажа ₸/м²', type: 'number' },
        { key: 'commercial_rent_m2', label: 'Коммерция, аренда ₸/м²', type: 'number' }, { key: 'period', label: 'Период' }, { key: 'source', label: 'Источник', type: 'textarea' }
      ], beforeSave: r => { r.updated_at = new Date().toISOString(); }
    },
    districts: {
      label: 'Районы', table: 'districts', title: 'Район', order: 'sort',
      columns: [['city_id', 'Город', cityName], ['name', 'Район'], ['price_coef', 'Поправка к цене']],
      search: ['name'],
      note: 'Поправка 1,12 — район на 12% дороже среднего по городу, 0,90 — на 10% дешевле.',
      fields: [{ key: 'city_id', label: 'Город', type: 'select', options: cityOpts, numeric: true }, { key: 'name', label: 'Район', required: true }, { key: 'price_coef', label: 'Поправка к цене', type: 'number' }, { key: 'sort', label: 'Порядок', type: 'number' }],
      defaults: { price_coef: 1, sort: 100 }
    },
    factors: {
      label: 'Коэффициенты оценки', table: 'valuation_factors', title: 'Коэффициент', order: 'sort',
      columns: [['factor', 'Фактор'], ['label', 'Вариант'], ['coef', 'Множитель']],
      note: 'Множитель 1,05 — +5% к стоимости, 0,93 — −7%. Факторы: building_type, condition, floor, year, rooms, extra, land_comm, auto_condition, auto_accident, equip_condition.',
      fields: [{ key: 'factor', label: 'Фактор', required: true }, { key: 'option_key', label: 'Ключ варианта', required: true }, { key: 'coef', label: 'Множитель', type: 'number' }, { key: 'label', label: 'Подпись', required: true, w: 2 }, { key: 'sort', label: 'Порядок', type: 'number' }]
    },
    cities: {
      label: 'Города', table: 'cities', title: 'Город', order: 'sort',
      columns: [['name', 'Город'], ['region', 'Регион'], ['sort', '№'], ['is_active', 'Показ', yesno]],
      fields: [{ key: 'name', label: 'Город', required: true }, { key: 'region', label: 'Регион', w: 2 }, { key: 'lat', label: 'Широта центра', type: 'number' }, { key: 'lng', label: 'Долгота центра', type: 'number' },
        { key: 'sort', label: 'Порядок', type: 'number' }, { key: 'slug', label: 'Slug' }, { key: 'is_active', label: 'Показывать', type: 'bool' }],
      defaults: { is_active: true, sort: 100 }
    }
  });
};

// ---------- Команда ----------
VIEWS.team = async main => {
  const agents = await db.list('agents');
  const demo = agents.filter(a => a.is_demo).length;
  main.innerHTML = head('Команда', demo ? `<button class="btn danger sm" type="button" id="del-demo">Удалить демо-сотрудников (${demo})</button>` : '') +
    '<p class="muted small">Сотрудники на странице «Контакты» и в карточках объектов. Доступ в админку выдаётся отдельно — в разделе «Пользователи».</p><div id="box" class="stack"></div>';
  $('#del-demo')?.addEventListener('click', () => confirmBox(`Удалить ${demo} демо-сотрудников? Их объекты останутся без ответственного.`, async () => {
    try { for (const a of agents.filter(x => x.is_demo)) await db.remove('agents', a.id); drop('agents'); go('team'); } catch (ex) { toast(errText(ex), true); }
  }, 'Удалить'));
  await crud($('#box', main), {
    table: 'agents', title: 'Сотрудник', order: 'sort',
    columns: [['full_name', 'Имя', (v, r) => `${esc(v)}${r.is_demo ? ' <span class="badge demo">демо</span>' : ''}`], ['position', 'Должность'], ['phone', 'Телефон'], ['is_appraiser', 'Оценщик', yesno], ['is_active', 'На сайте', yesno]],
    fields: [
      { key: 'full_name', label: 'Имя и фамилия', required: true, w: 2 }, { key: 'position', label: 'Должность' },
      { key: 'phone', label: 'Телефон' }, { key: 'whatsapp', label: 'WhatsApp (цифры)', placeholder: '77001234567' }, { key: 'telegram', label: 'Telegram' },
      { key: 'email', label: 'E-mail' }, { key: 'experience_years', label: 'Опыт, лет', type: 'number' }, { key: 'sort', label: 'Порядок', type: 'number' },
      { key: 'photo_url', label: 'Фото', type: 'photo', w: 3 }, { key: 'specialization', label: 'Специализация', w: 3 }, { key: 'bio', label: 'О себе', type: 'textarea' },
      { key: 'certificates', label: 'Квалификация, свидетельства, членство в палате', type: 'textarea' },
      { key: 'is_appraiser', label: 'Оценщик', type: 'bool' }, { key: 'is_active', label: 'Показывать на сайте', type: 'bool' }, { key: 'is_demo', label: 'Демо', type: 'bool' }
    ], defaults: { is_active: true, sort: 100, is_demo: false }, onChange: () => drop('agents')
  });
};

// ---------- Настройки ----------
VIEWS.settings = async main => {
  const s = await db.list('settings');
  const get = k => ({ ...(settings[k] || {}), ...(s.find(r => r.key === k)?.value || {}) });
  const priv = await db.list('private_settings').catch(() => []);
  const pget = k => priv.find(p => p.key === k)?.value || '';
  const groups = {
    company: ['Компания', [['name', 'Название бренда'], ['tagline', 'Подпись под логотипом'], ['slogan', 'Слоган'], ['legal_name', 'Юридическое название'], ['bin', 'БИН'], ['about', 'О компании', 'textarea'], ['appraiser_note', 'Об оценщиках (лицензия, палата)', 'textarea']]],
    contacts: ['Контакты', [['phone', 'Телефон'], ['whatsapp', 'WhatsApp (только цифры, 7…)'], ['telegram', 'Telegram (@имя)'], ['instagram', 'Instagram (@имя)'], ['email', 'E-mail'], ['city', 'Город офиса'], ['address', 'Адрес офиса'], ['hours', 'Часы работы'], ['lat', 'Широта офиса', 'number'], ['lng', 'Долгота офиса', 'number'], ['two_gis_url', 'Ссылка на 2GIS']]],
    home: ['Главная страница', [['hero_title', 'Заголовок'], ['hero_sub', 'Подзаголовок', 'textarea'], ['promise', 'Обещание по скорости ответа']]],
    finance: ['Тарифы и налоги для калькуляторов', [['year', 'Год', 'number'], ['mrp', 'МРП, ₸', 'number'], ['ipn_rate', 'ИПН, %', 'number'], ['ipn_rate_high', 'ИПН повышенный, %', 'number'], ['ipn_threshold_mrp', 'Порог ИПН, МРП', 'number'],
      ['gov_fee_apartment', 'Госпошлина за регистрацию, ₸', 'number'], ['fast_registration', 'Ускоренная регистрация, ₸', 'number'], ['con_contract', 'Договор в ЦОН, ₸', 'number'],
      ['notary_mrp_nonrel', 'Нотариус, не родственники, МРП', 'number'], ['notary_mrp_rel', 'Нотариус, родственники, МРП', 'number'], ['notary_mrp_legal', 'Нотариус, юрлицо, МРП', 'number'],
      ['spouse_consent_mrp', 'Согласие супруга, МРП', 'number'], ['mortgage_contract_mrp', 'Договор ипотеки, МРП', 'number'], ['pledge_mrp', 'Договор залога, МРП', 'number'],
      ['valuation_min', 'Оценка для банка от, ₸', 'number'], ['usd_rate', 'Курс доллара (пусто — не показывать)', 'number']]]
  };
  main.innerHTML = head('Настройки') + Object.entries(groups).map(([key, [title, fields]]) => `<form class="panel-box stack" data-key="${key}">
      <h3>${esc(title)}</h3><div class="ed-grid">${fields.map(([f, l, t]) => `<div class="field ${t === 'textarea' ? 'w3' : ''}"><label for="s-${key}-${f}">${esc(l)}</label>${
        t === 'textarea' ? `<textarea class="input" id="s-${key}-${f}" data-f="${f}" rows="3">${esc(get(key)[f] ?? '')}</textarea>`
          : `<input class="input" id="s-${key}-${f}" data-f="${f}" data-t="${t || ''}" value="${esc(get(key)[f] ?? '')}">`}</div>`).join('')}</div>
      <div class="row"><button class="btn sm" type="submit">Сохранить</button></div></form>`).join('') + `
    <form class="panel-box stack" id="tg">
      <h3>Уведомления о заявках в Telegram</h3>
      <ol class="small muted" style="margin:0;padding-left:1.2em;display:flex;flex-direction:column;gap:4px">
        <li>В Telegram откройте @BotFather → /newbot → получите токен вида <span class="mono">123456:ABC…</span>.</li>
        <li>Напишите своему боту любое сообщение (или добавьте его в рабочую группу).</li>
        <li>Узнайте chat_id: например, через бота @userinfobot (для группы — id со знаком минус).</li>
        <li>Вставьте токен и chat_id ниже и нажмите «Сохранить», затем «Отправить тестовую заявку».</li>
      </ol>
      <div class="ed-grid"><div class="field w2"><label for="tg-token">Токен бота</label><input class="input" id="tg-token" value="${esc(pget('telegram_bot_token'))}" autocomplete="off"></div>
        <div class="field"><label for="tg-chat">chat_id</label><input class="input" id="tg-chat" value="${esc(pget('telegram_chat_id'))}"></div></div>
      <div class="row"><button class="btn sm" type="submit">Сохранить</button><button class="btn ghost sm" type="button" id="tg-test">Отправить тестовую заявку</button></div>
      <p class="form-note">Токен хранится в закрытой таблице: его видит только администратор, на сайт он не попадает.${DEMO ? ' В демо-режиме уведомления не отправляются.' : ''}</p>
    </form>`;
  $$('form[data-key]', main).forEach(f => f.addEventListener('submit', async e => {
    e.preventDefault();
    const key = f.dataset.key;
    const value = { ...get(key) };
    $$('[data-f]', f).forEach(i => { value[i.dataset.f] = i.dataset.t === 'number' ? toNum(i.value) : i.value.trim(); });
    try { await db.upsert('settings', { key, value }, 'key'); settings[key] = value; toast('Сохранено'); } catch (ex) { toast(errText(ex), true); }
  }));
  $('#tg').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await db.upsert('private_settings', { key: 'telegram_bot_token', value: $('#tg-token').value.trim() }, 'key');
      await db.upsert('private_settings', { key: 'telegram_chat_id', value: $('#tg-chat').value.trim() }, 'key');
      toast('Сохранено');
    } catch (ex) { toast(errText(ex), true); }
  });
  $('#tg-test').addEventListener('click', async () => {
    try {
      await db.insert('leads', { kind: 'other', name: 'Тест уведомлений', phone: '+7 (700) 000-00-00', message: 'Проверка Telegram-уведомлений. Эту заявку можно удалить.', source: 'admin' }, { returning: false });
      toast('Тестовая заявка создана — проверьте Telegram');
    } catch (ex) { toast(errText(ex), true); }
  });
};

// ---------- Пользователи ----------
VIEWS.users = async main => {
  let rows = await db.list('profiles', { order: ['created_at', 'desc'] });
  if (DEMO) rows = [{ id: 'demo', email: 'demo@qadam.kz', full_name: 'Демо-администратор', role: 'admin', created_at: new Date().toISOString() }];
  main.innerHTML = head('Пользователи') + `<p class="muted small">Сотрудник регистрируется на странице входа в админку (кнопка «Регистрация сотрудника»), затем вы выдаёте ему роль.
    <b>Агент</b> работает с заявками, оценкой и объектами; <b>администратор</b> — ещё и с контентом, ценами, командой и настройками. Роль «нет доступа» закрывает админку.</p>
    <div class="table-wrap"><table class="t"><thead><tr><th>Пользователь</th><th>E-mail</th><th>Создан</th><th>Роль</th></tr></thead><tbody>${rows.map(r => `<tr data-id="${r.id}">
      <td>${esc(r.full_name || '—')}${r.id === profile.id ? ' <span class="badge">это вы</span>' : ''}</td><td>${esc(r.email || '')}</td><td>${fmtDateRu(r.created_at)}</td>
      <td><select class="input" data-role style="min-height:36px;padding:6px 8px;width:auto" ${r.id === profile.id ? 'disabled' : ''}>
        ${[['admin', 'Администратор'], ['agent', 'Агент'], ['user', 'Нет доступа']].map(([k, v]) => `<option value="${k}" ${k === r.role ? 'selected' : ''}>${v}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>`;
  $('tbody', main).addEventListener('change', async e => {
    if (!e.target.matches('[data-role]')) return;
    const id = e.target.closest('tr').dataset.id;
    try { await db.update('profiles', id, { role: e.target.value }); toast('Роль изменена'); } catch (ex) { toast(errText(ex), true); }
  });
};

start().catch(e => { console.error(e); app.innerHTML = `<div class="wrap"><div class="notice" style="margin-top:40px">Не удалось запустить админку: ${esc(errText(e))}</div></div>`; });
