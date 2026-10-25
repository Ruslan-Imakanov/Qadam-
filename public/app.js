// ============================================================
// Общий модуль сайта: данные, авторизация, шапка/подвал, формы,
// карточки объектов, калькуляторы. Подключается из каждой страницы:
//   <script type="module"> import { … } from './app.js' </script>
// ============================================================
import { CONFIG } from './config.js';

export const DEMO = !CONFIG.supabaseUrl;

// ---------- Безопасный localStorage / sessionStorage ----------
function makeStore(kind) {
  return {
    get(key, fallback = null) {
      try { const v = window[kind].getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
    },
    set(key, value) {
      try { window[kind].setItem(key, JSON.stringify(value)); return true; } catch { return false; }
    },
    del(key) { try { window[kind].removeItem(key); } catch { /* недоступно */ } }
  };
}
export const store = makeStore('localStorage');
export const session = makeStore('sessionStorage');

// ============================================================
// Слой данных: одинаковый интерфейс для Supabase и демо-режима
// ============================================================
let sbPromise = null;
export function supabase() {
  if (!sbPromise) {
    sbPromise = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm')
      .then(({ createClient }) => createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey));
  }
  return sbPromise;
}

const DEMO_KEY = 'qadam-demo-v1';
let demoPromise = null;
function demoTables() {
  if (!demoPromise) {
    demoPromise = fetch(new URL('data/demo.json', import.meta.url))
      .then(r => r.json())
      .then(json => {
        const tables = json.tables;
        const saved = store.get(DEMO_KEY);
        if (saved) Object.assign(tables, saved);
        return tables;
      });
  }
  return demoPromise;
}
async function demoSave(table) {
  const t = await demoTables();
  const saved = store.get(DEMO_KEY, {});
  saved[table] = t[table];
  if (!store.set(DEMO_KEY, saved)) toast('Демо: не удалось сохранить в браузере — слишком много данных', true);
}
export function demoReset() { store.del(DEMO_KEY); location.reload(); }

const clone = v => JSON.parse(JSON.stringify(v));
function matches(row, opts) {
  for (const [k, v] of Object.entries(opts.eq || {})) if (row[k] !== v) return false;
  for (const [k, arr] of Object.entries(opts.in || {})) if (!arr.includes(row[k])) return false;
  return true;
}
function sortRows(rows, order) {
  if (!order) return rows;
  const [col, dir] = Array.isArray(order) ? order : [order, 'asc'];
  const m = dir === 'desc' ? -1 : 1;
  return rows.sort((a, b) => (a[col] ?? '') > (b[col] ?? '') ? m : (a[col] ?? '') < (b[col] ?? '') ? -m : 0);
}
const TABLE_DEFAULTS = {
  leads: { status: 'new', payload: {}, agent_id: null, admin_note: null },
  valuation_orders: { status: 'new', details: {}, files: [] },
  reviews: { is_published: false },
  listings: { status: 'draft', views: 0, features: [], photos: [], is_demo: false, is_featured: false }
};

export const db = {
  /** list('listings', { select, eq: {status:'published'}, in: {status:[…]}, order: ['created_at','desc'], limit }) */
  async list(table, opts = {}) {
    if (DEMO) {
      const t = await demoTables();
      let rows = (t[table] || []).filter(r => matches(r, opts));
      rows = sortRows(clone(rows), opts.order);
      return opts.limit ? rows.slice(0, opts.limit) : rows;
    }
    const sb = await supabase();
    const all = [];
    const page = 1000;
    for (let from = 0; ; from += page) {
      let q = sb.from(table).select(opts.select || '*');
      for (const [k, v] of Object.entries(opts.eq || {})) q = q.eq(k, v);
      for (const [k, v] of Object.entries(opts.in || {})) q = q.in(k, v);
      if (opts.order) {
        const [col, dir] = Array.isArray(opts.order) ? opts.order : [opts.order, 'asc'];
        q = q.order(col, { ascending: dir !== 'desc' });
      }
      const to = opts.limit ? Math.min(from + page, opts.limit) - 1 : from + page - 1;
      const { data, error } = await q.range(from, to);
      if (error) throw error;
      all.push(...data);
      if (data.length < page || (opts.limit && all.length >= opts.limit)) break;
    }
    return all;
  },
  async get(table, id, key = 'id') {
    if (DEMO) {
      const t = await demoTables();
      const row = (t[table] || []).find(r => String(r[key]) === String(id));
      return row ? clone(row) : null;
    }
    const sb = await supabase();
    const { data, error } = await sb.from(table).select('*').eq(key, id).maybeSingle();
    if (error) throw error;
    return data;
  },
  /** returning:false — для форм посетителей: прочитать свою заявку им RLS не разрешает */
  async insert(table, row, { returning = true } = {}) {
    if (DEMO) {
      const t = await demoTables();
      t[table] = t[table] || [];
      const id = row.id ?? (t[table].reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1);
      const now = new Date().toISOString();
      const full = { ...(TABLE_DEFAULTS[table] || {}), created_at: now, updated_at: now, ...row, id };
      if (table === 'listings') {
        full.code = full.code || 'A-' + String(id).padStart(5, '0');
        if (full.status === 'published' && !full.published_at) full.published_at = now;
      }
      t[table].push(full);
      await demoSave(table);
      return clone(full);
    }
    const sb = await supabase();
    if (!returning) {
      const { error } = await sb.from(table).insert(row);
      if (error) throw error;
      return null;
    }
    const { data, error } = await sb.from(table).insert(row).select().single();
    if (error) throw error;
    return data;
  },
  async update(table, id, patch, key = 'id') {
    if (DEMO) {
      const t = await demoTables();
      const row = (t[table] || []).find(r => String(r[key]) === String(id));
      if (!row) throw new Error('Запись не найдена');
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      if (table === 'listings' && row.status === 'published' && !row.published_at) row.published_at = row.updated_at;
      await demoSave(table);
      return clone(row);
    }
    const sb = await supabase();
    const { data, error } = await sb.from(table).update(patch).eq(key, id).select().maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Нет прав на изменение или запись не найдена');
    return data;
  },
  async upsert(table, row, key = 'id') {
    if (DEMO) {
      const t = await demoTables();
      const existing = (t[table] || []).find(r => String(r[key]) === String(row[key]));
      return existing ? db.update(table, row[key], row, key) : db.insert(table, row);
    }
    const sb = await supabase();
    const { data, error } = await sb.from(table).upsert(row, { onConflict: key }).select().single();
    if (error) throw error;
    return data;
  },
  async remove(table, id, key = 'id') {
    if (DEMO) {
      const t = await demoTables();
      t[table] = (t[table] || []).filter(r => String(r[key]) !== String(id));
      await demoSave(table);
      return;
    }
    const sb = await supabase();
    const { error } = await sb.from(table).delete().eq(key, id);
    if (error) throw error;
  },
  async rpc(fn, args = {}) {
    if (DEMO) {
      if (fn === 'has_admin') return true;
      if (fn === 'bump_listing_view') {
        const t = await demoTables();
        const l = t.listings.find(r => r.id === args.p_id);
        if (l) { l.views = (l.views || 0) + 1; await demoSave('listings'); }
      }
      return null;
    }
    const sb = await supabase();
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw error;
    return data;
  }
};

