'use strict';
/* ChariMiru 版7：国土地理院の標高タイル（DEM10B・10mメッシュ）から標高を読む
   ・ルートを20mごとに区切った点の標高を置き換える
   ・取れなかったとき（通信できない・日本の外など）は、もとの粗い標高のまま
   app.js より前に読み込む                                                  */

const GSI_Z = 14;
const gsiCache = new Map();

function gsiTile(x, y) {
  const key = x + '/' + y;
  if (gsiCache.has(key)) return gsiCache.get(key);
  const p = (async () => {
    try {
      const r = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/dem_png/${GSI_Z}/${x}/${y}.png`);
      if (!r.ok) return null;
      const bmp = await createImageBitmap(await r.blob());
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 256;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      return ctx.getImageData(0, 0, 256, 256).data;
    } catch (e) {
      return null;
    }
  })();
  gsiCache.set(key, p);
  p.then(v => { if (!v) gsiCache.delete(key); }); // 失敗した分は次回もう一度取りにいく
  return p;
}

function gsiPixel(lng, lat) {
  const n = 2 ** GSI_Z * 256;
  const x = (lng + 180) / 360 * n;
  const s = Math.sin(lat * Math.PI / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return { tx: Math.floor(x / 256), ty: Math.floor(y / 256), px: Math.floor(x) % 256, py: Math.floor(y) % 256 };
}

// 色（R・G・B）から標高（m）へ。海などデータのない所は null
function gsiDecode(d, i) {
  const v = d[i] * 65536 + d[i + 1] * 256 + d[i + 2];
  if (v === 8388608) return null;
  return (v < 8388608 ? v : v - 16777216) * 0.01;
}

// samples の e を国土地理院の標高に置き換える。8割以上取れたら true
async function gsiFill(samples, timeoutMs = 10000) {
  const pix = samples.map(s => gsiPixel(s.lng, s.lat));
  const keys = [...new Set(pix.map(p => p.tx + '/' + p.ty))];
  if (!keys.length || keys.length > 400) return false; // 長すぎるルートは粗い標高のまま
  let timedOut = false;
  const work = (async () => {
    const tiles = {};
    for (let i = 0; i < keys.length; i += 6) {
      await Promise.all(keys.slice(i, i + 6).map(async k => {
        const [x, y] = k.split('/').map(Number);
        tiles[k] = await gsiTile(x, y);
      }));
      if (timedOut) return false;
    }
    let ok = 0;
    const vals = pix.map(p => {
      const t = tiles[p.tx + '/' + p.ty];
      if (!t) return null;
      const v = gsiDecode(t, (p.py * 256 + p.px) * 4);
      if (v != null) ok++;
      return v;
    });
    if (timedOut || ok < samples.length * 0.8) return false;
    vals.forEach((v, i) => { if (v != null) samples[i].e = v; });
    return true;
  })();
  const limit = new Promise(res => setTimeout(() => { timedOut = true; res(false); }, timeoutMs));
  return Promise.race([work, limit]);
}
