'use strict';
/* ChariMiru 版6：走行の履歴
   ・総走行距離・今月の距離・件数
   ・一覧、地図で道筋を見る、1件ずつ／全部の削除
   ・GPX書き出し（1件ずつ／全部まとめて）
   ride.js の後に読み込む（openDb・allRides・fmtHMS などを使う）      */

const WEEK = '日月火水木金土';
function fmtDate(t) {
  const d = new Date(t);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function stamp(t) {
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

async function delRide(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('rides', 'readwrite');
    tx.objectStore('rides').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function clearRides() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('rides', 'readwrite');
    tx.objectStore('rides').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- 一覧 ----------
let histList = [], openId = null, shownId = null;

async function openHistory() {
  try {
    histList = (await allRides()).sort((a, b) => b.start - a.start);
  } catch (e) {
    msg('履歴を読み込めませんでした：' + (e && e.message ? e.message : e), true);
    return;
  }
  openId = null;
  renderHistory();
  openModal('#histModal');
}

function renderHistory() {
  const total = histList.reduce((s, r) => s + (r.dist || 0), 0);
  const now = new Date();
  const mStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const month = histList.filter(r => r.start >= mStart).reduce((s, r) => s + (r.dist || 0), 0);
  $('#histSum').innerHTML =
    `<div><span class="label">総走行距離</span><span>${(total / 1000).toFixed(1)} km</span></div>` +
    `<div><span class="label">今月</span><span>${(month / 1000).toFixed(1)} km</span></div>` +
    `<div><span class="label">記録</span><span>${histList.length} 件</span></div>`;

  const ul = $('#histList');
  $('#histAll').hidden = !histList.length;
  if (!histList.length) {
    ul.innerHTML = '<li class="muted">まだ記録がありません</li>';
    return;
  }
  ul.innerHTML = histList.map(r => {
    const avg = r.movingMs > 0 ? r.dist / 1000 / (r.movingMs / 3600000) : 0;
    const open = r.id === openId;
    return `<li data-id="${r.id}" class="${open ? 'open' : ''}">` +
      `<div class="h-top"><b>${fmtDate(r.start)}</b><span>${(r.dist / 1000).toFixed(1)} km</span></div>` +
      `<div class="h-sub">${esc(r.routeName || 'ルートなし')}・${fmtHMS(r.movingMs)}・平均${avg.toFixed(1)}km/h</div>` +
      (open
        ? `<div class="h-detail">最高 ${(r.maxSpd || 0).toFixed(1)}km/h・登り ${Math.round(r.up || 0)}m・経過 ${fmtHMS(r.elapsedMs || 0)}</div>` +
          `<div class="h-btns"><button data-act="map">地図で見る</button><button data-act="gpx">GPX</button><button data-act="del" class="danger-t">削除</button></div>`
        : '') +
      '</li>';
  }).join('');
}

$('#histList').addEventListener('click', async e => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  const id = Number(li.dataset.id);
  const r = histList.find(x => x.id === id);
  if (!r) return;
  const b = e.target.closest('button');
  if (!b) { openId = openId === id ? null : id; renderHistory(); return; }

  if (b.dataset.act === 'map') {
    closeModals();
    showTrack(r);
  } else if (b.dataset.act === 'gpx') {
    downloadGpx([r], `chari_${stamp(r.start)}.gpx`);
  } else if (b.dataset.act === 'del') {
    if (!confirm(`${fmtDate(r.start)} の記録（${(r.dist / 1000).toFixed(1)}km）を削除しますか？`)) return;
    try {
      await delRide(id);
      histList = histList.filter(x => x.id !== id);
      if (shownId === id) clearTrack();
      renderHistory();
    } catch (err) {
      msg('削除できませんでした：' + (err && err.message ? err.message : err), true);
    }
  }
});

$('#btnGpxAll').addEventListener('click', () => {
  if (!histList.length) return;
  downloadGpx(histList.slice().reverse(), `chari_all_${stamp(Date.now()).slice(0, 8)}.gpx`);
});

$('#btnDelAll').addEventListener('click', async () => {
  if (!histList.length) return;
  if (!confirm(`記録${histList.length}件をすべて削除しますか？`)) return;
  if (!confirm('元に戻せません。本当に全部削除しますか？\n（先に「全部をGPXで書き出す」をしておくと安心です）')) return;
  try {
    await clearRides();
    histList = [];
    clearTrack();
    renderHistory();
  } catch (err) {
    msg('削除できませんでした：' + (err && err.message ? err.message : err), true);
  }
});

$('#btnHist').addEventListener('click', openHistory);

// ---------- 地図に道筋を出す ----------
function showTrack(r) {
  if (!mapReady || !r.track || !r.track.length) { msg('この記録には道筋がありません', true); return; }
  if (!map.getSource('hist')) {
    map.addSource('hist', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'hist-line', type: 'line', source: 'hist',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#e07b2e', 'line-width': 4, 'line-opacity': 0.9 }
    });
  }
  // 途切れた所（画面が消えていた・一時停止）で線を分ける
  const segs = [];
  let cur = [];
  r.track.forEach(p => {
    if (p[4] && cur.length) { segs.push(cur); cur = []; }
    cur.push([p[2], p[1]]);
  });
  if (cur.length) segs.push(cur);
  map.getSource('hist').setData({
    type: 'FeatureCollection',
    features: segs.filter(s => s.length >= 2).map(s => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: s } }))
  });
  const b = new mapboxgl.LngLatBounds();
  r.track.forEach(p => b.extend([p[2], p[1]]));
  map.fitBounds(b, { padding: fitPadding(), maxZoom: 16, duration: 600 });
  shownId = r.id;
  $('#histChipText').textContent = `${fmtDate(r.start)}・${(r.dist / 1000).toFixed(1)}km`;
  $('#histChip').hidden = false;
}
function clearTrack() {
  shownId = null;
  if (mapReady && map.getSource('hist')) map.getSource('hist').setData({ type: 'FeatureCollection', features: [] });
  $('#histChip').hidden = true;
}
$('#histChipClose').addEventListener('click', clearTrack);
$('#histChipText').addEventListener('click', openHistory);

// ---------- GPX書き出し ----------
function xmlEsc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function toGpx(recs) {
  const L = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="ChariMiru" xmlns="http://www.topografix.com/GPX/1/1">',
    `<metadata><time>${new Date().toISOString()}</time></metadata>`
  ];
  recs.forEach(r => {
    L.push('<trk>', `<name>${xmlEsc((r.routeName || 'ルートなし') + ' ' + fmtDate(r.start))}</name>`, '<type>cycling</type>', '<trkseg>');
    (r.track || []).forEach((p, i) => {
      if (p[4] && i > 0) L.push('</trkseg>', '<trkseg>');
      L.push(`<trkpt lat="${p[1]}" lon="${p[2]}">${p[3] != null ? `<ele>${p[3]}</ele>` : ''}<time>${new Date(p[0]).toISOString()}</time></trkpt>`);
    });
    L.push('</trkseg>', '</trk>');
  });
  L.push('</gpx>');
  return L.join('\n');
}
function downloadGpx(recs, name) {
  const blob = new Blob([toGpx(recs)], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  msg(`${name} を書き出しました`);
}