// ---------- Файлы ----------
export async function compressImage(file, maxDim = 1600, quality = 0.82) {
  if (!file.type.startsWith('image/')) return file;
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  if (width > maxDim || height > maxDim) {
    const k = maxDim / Math.max(width, height);
    width = Math.round(width * k); height = Math.round(height * k);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  return await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
}
function blobToDataUrl(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}
/** Загрузка файла: photos — публичный бакет (вернёт url), incoming — закрытый (вернёт path) */
export async function uploadFile(bucket, file, folder = '') {
  const isImg = file.type.startsWith('image/');
  const body = isImg ? await compressImage(file, bucket === 'photos' ? 1800 : 1400) : file;
  const ext = isImg ? 'jpg' : (file.name.split('.').pop() || 'bin').toLowerCase();
  const path = `${folder ? folder + '/' : ''}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  if (DEMO) {
    const small = isImg ? await compressImage(file, 900, 0.7) : body;
    const url = await blobToDataUrl(small);
    return { path: url, url };
  }
  const sb = await supabase();
  const { error } = await sb.storage.from(bucket).upload(path, body, { contentType: isImg ? 'image/jpeg' : file.type, upsert: false });
  if (error) throw error;
  const url = bucket === 'photos' ? sb.storage.from(bucket).getPublicUrl(path).data.publicUrl : null;
  return { path, url };
}
export async function signedUrl(bucket, path) {
  if (DEMO || path.startsWith('data:') || path.startsWith('http')) return path;
  const sb = await supabase();
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

// ---------- Авторизация (только для админки) ----------
const DEMO_AUTH = 'qadam-demo-auth';
export const auth = {
  async user() {
    if (DEMO) return session.get(DEMO_AUTH);
    const sb = await supabase();
    const { data } = await sb.auth.getSession();
    return data.session?.user || null;
  },
  async profile() {
    const user = await auth.user();
    if (!user) return null;
    if (DEMO) return { id: user.id, email: user.email, full_name: 'Демо-администратор', role: 'admin' };
    const sb = await supabase();
    const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) throw error;
    return data;
  },
  async signIn(email, password) {
    if (DEMO) { session.set(DEMO_AUTH, { id: 'demo', email: email || 'demo@qadam.kz' }); return; }
    const sb = await supabase();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },
  async signUp(email, password, full_name) {
    if (DEMO) return auth.signIn(email, password);
    const sb = await supabase();
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { full_name }, emailRedirectTo: new URL('admin.html', location.href).href }
    });
    if (error) throw error;
    return data;
  },
  async resetPassword(email) {
    if (DEMO) return;
    const sb = await supabase();
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: new URL('admin.html', location.href).href });
    if (error) throw error;
  },
  async updatePassword(password) {
    const sb = await supabase();
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw error;
  },
  async signOut() {
    if (DEMO) { session.del(DEMO_AUTH); return; }
    const sb = await supabase();
    await sb.auth.signOut();
  }
};

// ---------- Настройки компании ----------
const SETTINGS_DEFAULTS = {
  company: { name: 'Qadam', tagline: 'недвижимость и оценка', slogan: '', legal_name: '', bin: '', about: '', appraiser_note: '' },
  contacts: { phone: '', whatsapp: '', telegram: '', instagram: '', email: '', city: '', address: '', hours: '', lat: 51.1282, lng: 71.4306, two_gis_url: '' },
  finance: { year: 2026, mrp: 4325, ipn_rate: 10, ipn_rate_high: 15, ipn_threshold_mrp: 8500, gov_fee_apartment: 1304, fast_registration: 5000,
    con_contract: 8500, notary_mrp_nonrel: 12, notary_mrp_rel: 7, notary_mrp_legal: 17, spouse_consent_mrp: 1.5, mortgage_contract_mrp: 4, pledge_mrp: 4,
    valuation_min: 20000, usd_rate: null },
  home: { hero_title: '', hero_sub: '', promise: '' }
};
let settingsPromise = null;
export function getSettings() {
  if (!settingsPromise) {
    settingsPromise = db.list('settings').then(rows => {
      const s = clone(SETTINGS_DEFAULTS);
      for (const r of rows) s[r.key] = { ...(s[r.key] || {}), ...r.value };
      return s;
    }).catch(() => clone(SETTINGS_DEFAULTS));
  }
  return settingsPromise;
}

// ============================================================
// Справочники и форматирование
// ============================================================
export const DEAL = { sale: 'Продажа', rent: 'Аренда', daily: 'Посуточно' };
export const PTYPE = { apartment: 'Квартира', house: 'Дом, дача', commercial: 'Коммерческая', land: 'Участок', garage: 'Гараж, паркинг', room: 'Комната' };
export const LISTING_STATUS = { draft: 'Черновик', published: 'Опубликован', reserved: 'Бронь', sold: 'Продан / сдан', archived: 'Архив' };
export const LEAD_KIND = { buy: 'Покупка', sell: 'Продажа', rent: 'Снять', rent_out: 'Сдать', valuation: 'Оценка', mortgage: 'Ипотека',
  legal: 'Юридическая помощь', consult: 'Консультация', viewing: 'Просмотр объекта', callback: 'Обратный звонок', other: 'Другое' };
export const LEAD_STATUS = { new: 'Новая', in_work: 'В работе', meeting: 'Показ / встреча', deal: 'Сделка', done: 'Завершена', rejected: 'Отказ' };
export const VAL_CAT = { real_estate: 'Недвижимость', transport: 'Транспорт', equipment: 'Оборудование и имущество', business: 'Бизнес и активы', damage: 'Ущерб', other: 'Другое' };
export const VAL_STATUS = { new: 'Новый', agreed: 'Договор', inspection: 'Осмотр', report: 'Готовим отчёт', done: 'Отчёт выдан', cancelled: 'Отменён' };
export const SERVICE_CAT = { buy: 'Покупка', sell: 'Продажа', rent: 'Аренда', commercial: 'Коммерческая недвижимость', valuation: 'Оценка', legal: 'Юридические услуги', mortgage: 'Ипотека', extra: 'Дополнительно' };

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function num(n, digits = 0) {
  const v = Number(n);
  if (!isFinite(v)) return '—';
  return v.toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
export function money(n) { return n === null || n === undefined || n === '' ? '—' : num(Math.round(Number(n))) + ' ₸'; }
export function moneyShort(n) {
  const v = Number(n) || 0;
  if (v >= 1e9) return num(v / 1e9, 2) + ' млрд';
  if (v >= 1e6) return num(v / 1e6, v >= 1e8 ? 0 : 1) + ' млн';
  if (v >= 1e3) return num(v / 1e3, 0) + ' тыс';
  return num(v);
}
/** Плавно «докрутить» число в элементе до нового значения (итоги калькуляторов, счётчики) */
export function animateValue(el, to, fmt = v => num(Math.round(v)), duration = 600) {
  if (!el) return;
  const from = Number(el.dataset.v ?? 0);
  el.dataset.v = to;
  cancelAnimationFrame(el._raf);
  if (!isFinite(to) || from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = t => {
    const k = Math.min(1, (t - t0) / duration);
    el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}
export function skeletonCards(n = 3) {
  return Array.from({ length: n }, () => `<div class="card skeleton" aria-hidden="true"><div class="card-media skel"></div>
    <div class="card-body"><div class="skel" style="height:26px;width:62%"></div><div class="skel" style="height:14px;width:40%"></div>
    <div class="skel" style="height:18px;width:90%"></div><div class="skel" style="height:14px;width:75%"></div></div></div>`).join('');
}
export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
export function fmtDateRu(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}.${m[2]}.${m[1].slice(2)}`;
  const d = new Date(v);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
export function fmtDateTimeRu(v) {
  const d = new Date(v);
  if (isNaN(d)) return '';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
export function fmtDateLong(v) {
  const d = new Date(v);
  return isNaN(d) ? '' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}
export function phoneDigits(p) { return String(p || '').replace(/\D/g, ''); }
/** 11 цифр 7XXXXXXXXXX или '' — принимает +7…, 8…, и номер без кода страны (701 222 33 44) */
export function normalizePhone(p) {
  let d = phoneDigits(p);
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return d.length === 11 && d[0] === '7' ? d : '';
}
export function formatPhone(p) {
  const d = normalizePhone(p);
  return d ? `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}` : (p || '');
}
export function waLink(digits, text = '') {
  const d = phoneDigits(digits);
  return d ? `https://wa.me/${d}${text ? '?text=' + encodeURIComponent(text) : ''}` : '';
}

// ---------- Ссылки (обычные параметры или #токен для предпросмотра) ----------
export function link(page, params = {}) {
  const entries = Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined);
  if (!entries.length) return page;
  if (CONFIG.hashLinks) { const [k, v] = entries[0]; return `${page}#${v === '1' ? k : v}`; }
  return `${page}?${new URLSearchParams(entries)}`;
}
/** Значение параметра: ?name=… или, если параметров нет, #значение */
export function param(name) {
  const v = new URLSearchParams(location.search).get(name);
  if (v !== null) return v;
  const h = decodeURIComponent(location.hash.slice(1));
  return h || null;
}

// ============================================================
// Иконки (обводка 1.6, 24×24)
// ============================================================
const ICONS = {
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  whatsapp: '<path d="M4 20l1.3-4A8 8 0 1 1 8 19.1z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-1.8-1.8l.8-1-1-2z"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  map: '<path d="M9 4L3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2M14 9l2 2"/>',
  crane: '<path d="M6 21V4l12 3H6M6 7l6 4M16 7v5"/><path d="M14 12h4v3h-4zM3 21h8"/>',
  house: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-6h4v6"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  sofa: '<path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/><path d="M3 12a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v6H3zM6 18v2M18 18v2"/>',
  door: '<path d="M6 21V3h10v18M4 21h16"/><circle cx="13" cy="12" r=".8"/>',
  shield: '<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  office: '<path d="M4 21V5l8-2v18M12 8h8v13M4 21h16"/><path d="M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  ruler: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  car: '<path d="M5 16l1.5-5a2 2 0 0 1 2-1.5h7a2 2 0 0 1 2 1.5L19 16"/><rect x="3" y="16" width="18" height="4" rx="1"/><circle cx="7" cy="20" r="1"/><circle cx="17" cy="20" r="1"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  check: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>',
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  plan: '<rect x="3" y="3" width="18" height="18"/><path d="M3 12h7M14 12h7M12 3v5M12 16v5"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  bank: '<path d="M3 9l9-5 9 5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  pin: '<path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.3 10.8l7.4-3.6M8.3 13.2l7.4 3.6"/>',
  compare: '<path d="M8 4v16M16 4v16M4 8h8M12 16h8"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M8 18h2M12 18h2M16 15v3"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  logout: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  telegram: '<path d="M21 4L3 11l6 2 2 6 3-4 5 4z"/><path d="M9 13l9-7"/>',
  instagram: '<rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.5"/><circle cx="16.8" cy="7.2" r=".8"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'
};
export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// Логотип: квадрат плана с дверным проёмом и ступенькой — «қадам» значит «шаг»
export function logoMark() {
  return `<svg class="logo-mark" viewBox="0 0 34 34" fill="none" aria-hidden="true">
    <rect x="1.5" y="1.5" width="31" height="31" rx="4" fill="var(--accent)"/>
    <path d="M8 26V8h18v11" stroke="var(--accent-ink)" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M17 26h9v-3.5h-4.5V19H26" stroke="var(--accent-ink)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M8 17h5" stroke="var(--accent-ink)" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`;
}

// ============================================================
// Планировка-заглушка вместо фото (рисуется по типу объекта и числу комнат)
// ============================================================
function rnd(seed) { let s = Number(seed) * 9301 + 49297; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); }
export function planSvg(l = {}) {
  const W = 400, H = 300, p = 34;
  const r = rnd(l.id || 7);
  const line = 'stroke="var(--plan-line)" stroke-width="2.5" fill="none"';
  const thin = 'stroke="var(--plan-line)" stroke-width="1" fill="none"';
  const txt = (x, y, s, size = 11) => `<text x="${x}" y="${y}" font-family="IBM Plex Mono, monospace" font-size="${size}" fill="var(--ink-3)" text-anchor="middle">${esc(s)}</text>`;
  let inner = '';
  const t = l.property_type || 'apartment';
  if (t === 'land') {
    const pts = [[p + 10, p + 20], [W - p - 30, p], [W - p, H - p - 40], [p + 40, H - p]];
    inner += `<polygon points="${pts.map(q => q.join(',')).join(' ')}" ${line} stroke-dasharray="8 6"/>`;
    for (let i = 0; i < 5; i++) {
      const x = p + 70 + r() * 220, y = p + 60 + r() * 140;
      inner += `<circle cx="${x}" cy="${y}" r="${9 + r() * 7}" ${thin}/>`;
    }
    inner += txt(W / 2, H / 2 + 4, l.land_area ? `${num(l.land_area, 2)} сот.` : 'участок', 15);
  } else if (t === 'house') {
    inner += `<rect x="${p}" y="${p}" width="${W - 2 * p}" height="${H - 2 * p}" ${thin} stroke-dasharray="6 5"/>`;
    const hx = p + 50, hy = p + 40, hw = 200, hh = 150;
    inner += `<rect x="${hx}" y="${hy}" width="${hw}" height="${hh}" ${line}/>`;
    inner += `<path d="M${hx + hw * 0.55} ${hy}V${hy + hh * 0.6}M${hx} ${hy + hh * 0.6}H${hx + hw}" ${line}/>`;
    inner += `<rect x="${hx + hw + 24}" y="${hy + 20}" width="60" height="70" ${thin}/>`;
    inner += txt(hx + hw / 2, hy + hh + 22, l.area_total ? `дом ${num(l.area_total, 1)} м²` : 'дом');
    if (l.land_area) inner += txt(W - p - 40, H - p - 10, `${num(l.land_area, 2)} сот.`);
  } else if (t === 'commercial') {
    inner += `<rect x="${p}" y="${p}" width="${W - 2 * p}" height="${H - 2 * p}" ${line}/>`;
    for (let i = 1; i < 4; i++) for (let j = 1; j < 3; j++) {
      inner += `<rect x="${p + i * (W - 2 * p) / 4 - 5}" y="${p + j * (H - 2 * p) / 3 - 5}" width="10" height="10" fill="var(--plan-line)"/>`;
    }
    inner += `<path d="M${p + 40} ${H - p}h60" stroke="var(--plan-fill)" stroke-width="5"/>`;
    inner += txt(W / 2, H / 2 + 4, l.area_total ? `${num(l.area_total, 1)} м²` : 'помещение', 15);
  } else if (t === 'garage') {
    inner += `<path d="M${p + 60} ${p}V${H - p}M${W - p - 60} ${p}V${H - p}" ${line}/>`;
    inner += `<rect x="${W / 2 - 50}" y="${p + 40}" width="100" height="170" rx="22" ${thin}/>`;
    inner += `<rect x="${W / 2 - 38}" y="${p + 80}" width="76" height="40" rx="8" ${thin}/>`;
    inner += txt(W / 2, H - p + 18, l.area_total ? `${num(l.area_total, 1)} м²` : 'машиноместо');
  } else {
    const rooms = Math.max(1, Math.min(5, Number(l.rooms) || 1));
    const x0 = p, y0 = p, w = W - 2 * p, h = H - 2 * p;
    const split = y0 + h * (0.55 + r() * 0.08);
    inner += `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" ${line}/>`;
    inner += `<path d="M${x0} ${split}H${x0 + w}" ${line}/>`;
    const widths = Array.from({ length: rooms }, () => 0.8 + r() * 0.5);
    const sum = widths.reduce((a, b) => a + b, 0);
    let cx = x0;
    widths.forEach((ww, i) => {
      const rw = (ww / sum) * w;
      if (i > 0) inner += `<path d="M${cx} ${y0}V${split}" ${line}/>`;
      inner += txt(cx + rw / 2, y0 + (split - y0) / 2 + 4, rooms === 1 && !l.rooms ? 'студия' : 'комната');
      inner += `<path d="M${cx + rw / 2 - 14} ${split}h28" stroke="var(--plan-fill)" stroke-width="4"/>`;
      cx += rw;
    });
    const kx = x0 + w * (0.38 + r() * 0.06), bx = x0 + w * (0.72 + r() * 0.05);
    inner += `<path d="M${kx} ${split}V${y0 + h}M${bx} ${split}V${y0 + h}" ${line}/>`;
    inner += txt((x0 + kx) / 2, split + (y0 + h - split) / 2 + 4, 'кухня');
    inner += txt((kx + bx) / 2, split + (y0 + h - split) / 2 + 4, 'холл');
    inner += txt((bx + x0 + w) / 2, split + (y0 + h - split) / 2 + 4, 'с/у');
    inner += `<path d="M${x0 + w * 0.48} ${y0 + h}h36" stroke="var(--plan-fill)" stroke-width="5"/>`;
  }
  // Размерная линия с площадью — как в техпаспорте
  const area = l.area_total ? `S = ${num(l.area_total, 1)} м²` : '';
  const dim = area && t !== 'land' ? `<path d="M${p} ${H - 12}H${W - p}M${p} ${H - 17}v10M${W - p} ${H - 17}v10" ${thin}/>
    <rect x="${W / 2 - 52}" y="${H - 21}" width="104" height="18" fill="var(--plan-fill)"/>${txt(W / 2, H - 8, area, 11)}` : '';
  return `<svg class="plan" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Схема: ${esc(PTYPE[t] || '')}" style="width:100%;height:100%;background:var(--plan-fill)">${inner}${dim}</svg>`;
}

// ============================================================
// Объекты: заголовок, характеристики, карточка
// ============================================================
export function listingTitle(l) {
  if (l.title) return l.title;
  if (l.property_type === 'apartment') return `${l.rooms ? l.rooms + '-комнатная квартира' : 'Квартира'}${l.area_total ? ', ' + num(l.area_total, 1) + ' м²' : ''}`;
  return PTYPE[l.property_type] || 'Объект';
}
export function listingSpecs(l) {
  const s = [];
  if (l.area_total) s.push(`${num(l.area_total, 1)} м²`);
  if (l.property_type === 'apartment' || l.property_type === 'room') s.push(l.rooms ? `${l.rooms} комн.` : 'студия');
  if (l.property_type === 'house' && l.rooms) s.push(`${l.rooms} комн.`);
  if (l.floor && l.floors_total) s.push(`${l.floor}/${l.floors_total} эт.`);
  else if (l.floors_total && l.property_type === 'house') s.push(`${l.floors_total} ${plural(l.floors_total, ['этаж', 'этажа', 'этажей'])}`);
  if (l.land_area) s.push(`${num(l.land_area, 2)} сот.`);
  return s;
}
export function priceLabel(l) {
  const suffix = l.deal_type === 'rent' ? ' <small>/ мес</small>' : l.deal_type === 'daily' ? ' <small>/ сутки</small>' : '';
  return `${money(l.price)}${suffix}`;
}
export function pricePerM2(l) {
  if (l.deal_type !== 'sale' || !l.area_total || !l.price) return '';
  return `${num(Math.round(l.price / l.area_total))} ₸ за м²`;
}
export function cover(l) {
  return l.photos && l.photos.length
    ? `<img src="${esc(l.photos[0])}" alt="${esc(listingTitle(l))}" loading="lazy">`
    : planSvg(l);
}
export function listingBadges(l) {
  const b = [];
  if (l.status === 'reserved') b.push('<span class="badge warn">Бронь</span>');
  if (l.status === 'sold') b.push('<span class="badge">' + (l.deal_type === 'sale' ? 'Продано' : 'Сдано') + '</span>');
  if (l.is_new_building) b.push('<span class="badge accent">Новостройка</span>');
  if (l.mortgage_ok && l.deal_type === 'sale') b.push('<span class="badge ok">Ипотека</span>');
  if (l.installment_ok) b.push('<span class="badge gold">Рассрочка</span>');
  if (l.is_demo) b.push('<span class="badge demo" title="Демо-объект: замените в админке">демо</span>');
  return b.join('');
}
export function listingCard(l, ctx = {}) {
  const city = ctx.cities?.get(l.city_id);
  const district = ctx.districts?.get(l.district_id);
  const where = [city?.name, district?.name].filter(Boolean).join(', ');
  const isFav = favorites.has(l.id);
  return `<article class="card" data-id="${l.id}">
    <div class="card-media">${cover(l)}
      <div class="badges">${listingBadges(l)}</div>
      <button class="fav-btn fav" type="button" data-fav="${l.id}" aria-pressed="${isFav}" aria-label="В избранное">${icon('heart')}</button>
    </div>
    <div class="card-body">
      <div class="price">${priceLabel(l)}</div>
      ${pricePerM2(l) ? `<div class="price-m2">${pricePerM2(l)}</div>` : ''}
      <a class="card-title" href="${link('object.html', { id: l.id })}">${esc(listingTitle(l))}</a>
      <div class="specs">${listingSpecs(l).map(s => `<span>${esc(s)}</span>`).join('')}</div>
      <div class="card-addr">${esc(where)}${l.address ? ' · ' + esc(l.address) : ''}</div>
      <div class="card-foot"><span>${DEAL[l.deal_type] || ''} · ${PTYPE[l.property_type] || ''}</span><span class="mono">${esc(l.code || '')}</span></div>
    </div>
  </article>`;
}
export const byId = rows => new Map(rows.map(r => [r.id, r]));

// ---------- Избранное, сравнение, недавно просмотренные ----------
function idSet(key, max) {
  return {
    all: () => store.get(key, []),
    has: id => store.get(key, []).includes(Number(id)),
    toggle(id) {
      id = Number(id);
      let list = store.get(key, []);
      const on = !list.includes(id);
      list = on ? [id, ...list] : list.filter(x => x !== id);
      if (max) list = list.slice(0, max);
      store.set(key, list);
      updateCounters();
      return on;
    },
    remove(id) { store.set(key, store.get(key, []).filter(x => x !== Number(id))); updateCounters(); },
    push(id) { id = Number(id); store.set(key, [id, ...store.get(key, []).filter(x => x !== id)].slice(0, max || 50)); }
  };
}
export const favorites = idSet('qadam-fav');
export const compare = idSet('qadam-compare', 4);
export const recent = idSet('qadam-recent', 12);
function updateCounters() {
  const n = favorites.all().length;
  document.querySelectorAll('[data-fav-count]').forEach(el => { el.textContent = n; el.hidden = !n; });
}
// Один обработчик на весь документ — работает и для карточек, отрисованных позже
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-fav]');
  if (!btn) return;
  e.preventDefault();
  const on = favorites.toggle(btn.dataset.fav);
  document.querySelectorAll(`[data-fav="${btn.dataset.fav}"]`).forEach(b => b.setAttribute('aria-pressed', on));
  toast(on ? 'Добавлено в избранное' : 'Убрано из избранного');
});

