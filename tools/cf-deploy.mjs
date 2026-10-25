// Выкладка сайта на Cloudflare Workers (статические файлы) через API — без wrangler.
// Шаги 1 и 3 выполняются запросами к Cloudflare API (коннектор Cloudflare в Claude или curl с токеном),
// шаг 2 — этим скриптом, токеном загрузки из шага 1.
//
//   node tools/cf-deploy.mjs manifest public > manifest.json
//     → тело для POST /accounts/{id}/workers/scripts/qadam-realty/assets-upload-session ({ "manifest": … })
//   node tools/cf-deploy.mjs upload public <файл с jwt загрузки> '<buckets из ответа шага 1>'
//     → загружает файлы, печатает completion jwt для PUT /accounts/{id}/workers/scripts/qadam-realty
//
// _headers в манифест не попадает: его содержимое передаётся в metadata.assets.config._headers.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { createHash } from 'node:crypto';

const ACCOUNT = '3257b22ca5a38019c74864b01be83b81';
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

function scan(root) {
  const manifest = {}, byHash = {};
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      const rel = '/' + relative(root, p).replace(/\\/g, '/');
      if (rel === '/_headers') continue;
      const buf = readFileSync(p);
      const hash = createHash('sha256').update(buf.toString('base64') + extname(p).slice(1)).digest('hex').slice(0, 32);
      manifest[rel] = { hash, size: buf.length };
      byHash[hash] = rel;
    }
  };
  walk(root);
  return { manifest, byHash };
}

const [cmd, root, jwtFile, bucketsJson] = process.argv.slice(2);
if (cmd === 'manifest') {
  console.log(JSON.stringify(scan(root).manifest));
} else if (cmd === 'upload') {
  const { byHash } = scan(root);
  const jwt = readFileSync(jwtFile, 'utf8').trim();
  let completion = null;
  for (const [i, bucket] of JSON.parse(bucketsJson).entries()) {
    const form = new FormData();
    for (const hash of bucket) {
      const rel = byHash[hash];
      if (!rel) throw new Error(`Нет файла с хешем ${hash} — манифест устарел, начните заново`);
      form.append(hash, new Blob([readFileSync(join(root, rel)).toString('base64')], { type: MIME[extname(rel)] || 'application/octet-stream' }), hash);
    }
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/assets/upload?base64=true`, {
      method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: form
    });
    const json = await res.json();
    if (!json.success) throw new Error(`Пакет ${i + 1}: HTTP ${res.status} ${JSON.stringify(json.errors)}`);
    console.error(`пакет ${i + 1}: загружен (HTTP ${res.status})`);
    if (json.result?.jwt) completion = json.result.jwt;
  }
  if (!completion) throw new Error('Cloudflare не вернул completion jwt');
  console.log(completion);
} else {
  console.error('Использование: node tools/cf-deploy.mjs manifest <папка> | upload <папка> <jwt-файл> <buckets-json>');
  process.exit(1);
}
