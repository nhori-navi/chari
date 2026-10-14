// ChariMiru サービスワーカー（ホーム画面アプリ用）
// 自分のファイルは毎回ネットから取り、取れたら控えを残す。通信できないときだけ控えを使う。
// 地図やルート検索など、ほかのサイトとの通信には手を出さない。
const CACHE = 'charimiru-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('charimiru-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) {
        const c = await caches.open(CACHE);
        c.put(req, res.clone());
      }
      return res;
    } catch (err) {
      const hit = (await caches.match(req)) || (await caches.match(req, { ignoreSearch: true }));
      if (hit) return hit;
      return new Response('<meta charset="utf-8"><p style="font-family:sans-serif;padding:20px">接続できません。通信できる場所で開き直してください。</p>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
  })());
});