// ============================================================
// Уведомления и модальные окна
// ============================================================
export function toast(text, isError = false) {
  let box = document.querySelector('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.append(box); }
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' err' : '');
  t.textContent = text;
  box.append(t);
  setTimeout(() => t.remove(), isError ? 6000 : 3200);
}
export function errText(e) {
  const m = e?.message || String(e);
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Нет соединения с сервером. Проверьте интернет и попробуйте ещё раз.';
  if (/Invalid login/i.test(m)) return 'Неверный e-mail или пароль.';
  if (/Email not confirmed/i.test(m)) return 'E-mail не подтверждён — откройте письмо от Supabase и перейдите по ссылке.';
  if (/row-level security|permission/i.test(m)) return 'Недостаточно прав для этого действия.';
  return m;
}
export function openModal(html, { wide = false, onClose } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  back.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  const first = back.querySelector('input, select, textarea, button:not([data-close])');
  first?.focus();
  return { el: back.querySelector('.modal'), close };
}

// ============================================================
// Форма заявки — одна на весь сайт
// ============================================================
export function phoneInput(el) {
  const mask = d => {
    let out = d ? '+7' : '';
    if (d.length > 1) out += ' (' + d.slice(1, 4);
    if (d.length >= 4) out += ') ' + d.slice(4, 7);
    if (d.length >= 7) out += '-' + d.slice(7, 9);
    if (d.length >= 9) out += '-' + d.slice(9, 11);
    return out;
  };
  let prev = '';
  el.addEventListener('input', e => {
    let d = phoneDigits(el.value);
    // Стёрли скобку или дефис — стираем и цифру перед ними, иначе маска вернёт символ обратно
    if (e.inputType === 'deleteContentBackward' && d === prev) d = d.slice(0, -1);
    if (d[0] === '8') d = '7' + d.slice(1);
    if (d && d[0] !== '7') d = '7' + d;
    // «70…» после кода страны не бывает — это номер без кода (701 222 33 44)
    else if (d[1] === '0') d = '7' + d;
    d = d.slice(0, 11);
    prev = d;
    el.value = mask(d);
  });
  // Номер без кода страны с 74…/75…/77… дописывается до полного при выходе из поля
  el.addEventListener('blur', () => { const n = normalizePhone(el.value); if (n) { prev = n; el.value = formatPhone(n); } });
}
export function validPhone(v) { return !!normalizePhone(v); }

