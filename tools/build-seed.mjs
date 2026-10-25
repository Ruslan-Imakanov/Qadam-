// Собирает supabase/seed.sql и public/data/demo.json из tools/content.mjs.
// Запуск из папки realty/:  node tools/build-seed.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from './content.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = '2026-10-25T09:00:00+05:00';

// ---------- Строки таблиц (одинаковые для SQL и для демо-JSON) ----------
const T = {};

T.settings = Object.entries(C.settings).map(([key, value]) => ({ key, value }));

T.cities = C.cities.map((c, i) => ({
  id: c.id, name: c.name, slug: c.slug, region: c.region, lat: c.lat, lng: c.lng, sort: i + 1, is_active: true
}));

T.districts = C.districts.map((d, i) => ({ id: d.id, city_id: d.city_id, name: d.name, price_coef: d.price_coef, sort: i + 1 }));

const r1000 = n => Math.round(n / 1000) * 1000;
T.price_index = C.cities.map(c => ({
  id: c.id, city_id: c.id,
  apt_sale_m2: c.apt,
  apt_rent_m2: c.rent,
  house_sale_m2: r1000(c.apt * (c.id <= 3 ? 0.8 : 0.7)),
  land_sotka: c.land,
  commercial_sale_m2: r1000(c.apt * 1.1),
  commercial_rent_m2: r1000(c.rent * 1.6),
  source: C.priceMeta.source,
  period: C.priceMeta.period,
  updated_at: NOW
}));

T.valuation_factors = C.valuationFactors.map(([factor, option_key, label, coef], i) => ({
  id: i + 1, factor, option_key, label, coef, sort: i + 1
}));

T.agents = C.agents.map(a => ({
  telegram: null, email: null, photo_url: null, certificates: null, ...a,
  is_active: true, is_demo: true, created_at: NOW
}));

T.services = C.services.map((s, i) => ({ id: i + 1, ...s, is_active: true }));
T.valuation_types = C.valuationTypes.map((v, i) => ({ id: i + 1, ...v, is_active: true }));
T.valuation_purposes = C.valuationPurposes.map((p, i) => ({ id: i + 1, ...p, sort: i + 1 }));

let stepId = 0;
T.process_steps = Object.entries(C.processSteps).flatMap(([process, steps]) =>
  steps.map(([title, description, duration], i) => ({ id: ++stepId, process, step_no: i + 1, title, description, duration })));

T.checklists = C.checklists.map((c, i) => ({
  id: i + 1, slug: c.slug, title: c.title, audience: c.audience, intro: c.intro,
  items: c.items.map(([title, note]) => ({ title, note })), sort: i + 1
}));

T.faq = C.faq.map(([category, question, answer], i) => ({ id: i + 1, category, question, answer, sort: i + 1, is_active: true }));
T.glossary = C.glossary.map(([term, definition], i) => ({ id: i + 1, term, definition }));
T.mortgage_programs = C.mortgagePrograms.map((m, i) => ({ id: i + 1, ...m, checked_at: '2026-10-25', is_active: true }));

T.articles = C.articles.map((a, i) => {
  const d = new Date(Date.parse('2026-10-20T10:00:00+05:00') - i * 6 * 86400000).toISOString();
  return { id: i + 1, cover: null, ...a, is_published: true, published_at: d, updated_at: d };
});

const listingDefaults = {
  commercial_kind: null, description: null, district_id: null, address: null, complex_name: null, lat: null, lng: null,
  price_negotiable: false, area_total: null, area_living: null, area_kitchen: null, land_area: null, rooms: null, floor: null,
  floors_total: null, year_built: null, building_type: null, condition: null, bathroom: null, balcony: null, parking: null,
  furniture: null, ceiling_height: null, is_new_building: false, mortgage_ok: false, installment_ok: false, exchange_ok: false,
  pledged: false, features: [], photos: [], video_url: null, tour_url: null, agent_id: null, is_featured: false
};
T.listings = C.listings.map((l, i) => {
  const d = new Date(Date.parse('2026-10-24T12:00:00+05:00') - i * 2 * 86400000).toISOString();
  return {
    ...listingDefaults, ...l,
    code: 'A-' + String(l.id).padStart(5, '0'),
    status: 'published', is_demo: true, views: 0,
    created_at: d, updated_at: d, published_at: d
  };
});

T.reviews = [];

// ---------- SQL ----------
const ORDER = ['settings', 'cities', 'districts', 'price_index', 'valuation_factors', 'agents', 'services',
  'valuation_types', 'valuation_purposes', 'process_steps', 'checklists', 'faq', 'glossary',
  'mortgage_programs', 'articles', 'listings'];
const JSONB = { settings: ['value'], checklists: ['items'] };
const TEXT_ARRAYS = new Set(['includes', 'purposes', 'documents', 'tags', 'features', 'photos']);

function q(s) {
  s = String(s);
  if (s.includes('$q$')) throw new Error('В тексте встретился $q$');
  return '$q$' + s + '$q$';
}
function lit(table, col, v) {
  if (v === null || v === undefined) return 'null';
  if ((JSONB[table] || []).includes(col)) return q(JSON.stringify(v)) + '::jsonb';
  if (TEXT_ARRAYS.has(col)) return v.length ? 'array[' + v.map(q).join(', ') + ']::text[]' : "'{}'::text[]";
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  return q(v);
}

let sql = `-- ============================================================
-- Наполнение базы: справочники, услуги, оценка, база знаний, демо-объекты.
-- СГЕНЕРИРОВАНО tools/build-seed.mjs из tools/content.mjs — не правьте руками.
-- Повторный запуск безопасен: существующие строки не перезаписываются.
-- Демо-объекты и демо-команда помечены is_demo = true (удаляются в админке).
-- ============================================================

`;
for (const t of ORDER) {
  const rows = T[t];
  if (!rows.length) continue;
  const cols = Object.keys(rows[0]);
  sql += `-- ${t} (${rows.length})\ninsert into public.${t} (${cols.join(', ')}) values\n`;
  sql += rows.map(r => '  (' + cols.map(c => lit(t, c, r[c])).join(', ') + ')').join(',\n');
  sql += `\non conflict (${t === 'settings' ? 'key' : 'id'}) do nothing;\n\n`;
}
for (const t of ORDER.filter(t => t !== 'settings')) {
  sql += `select setval(pg_get_serial_sequence('public.${t}', 'id'), greatest((select max(id) from public.${t}), 1));\n`;
}

mkdirSync(join(root, 'supabase'), { recursive: true });
writeFileSync(join(root, 'supabase', 'seed.sql'), sql);

// ---------- Демо-JSON ----------
const demo = { generated_at: NOW, tables: { ...T, leads: [], valuation_orders: [], listing_private: [], profiles: [] } };
mkdirSync(join(root, 'public', 'data'), { recursive: true });
writeFileSync(join(root, 'public', 'data', 'demo.json'), JSON.stringify(demo));

const counts = ORDER.map(t => `${t}: ${T[t].length}`).join(', ');
console.log('seed.sql и demo.json готовы —', counts);
