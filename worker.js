// Сайт агентства недвижимости Qadam. Файлы отдаются как есть (catalog.html без редиректа),
// а короткие адреса (/catalog) и корень (/) показывают нужную страницу без перенаправления.
// Выкладывается как Cloudflare Worker «qadam-realty» со статическими файлами из public/
// (html_handling: "none", not_found_handling: "404-page", заголовки — из public/_headers).
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let path = url.pathname;
    if (path === '/' || path === '') path = '/index.html';
    else if (!path.split('/').pop().includes('.')) path = path.replace(/\/$/, '') + '.html';
    if (path !== url.pathname) {
      const res = await env.ASSETS.fetch(new Request(new URL(path + url.search, url), request));
      if (res.status !== 404) return res;
    }
    return env.ASSETS.fetch(request);
  }
};