/**
 * openLead({ kind, title, subtitle, listing, service_id, payload, message, fields })
 * fields — дополнительные поля формы: [{ name, label, type:'text'|'select'|'number', options:[] }]
 */
export async function openLead(opts = {}) {
  const s = await getSettings();
  const extra = (opts.fields || []).map(f => `<div class="field ${f.full ? 'full' : ''}"><label for="lf-${f.name}">${esc(f.label)}</label>${
    f.type === 'select'
      ? `<select class="input" id="lf-${f.name}" name="x_${f.name}">${f.options.map(o => `<option>${esc(o)}</option>`).join('')}</select>`
      : `<input class="input" id="lf-${f.name}" name="x_${f.name}" type="${f.type || 'text'}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}>`
  }</div>`).join('');
  const { el, close } = openModal(`
    <div class="modal-head">
      <div class="stack" style="gap:6px">
        <span class="eyebrow accent">${esc(LEAD_KIND[opts.kind] || 'Заявка')}</span>
        <h2>${esc(opts.title || 'Оставьте заявку')}</h2>
        ${opts.subtitle ? `<p class="muted small">${esc(opts.subtitle)}</p>` : ''}
      </div>
      <button class="icon-btn" type="button" data-close aria-label="Закрыть">${icon('close')}</button>
    </div>
    <form class="form-grid" novalidate>
      <div class="field"><label for="lf-name">Имя</label><input class="input" id="lf-name" name="name" autocomplete="name" placeholder="Как к вам обращаться"></div>
      <div class="field"><label for="lf-phone">Телефон *</label><input class="input" id="lf-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="+7 (7__) ___-__-__" required></div>
      ${extra}
      <div class="field full"><label for="lf-msg">Комментарий</label><textarea class="input" id="lf-msg" name="message" rows="3" placeholder="Удобное время звонка, вопросы, детали">${esc(opts.message || '')}</textarea></div>
      <label class="check full"><input type="checkbox" name="consent" required checked> <span>Согласен на обработку персональных данных в соответствии с <a href="privacy.html" target="_blank">политикой конфиденциальности</a></span></label>
      <p class="error-text full" data-err hidden></p>
      <div class="full row between">
        <span class="form-note">${esc(s.home.promise || '')}</span>
        <button class="btn lg" type="submit">Отправить заявку</button>
      </div>
    </form>`);
  const form = el.querySelector('form');
  const F = form.elements;
  phoneInput(F.phone);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = form.querySelector('[data-err]');
    err.hidden = true;
    if (!validPhone(F.phone.value)) { err.textContent = 'Укажите телефон полностью: +7 и 10 цифр.'; err.hidden = false; F.phone.focus(); return; }
    if (!F.consent.checked) { err.textContent = 'Нужно согласие на обработку персональных данных.'; err.hidden = false; return; }
    const payload = { ...(opts.payload || {}) };
    for (const f of opts.fields || []) if (F['x_' + f.name]?.value) payload[f.label] = F['x_' + f.name].value;
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = 'Отправляем…';
    try {
      await db.insert('leads', {
        kind: opts.kind || 'consult',
        name: F.name.value.trim() || null,
        phone: formatPhone(F.phone.value),
        message: F.message.value.trim() || null,
        listing_id: opts.listing?.id || null,
        service_id: opts.service_id || null,
        payload,
        source: location.pathname.split('/').pop() || 'index.html'
      }, { returning: false });
      const wa = waLink(s.contacts.whatsapp, `Здравствуйте! Оставил(а) заявку на сайте: ${opts.title || LEAD_KIND[opts.kind] || ''}`);
      el.innerHTML = `<div class="success-state">
        <div class="tick">${icon('check')}</div>
        <h2>Заявка принята</h2>
        <p class="muted">${esc(s.home.promise || 'Мы свяжемся с вами в ближайшее время.')}${DEMO ? ' (Демо-режим: заявка сохранена только в этом браузере.)' : ''}</p>
        <div class="row">${wa ? `<a class="btn ghost" href="${wa}" target="_blank" rel="noopener">${icon('whatsapp')} Написать в WhatsApp</a>` : ''}<button class="btn" type="button" data-close>Готово</button></div>
      </div>`;
    } catch (ex) {
      btn.disabled = false; btn.textContent = 'Отправить заявку';
      err.textContent = 'Не удалось отправить: ' + errText(ex); err.hidden = false;
    }
  });
  return { close };
}
// В предпросмотре (окно внутри другой страницы) ссылки tel: и mailto: не открывают звонилку,
// а уводят всё окно на пустую страницу. Там вместо перехода копируем номер или адрес.
if (CONFIG.preview) {
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="tel:"], a[href^="mailto:"]');
    if (!a) return;
    e.preventDefault();
    const value = decodeURIComponent(a.getAttribute('href').replace(/^(tel|mailto):/, ''));
    const shown = a.href.startsWith('tel:') ? formatPhone(value) : value;
    const done = () => toast(`Скопировано: ${shown}. На настоящем сайте здесь откроется ${a.href.startsWith('tel:') ? 'звонок' : 'почта'}.`);
    navigator.clipboard?.writeText(shown).then(done, () => toast(shown)) ?? toast(shown);
  }, true);
}
// Кнопки с data-lead="kind" открывают форму без отдельного кода на странице
document.addEventListener('click', e => {
  const b = e.target.closest('[data-lead]');
  if (!b) return;
  e.preventDefault();
  openLead({ kind: b.dataset.lead, title: b.dataset.title || undefined, subtitle: b.dataset.subtitle || undefined });
});

// ============================================================
// Шапка, мобильное меню, подвал, тема
// ============================================================
const NAV = [
  ['buy', link('catalog.html', { deal: 'sale' }), 'Купить'],
  ['rent', link('catalog.html', { deal: 'rent' }), 'Снять'],
  ['sell', 'sell.html', 'Продать'],
  ['valuation', 'valuation.html', 'Оценка'],
  ['services', 'services.html', 'Услуги'],
  ['calc', 'calculators.html', 'Ипотека'],
  ['guide', 'guide.html', 'Полезное'],
  ['about', 'about.html', 'Контакты']
];
// Тема: сохранённый выбор ставится ещё в <head> (строка в каждой странице), здесь — только переключатель.
// Атрибут без сохранённого выбора не трогаем: его может выставить окно предпросмотра.
export function applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') document.documentElement.setAttribute('data-theme', theme);
}
function currentTheme() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
applyTheme(store.get('qadam-theme'));
export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  const swap = () => {
    applyTheme(next); store.set('qadam-theme', next);
    document.querySelectorAll('[data-theme-toggle]').forEach(b => { b.innerHTML = icon(next === 'dark' ? 'sun' : 'moon'); });
  };
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(swap);
  else swap();
}

// Шапка, подвал и нижняя панель рисуются сразу (из настроек, сохранённых на прошлой странице),
// чтобы при переходах между страницами ничего не прыгало, а после загрузки — обновляются.
function renderChrome(page, s) {
  const c = s.contacts, co = s.company;
  const phone = c.phone || '';
  const tel = phoneDigits(phone) ? `tel:+${phoneDigits(phone)}` : '';
  const wa = waLink(c.whatsapp, 'Здравствуйте! Пишу с сайта.');
  const tg = c.telegram ? `https://t.me/${c.telegram.replace(/^@/, '')}` : '';
  const navHtml = NAV.map(([key, href, label]) => `<a href="${href}" ${key === page ? 'aria-current="page"' : ''}>${label}</a>`).join('');
  const header = document.getElementById('site-header');
  if (header) {
    document.querySelectorAll('.demo-ribbon, .topbar').forEach(el => el.remove());
    if (DEMO && !store.get('qadam-demo-note')) {
      header.insertAdjacentHTML('beforebegin', `<div class="demo-ribbon"><div class="wrap">
        <span>Демонстрационная версия: объекты, цены и контакты на сайте — примеры.</span>
        <button type="button" data-demo-close aria-label="Скрыть">✕</button></div></div>`);
    }
    header.insertAdjacentHTML('beforebegin', `<div class="topbar"><div class="wrap">
      <div class="group">${c.city ? `<span>${icon('pin')} ${esc(c.city)}</span>` : ''}${c.hours ? `<span>${icon('clock')} ${esc(c.hours)}</span>` : ''}</div>
      <div class="group">
        ${wa ? `<a href="${wa}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a>` : ''}
        ${tg ? `<a href="${esc(tg)}" target="_blank" rel="noopener">${icon('telegram')} Telegram</a>` : ''}
        ${c.email ? `<a href="mailto:${esc(c.email)}">${icon('mail')} ${esc(c.email)}</a>` : ''}
        ${phone ? `<span class="sep" aria-hidden="true"></span><a class="tel" href="${tel}">${icon('phone')} ${esc(phone)}</a>` : ''}
      </div></div></div>`);
    header.className = 'site-header';
    header.innerHTML = `<div class="wrap bar">
        <a class="logo" href="index.html">${logoMark()}<span><span class="logo-name">${esc(co.name)}</span><span class="logo-sub">${esc(co.tagline || '')}</span></span></a>
        <nav class="main-nav" aria-label="Разделы">${navHtml}</nav>
        <div class="header-tools">
          <a class="icon-btn" href="favorites.html" aria-label="Избранное">${icon('heart')}<span class="count" data-fav-count hidden>0</span></a>
          <button class="icon-btn" type="button" data-theme-toggle aria-label="Сменить тему">${icon(currentTheme() === 'dark' ? 'sun' : 'moon')}</button>
          <button class="btn sm" type="button" data-lead="callback" data-title="Перезвоните мне">Обратный звонок</button>
          <button class="icon-btn burger" type="button" data-burger aria-label="Меню">${icon('menu')}</button>
        </div>
      </div>`;
  }
  const footer = document.getElementById('site-footer');
  if (footer) {
    footer.className = 'site-footer';
    footer.innerHTML = `<div class="wrap">
      <div class="cols">
        <div class="stack" style="gap:12px">
          <a class="logo" href="index.html">${logoMark()}<span><span class="logo-name">${esc(co.name)}</span><span class="logo-sub">${esc(co.tagline || '')}</span></span></a>
          <p class="small muted" style="max-width:40ch">${esc(co.slogan || '')}</p>
          <div class="row">
            ${wa ? `<a class="icon-btn" href="${wa}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('whatsapp')}</a>` : ''}
            ${tg ? `<a class="icon-btn" href="${esc(tg)}" target="_blank" rel="noopener" aria-label="Telegram">${icon('telegram')}</a>` : ''}
            ${c.instagram ? `<a class="icon-btn" href="https://instagram.com/${esc(c.instagram.replace(/^@/, ''))}" target="_blank" rel="noopener" aria-label="Instagram">${icon('instagram')}</a>` : ''}
          </div>
        </div>
        <div><h4>Объекты</h4><ul>
          <li><a href="${link('catalog.html', { deal: 'sale' })}">Купить квартиру</a></li>
          <li><a href="${link('catalog.html', { deal: 'rent' })}">Снять квартиру</a></li>
          <li><a href="${link('catalog.html', { type: 'house' })}">Дома и участки</a></li>
          <li><a href="${link('catalog.html', { type: 'commercial' })}">Коммерческая</a></li>
          <li><a href="sell.html">Продать или сдать</a></li>
        </ul></div>
        <div><h4>Услуги</h4><ul>
          <li><a href="valuation.html">Оценка имущества</a></li>
          <li><a href="services.html#legal">Юридическое сопровождение</a></li>
          <li><a href="services.html#mortgage">Ипотечный брокер</a></li>
          <li><a href="calculators.html">Калькуляторы</a></li>
          <li><a href="guide.html">Документы и статьи</a></li>
        </ul></div>
        <div><h4>Контакты</h4><ul>
          ${phone ? `<li><a href="${tel}" class="mono">${esc(phone)}</a></li>` : ''}
          ${c.email ? `<li><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></li>` : ''}
          ${c.address ? `<li class="muted">${esc(c.address)}</li>` : ''}
          ${c.hours ? `<li class="muted">${esc(c.hours)}</li>` : ''}
          <li><a href="about.html">О компании и команда</a></li>
        </ul></div>
      </div>
      <div class="legal">
        <span>© ${new Date().getFullYear()} ${esc(co.legal_name || co.name)}${co.bin ? ' · БИН ' + esc(co.bin) : ''}</span>
        <span><a href="privacy.html">Политика конфиденциальности</a> · <a href="admin.html">Вход для сотрудников</a></span>
      </div>
    </div>`;
  }
  if (page !== 'admin') {
    document.querySelector('.action-bar')?.remove();
    const bar = document.createElement('div');
    bar.className = 'action-bar';
    bar.innerHTML = `${tel ? `<a class="btn ghost" href="${tel}">${icon('phone')} Позвонить</a>` : '<a class="btn ghost" href="about.html">Контакты</a>'}
      ${wa ? `<a class="btn ghost" href="${wa}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a>` : '<a class="btn ghost" href="catalog.html">Каталог</a>'}
      <button class="btn" type="button" data-lead="callback" data-title="Перезвоните мне">Заявка</button>`;
    document.body.append(bar);
  }
  updateCounters();
}

/** Подсветить пункт меню, когда раздел определяется уже после загрузки данных (каталог, объект) */
export function markNav(key) {
  document.body.dataset.page = key;
  const href = NAV.find(n => n[0] === key)?.[1];
  document.querySelectorAll('.main-nav a, .mobile-menu a').forEach(a => {
    if (a.getAttribute('href') === href) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

export async function mountLayout() {
  const page = document.body.dataset.page || '';
  const cached = session.get('qadam-settings');
  renderChrome(page, cached || SETTINGS_DEFAULTS);
  document.addEventListener('click', e => {
    if (e.target.closest('[data-theme-toggle]')) toggleTheme();
    if (e.target.closest('[data-burger]')) openMobileMenu(page);
    if (e.target.closest('[data-demo-close]')) { store.set('qadam-demo-note', 1); e.target.closest('.demo-ribbon').remove(); }
  });
  const s = await getSettings();
  if (JSON.stringify(s) !== JSON.stringify(cached)) { session.set('qadam-settings', s); renderChrome(page, s); }
  return s;
}
function openMobileMenu(page) {
  const s = session.get('qadam-settings') || SETTINGS_DEFAULTS;
  const phone = s.contacts.phone || '';
  const tel = phoneDigits(phone) ? `tel:+${phoneDigits(phone)}` : '';
  const m = document.createElement('div');
  m.className = 'mobile-menu';
  m.innerHTML = `<div class="panel">
    <div class="row between" style="margin-bottom:8px"><span class="eyebrow">Меню</span><button class="icon-btn" type="button" data-x aria-label="Закрыть">${icon('close')}</button></div>
    ${NAV.map(([key, href, label]) => `<a class="nav-item" href="${href}" ${key === page ? 'aria-current="page"' : ''}>${label}</a>`).join('')}
    <a class="nav-item" href="favorites.html">Избранное и сравнение</a>
    ${tel ? `<a class="btn ghost block" style="margin-top:16px" href="${tel}">${icon('phone')} ${esc(phone)}</a>` : ''}
  </div>`;
  m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-x]')) m.remove(); });
  document.body.append(m);
}

// ============================================================
// Карты (Leaflet + OpenStreetMap)
// ============================================================
let leafletPromise = null;
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletPromise) {
    leafletPromise = new Promise((res, rej) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = new URL('vendor/leaflet.css', import.meta.url).href;
      document.head.append(css);
      const s = document.createElement('script');
      s.src = new URL('vendor/leaflet.js', import.meta.url).href;
      s.onload = () => res(window.L); s.onerror = rej;
      document.head.append(s);
    });
  }
  return leafletPromise;
}
export async function makeMap(el, { lat, lng, zoom = 12 }) {
  const L = await loadLeaflet();
  const map = L.map(el, { scrollWheelZoom: false }).setView([lat, lng], zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© участники OpenStreetMap' }).addTo(map);
  return { L, map };
}
export function pricePin(L, text) {
  return L.divIcon({ className: 'pin-wrap', html: `<span class="price-pin">${esc(text)}</span>`, iconSize: [0, 0] });
}

// ============================================================
// Мини-разметка статей: ## заголовок, - список, 1. список, > врезка, | таблица |, **жирный**, [текст](https://…)
// ============================================================
function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|[a-z0-9-]+\.html[^)\s]*)\)/g, '<a href="$2">$1</a>');
}
export function md(text = '') {
  const lines = String(text).replace(/\r/g, '').split('\n');
  let html = '', i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (!ln.trim()) { i++; continue; }
    if (ln.startsWith('### ')) { html += `<h3>${inline(ln.slice(4))}</h3>`; i++; continue; }
    if (ln.startsWith('## ')) { html += `<h2>${inline(ln.slice(3))}</h2>`; i++; continue; }
    if (ln.startsWith('> ')) { html += `<div class="callout">${inline(ln.slice(2))}</div>`; i++; continue; }
    if (/^\s*[-•]\s/.test(ln)) {
      html += '<ul>';
      while (i < lines.length && /^\s*[-•]\s/.test(lines[i])) html += `<li>${inline(lines[i++].replace(/^\s*[-•]\s/, ''))}</li>`;
      html += '</ul>'; continue;
    }
    if (/^\s*\d+\.\s/.test(ln)) {
      html += '<ol>';
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) html += `<li>${inline(lines[i++].replace(/^\s*\d+\.\s/, ''))}</li>`;
      html += '</ol>'; continue;
    }
    if (ln.trim().startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const body = rows.filter(r => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      const [head, ...rest] = body;
      html += `<div class="table-wrap"><table class="t"><thead><tr>${cells(head).map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
        rest.map(r => `<tr>${cells(r).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,3} |> |\s*[-•]\s|\s*\d+\.\s|\s*\|)/.test(lines[i])) para.push(lines[i++]);
    html += `<p>${inline(para.join(' '))}</p>`;
  }
  return html;
}

// ============================================================
// Расчёты: оценка, ипотека, налог, расходы, доходность
// ============================================================
export function factorMap(rows) {
  const m = {};
  for (const r of rows) (m[r.factor] = m[r.factor] || []).push(r);
  for (const k in m) m[k].sort((a, b) => a.sort - b.sort);
  return m;
}
function coef(factors, factor, key) {
  const f = (factors[factor] || []).find(o => o.option_key === key);
  return f ? { k: Number(f.coef), label: f.label } : { k: 1, label: '' };
}
export function yearBand(y) {
  y = Number(y);
  if (!y) return null;
  if (y >= 2020) return 'y2020';
  if (y >= 2011) return 'y2011_2019';
  if (y >= 1991) return 'y1991_2010';
  if (y >= 1960) return 'y1960_1990';
  return 'y_lt1960';
}
export function roomsBand(r) {
  r = Number(r);
  if (!r) return 'studio';
  return r >= 4 ? 'r4' : 'r' + r;
}
/**
 * Онлайн-оценка недвижимости по средним ценам города и поправкам.
 * input: { kind:'apartment'|'house'|'land'|'commercial', deal:'sale'|'rent', city_id, district_id, area, land_area, rooms,
 *          floor_pos, building_type, condition, year, extras:[], land_comm }
 */
export function estimateProperty(input, { priceIndex, factors, districts }) {
  const pi = priceIndex.find(p => p.city_id === Number(input.city_id));
  if (!pi) return null;
  const district = districts.find(d => d.id === Number(input.district_id));
  const steps = [];
  let base, qty, unit;
  const rent = input.deal === 'rent';
  if (input.kind === 'land') {
    base = Number(pi.land_sotka); qty = Number(input.land_area) || 0; unit = 'сотка';
  } else if (input.kind === 'commercial') {
    base = Number(rent ? pi.commercial_rent_m2 : pi.commercial_sale_m2); qty = Number(input.area) || 0; unit = 'м²';
  } else if (input.kind === 'house') {
    base = Number(rent ? pi.apt_rent_m2 * 0.85 : pi.house_sale_m2); qty = Number(input.area) || 0; unit = 'м²';
  } else {
    base = Number(rent ? pi.apt_rent_m2 : pi.apt_sale_m2); qty = Number(input.area) || 0; unit = 'м²';
  }
  if (!base || !qty) return null;
  steps.push({ label: `Средняя цена за ${unit} по городу`, value: base, kind: 'base' });
  let k = 1;
  const add = (label, c) => { if (c && c !== 1) { k *= c; steps.push({ label, value: c, kind: 'coef' }); } };
  if (district) add(`Район: ${district.name}`, Number(district.price_coef));
  if (input.kind === 'apartment' || input.kind === 'house' || input.kind === 'commercial') {
    if (input.building_type && input.kind !== 'commercial') { const c = coef(factors, 'building_type', input.building_type); add(`Материал: ${c.label}`, c.k); }
    if (input.condition) { const c = coef(factors, 'condition', input.condition); add(`Состояние: ${c.label}`, c.k); }
    const yb = yearBand(input.year);
    if (yb && input.kind !== 'commercial') { const c = coef(factors, 'year', yb); add(`Год постройки: ${c.label}`, c.k); }
  }
  if (input.kind === 'apartment') {
    if (input.floor_pos) { const c = coef(factors, 'floor', input.floor_pos); add(c.label, c.k); }
    const c = coef(factors, 'rooms', roomsBand(input.rooms)); add(`Комнатность: ${c.label}`, c.k);
    for (const x of input.extras || []) { const e = coef(factors, 'extra', x); add(e.label, e.k); }
  }
  if (input.kind === 'land' && input.land_comm) { const c = coef(factors, 'land_comm', input.land_comm); add(`Коммуникации: ${c.label}`, c.k); }
  let value = base * k * qty;
  let landPart = 0;
  if (input.kind === 'house' && !rent && Number(input.land_area)) {
    landPart = Number(pi.land_sotka) * 0.6 * Number(input.land_area) * (district ? Number(district.price_coef) : 1);
    steps.push({ label: `Земля под домом: ${num(input.land_area, 2)} сот.`, value: landPart, kind: 'add' });
    value += landPart;
  }
  const round = rent ? 5000 : 100000;
  value = Math.round(value / round) * round;
  const spread = input.kind === 'apartment' ? 0.07 : 0.12;
  return {
    value,
    low: Math.round(value * (1 - spread) / round) * round,
    high: Math.round(value * (1 + spread) / round) * round,
    perUnit: Math.round((value - landPart) / qty),
    unit, steps, k, source: pi.source, period: pi.period
  };
}
/** Экспресс-оценка автомобиля: от цены нового аналога через кривую износа */
export function estimateAuto({ priceNew, year, mileage, condition, accident }, factors) {
  const now = new Date().getFullYear();
  const age = Math.max(0, now - Number(year));
  let k = age === 0 ? 0.9 : 0.82 * Math.pow(0.88, age - 1);
  k = Math.max(k, 0.12);
  const steps = [{ label: `Возраст ${age} ${plural(age, ['год', 'года', 'лет'])}: остаточная доля`, value: k, kind: 'coef' }];
  const norm = 20000 * Math.max(age, 0.5);
  const km = Number(mileage) || norm;
  const mk = Math.min(1.1, Math.max(0.8, 1 - ((km - norm) / 1000) * 0.004));
  steps.push({ label: `Пробег ${num(km)} км при норме ${num(norm)} км`, value: mk, kind: 'coef' });
  const c = coef(factors, 'auto_condition', condition), a = coef(factors, 'auto_accident', accident);
  if (c.label) steps.push({ label: `Состояние: ${c.label}`, value: c.k, kind: 'coef' });
  if (a.label) steps.push({ label: a.label, value: a.k, kind: 'coef' });
  const value = Math.round(Number(priceNew) * k * mk * c.k * a.k / 10000) * 10000;
  return { value, low: Math.round(value * 0.9 / 10000) * 10000, high: Math.round(value * 1.1 / 10000) * 10000, steps };
}
/** Экспресс-оценка оборудования: линейный износ по сроку службы */
export function estimateEquipment({ price, age, life, condition }, factors) {
  const remain = Math.max(0.1, 1 - Number(age) / Math.max(1, Number(life)));
  const c = coef(factors, 'equip_condition', condition);
  const value = Math.round(Number(price) * remain * c.k / 1000) * 1000;
  return {
    value, low: Math.round(value * 0.85 / 1000) * 1000, high: Math.round(value * 1.15 / 1000) * 1000,
    steps: [
      { label: `Остаток срока службы: ${num(Math.max(0, life - age), 1)} из ${num(life)} лет`, value: remain, kind: 'coef' },
      ...(c.label ? [{ label: `Состояние: ${c.label}`, value: c.k, kind: 'coef' }] : [])
    ]
  };
}
export function mortgage({ price, down, rate, years, type = 'annuity' }) {
  const P = Math.max(0, Number(price) - Number(down));
  const n = Math.round(Number(years) * 12);
  const r = Number(rate) / 100 / 12;
  if (!P || !n) return null;
  const schedule = [];
  let bal = P, total = 0, first = 0, last = 0;
  const ann = r ? P * r / (1 - Math.pow(1 + r, -n)) : P / n;
  for (let m = 1; m <= n; m++) {
    const interest = bal * r;
    const principal = type === 'annuity' ? ann - interest : P / n;
    const pay = principal + interest;
    bal = Math.max(0, bal - principal);
    total += pay;
    if (m === 1) first = pay;
    last = pay;
    const y = Math.ceil(m / 12) - 1;
    schedule[y] = schedule[y] || { year: y + 1, paid: 0, interest: 0, principal: 0, balance: 0 };
    schedule[y].paid += pay; schedule[y].interest += interest; schedule[y].principal += principal; schedule[y].balance = bal;
  }
  return { loan: P, first, last, total, overpay: total - P, schedule, monthlyIncomeNeeded: first / 0.5 };
}
export function saleTax({ buy, sell, regDate, saleDate, mrp = 4325, threshold = 8500, rate = 10, rateHigh = 15 }) {
  const gain = Math.max(0, Number(sell) - Number(buy));
  const reg = new Date(regDate), sale = new Date(saleDate);
  if (isNaN(reg) || isNaN(sale)) return null;
  const minYears = reg >= new Date('2026-01-01') ? 2 : 1;
  const exemptFrom = new Date(reg); exemptFrom.setFullYear(exemptFrom.getFullYear() + minYears);
  const exempt = sale >= exemptFrom;
  const limit = threshold * mrp;
  const tax = exempt ? 0 : Math.min(gain, limit) * rate / 100 + Math.max(0, gain - limit) * rateHigh / 100;
  const deadline = sale.getFullYear() + 1;
  return { gain, minYears, exemptFrom, exempt, tax: Math.round(tax), limit, declBy: `15.09.${deadline}`, payBy: `25.09.${deadline}` };
}
export function dealCosts({ price, notary, parties, spouse, mortgageOn, fast, commissionPct }, f) {
  const items = [];
  const mrp = Number(f.mrp);
  if (notary) {
    const m = parties === 'rel' ? f.notary_mrp_rel : parties === 'legal' ? f.notary_mrp_legal : f.notary_mrp_nonrel;
    items.push({ label: `Нотариус: договор купли-продажи (${num(m, 1)} МРП)`, value: m * mrp, who: 'по договорённости' });
  } else {
    items.push({ label: 'Составление договора в ЦОН (по данным 2025 г.)', value: Number(f.con_contract), who: 'по договорённости' });
  }
  if (spouse) items.push({ label: `Нотариальное согласие супруга (${num(f.spouse_consent_mrp, 1)} МРП)`, value: f.spouse_consent_mrp * mrp, who: 'продавец' });
  items.push({ label: 'Госпошлина за регистрацию права', value: Number(f.gov_fee_apartment), who: 'покупатель' });
  if (fast) items.push({ label: 'Ускоренная регистрация (≈ 2 часа)', value: Number(f.fast_registration), who: 'покупатель' });
  if (mortgageOn) {
    items.push({ label: `Нотариус: договор ипотечного займа (${num(f.mortgage_contract_mrp, 1)} МРП)`, value: f.mortgage_contract_mrp * mrp, who: 'покупатель' });
    items.push({ label: `Нотариус: договор залога (${num(f.pledge_mrp, 1)} МРП)`, value: f.pledge_mrp * mrp, who: 'покупатель' });
    items.push({ label: 'Оценка залога для банка (от)', value: Number(f.valuation_min), who: 'покупатель' });
  }
  if (Number(commissionPct)) items.push({ label: `Комиссия агентства (${num(commissionPct, 2)}%)`, value: Number(price) * Number(commissionPct) / 100, who: 'по договору' });
  const total = items.reduce((a, b) => a + b.value, 0);
  return { items, total };
}
export function rentYield({ price, rent, costs, vacancy, taxPct }) {
  const yearRent = Number(rent) * (12 - Number(vacancy || 0));
  const tax = yearRent * Number(taxPct || 0) / 100;
  const net = yearRent - Number(costs || 0) * 12 - tax;
  const p = Number(price);
  if (!p) return null;
  return { gross: (Number(rent) * 12) / p * 100, net: net / p * 100, netYear: net, payback: net > 0 ? p / net : Infinity };
}

// Обёртка для страниц: шапка + обработка ошибок загрузки
export async function boot(fn) {
  try {
    const s = await mountLayout();
    await fn(s);
  } catch (e) {
    console.error(e);
    const main = document.querySelector('main');
    if (main) main.insertAdjacentHTML('afterbegin', `<div class="wrap" style="padding-block:24px"><div class="notice">Не удалось загрузить данные: ${esc(errText(e))}</div></div>`);
  }
}
