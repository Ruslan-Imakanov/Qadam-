# Qadam — сайт агентства недвижимости и оценки (подпроект в папке realty/)

Отдельный от «Табеля» проект, лежит в этом же репозитории. Сайт табеля (корневой `public/`) он не трогает.
Хостинг — **Cloudflare Pages** из этого репозитория (Build output directory: `realty/public`, заголовки — `public/_headers`).
Netlify для этого проекта не нужен и не используется.

## Стек и правила
- Supabase-проект **realty-agency** (`feuqorxannlztgxgdwyz`) на аккаунте, к которому подключён коннектор Supabase.
  Схема — `supabase/schema.sql`, наполнение — `supabase/seed.sql` (генерируется, руками не править).
- Фронтенд — чистые HTML/CSS/JS без сборки, `public/`. Общий модуль — `public/app.js`
  (слой данных `db.*`, `auth`, шапка/подвал `mountLayout()`, форма заявки `openLead()`, карточки, калькуляторы).
  Админка — `public/admin.js`, универсальный редактор таблиц `crud(box, spec)`.
- `public/config.js`: пустой `supabaseUrl` → **демо-режим** на `public/data/demo.json` (правки в localStorage).
  Supabase JS грузится динамически с jsDelivr только в боевом режиме.
- Наполнение правится в `tools/content.mjs`, затем `node tools/build-seed.mjs` (из `realty/`).
- Ссылки на объекты/статьи строить через `link(page, params)`, читать через `param(name)` —
  поддерживают и `?id=12`, и `#12` (для предпросмотра, где параметры адреса не доходят).
- Тема — CSS-переменные в `:root`, тёмная через `prefers-color-scheme` и `[data-theme]` на `<html>`.
- Цвета только через токены из `styles.css`; новые иконки — в объект `ICONS` в `app.js`.
- Даты людям — `fmtDateRu()` (ДД.ММ.ГГ), деньги — `money()` (₸), телефоны — `formatPhone()`.
- RLS: посетитель только читает опубликованное и вставляет заявки (`insert` без `select` — `db.insert(..., { returning: false })`).
- Демо-объекты и демо-команда помечены `is_demo` — удаляются кнопкой в админке.
- SQL можно проверить без Supabase на локальном Postgres: создать заглушки схем auth (users, uid()), storage (buckets, objects),
  функцию net.http_post и роли anon/authenticated, затем выполнить schema.sql (без строки create extension pg_net) и seed.sql.
