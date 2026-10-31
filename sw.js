// ChariMiru サービスワーカー（ホーム画面アプリ用）
// 版20：
//  ・入れたときに、画面のファイルを全部控えておく（電波がなくても画面が開く）
//  ・自分のファイルは毎回ネットから取り、取れたら控えを新しくする。通信できないときだけ控えを使う
//  ・地図の部品（Mapbox GL JS v3.9.0）は版ごとに中身が変わらないので、控えがあれば控えを使う
//  ・地図の絵・ルート検索・標高など、ほかの通信には手を出さない
//  ・新しい版の確かめ（?chk=）は控えない
const CACHE = 'charimiru-v2';
const SHELL = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'config.js', 'elev.js', 'app.js', 'sensor.js', 'ride.js', 'hist.js', 'journey.js',
  'play.js', 'hikae.js', 'matome.js', 'pwa.js', 'help.js',
  'icon-192.png', 'icon-512.png', 'icon-maskable.png', 'apple-touch-icon.png'
];
const MAPBOX = [
  'https://api.mapbox.com/mapbox-gl-js/v3.9.0/mapbox-gl.js',
  'https://api.mapbox.com/mapbox-gl-js/v3.9.0/mapbox-gl.css'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // 1つ取れなくても、ほかは控える
    await Promise.all(SHELL.map(async u => {
      try { const r = await fetch(u, { cache: 'reload' }); if (r.ok) await c.put(u, r); } catch (err) { /* 無視 */ }
    }));
    await Promise.all(MAPBOX.map(async u => {
      try { const r = await fetch(new Request(u, { mode: 'no-cors' })); await c.put(u, r); } catch (err) { /* 無視 */ }
    }));
    await self.skipWaiting();
  })());
});
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

  // 地図の部品：控えがあれば控え、なければネットから取って控える
  if (url.href.startsWith('https://api.mapbox.com/mapbox-gl-js/v3.9.0/')) {
    e.respondWith((async () => {
      const hit = await caches.match(url.href);
      if (hit) return hit;
      const res = await fetch(req);
      try { const c = await caches.open(CACHE); await c.put(url.href, res.clone()); } catch (err) { /* 無視 */ }
      return res;
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.searchParams.has('chk')) return; // 新しい版の確かめは、いつもネットへ

  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) {
        const c = await caches.open(CACHE);
        // 画面は './' に、ほかは ?v=20 などを外した名前で控える（控えが版ごと・共有リンクごとに増えないように）
        const key = req.mode === 'navigate' ? './' : (url.search ? url.origin + url.pathname : req);
        c.put(key, res.clone());
      }
      return res;
    } catch (err) {
      const hit = (await caches.match(req)) || (await caches.match(req, { ignoreSearch: true })) ||
        (req.mode === 'navigate' ? await caches.match('./') : null);
      if (hit) return hit;
      return new Response('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><p style="font-family:sans-serif;padding:20px;line-height:1.6">電波が届かないため開けませんでした。<br>一度、電波のある所で開くと、次からは電波がなくても画面が開くようになります。</p>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
  })());
});
