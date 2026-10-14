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
          `<div class="h-btns"><button data-act="route" class="go-t">この道を走る</button><button data-act="map">地図で見る</button></div>` +
          `<div class="h-btns"><button data-act="gpx">GPX</button><button data-act="del" class="danger-t">削除</button></div>`
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

  if (b.dataset.act === 'route') {
    closeModals();
    loadTrackAsRoute(r.track, r.routeName || fmtDate(r.start));
  } else if (b.dataset.act === 'map') {
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

// ---------- 記録の道筋（またはGPXのコース）をルートにする ----------
async function loadTrackAsRoute(track, label) {
  if (riding) return;
  // 同じ場所が続く点は1つにまとめる
  const coords = [];
  track.forEach(p => {
    const c = [p[2], p[1], p[3] != null ? p[3] : 0];
    const prev = coords[coords.length - 1];
    if (!prev || prev[0] !== c[0] || prev[1] !== c[1]) coords.push(c);
  });
  if (coords.length < 2) { msg('道筋の点が足りないため、ルートにできませんでした', true); return; }
  searchSeq++; // 途中の検索は取り消す
  msg('道筋を読み込み、坂の高さを調べています…');
  try {
    const route = await makeRoute({ geometry: { coordinates: coords }, properties: {} }, true);
    route.fromTrack = true;
    const first = coords[0], last = coords[coords.length - 1];
    state.points = [
      { name: `${label}（出発）`, lng: first[0], lat: first[1] },
      { name: `${label}（到着）`, lng: last[0], lat: last[1] }
    ];
    route.wpPts = state.points.map(p => ({ ...p }));
    route.wpD = [0, route.total];
    renderPoints();
    updateMarkers();
    clearTrack();
    showRoute(route);
    msg(`「${label}」の道筋をルートにしました。▶ 走る で同じ道を走れます`);
  } catch (e) {
    msg('道筋をルートにできませんでした：' + (e && e.message ? e.message : e), true);
  }
}

// ---------- GPXの読み込み ----------
function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('GPXファイルとして読めませんでした');
  const readPts = nodes => nodes.map(n => {
    const e = n.getElementsByTagName('ele')[0], tm = n.getElementsByTagName('time')[0];
    return {
      lat: parseFloat(n.getAttribute('lat')), lng: parseFloat(n.getAttribute('lon')),
      ele: e ? parseFloat(e.textContent) : null,
      t: tm ? Date.parse(tm.textContent) : null
    };
  }).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const nameOf = el => { const n = el.getElementsByTagName('name')[0]; return n ? n.textContent.trim() : ''; };
  const out = [];
  [...doc.getElementsByTagName('trk')].forEach(trk => {
    const segs = [...trk.getElementsByTagName('trkseg')].map(sg => readPts([...sg.getElementsByTagName('trkpt')])).filter(sg => sg.length);
    if (segs.length) out.push({ name: nameOf(trk), segs });
  });
  if (!out.length) {
    [...doc.getElementsByTagName('rte')].forEach(rt => {
      const pts = readPts([...rt.getElementsByTagName('rtept')]);
      if (pts.length) out.push({ name: nameOf(rt), segs: [pts] });
    });
  }
  return out;
}

// GPXの1本を走行記録の形にする
function gpxToRecord(tk) {
  const track = [];
  tk.segs.forEach((sg, si) => sg.forEach((p, i) => {
    track.push([p.t, +p.lat.toFixed(6), +p.lng.toFixed(6), p.ele != null && Number.isFinite(p.ele) ? Math.round(p.ele * 10) / 10 : null, si > 0 && i === 0 ? 1 : 0]);
  }));
  let dist = 0, moving = 0, maxSpd = 0, up = 0, down = 0, base = null;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1], b = track[i];
    const d = haversine([a[2], a[1]], [b[2], b[1]]);
    const dt = (b[0] - a[0]) / 1000;
    dist += d;
    if (dt > 0) {
      const kmh = d / dt * 3.6;
      if (b[4]) { if (kmh >= 5 && kmh <= 60) moving += dt * 1000; }
      else if (kmh >= 2 && kmh < 90) {
        moving += Math.min(dt, 30) * 1000;
        if (dt >= 3) maxSpd = Math.max(maxSpd, kmh);
      }
    }
  }
  track.forEach(p => {
    if (p[3] == null) return;
    if (base == null) base = p[3];
    else if (p[3] - base >= 5) { up += p[3] - base; base = p[3]; }
    else if (base - p[3] >= 5) { down += base - p[3]; base = p[3]; }
  });
  // このアプリで書き出した名前の「 日付」部分は外す
  let name = tk.name.replace(/\s*\d{4}\/\d{1,2}\/\d{1,2}（.）\d{1,2}:\d{2}$/, '').trim();
  if (name === 'ルートなし') name = '';
  const start = track[0][0], end = track[track.length - 1][0];
  return {
    id: start, start, end, dist, movingMs: moving, elapsedMs: end - start,
    maxSpd, up, down, bike: null, routeName: name || null, track, imported: true
  };
}

$('#gpxFile').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let tracks;
  try {
    tracks = parseGpx(await file.text());
  } catch (err) {
    msg(err.message, true);
    return;
  }
  if (!tracks.length) { msg('GPXファイルの中に道筋が見つかりませんでした', true); return; }
  const timed = tracks.every(tk => tk.segs.every(sg => sg.every(p => Number.isFinite(p.t))));
  const label = tracks[0].name || file.name.replace(/\.gpx$/i, '');
  if (timed && confirm(`${tracks.length}件の走行記録として履歴に取り込みますか？\n（同じ日時の記録は上書きされます）\n\n「キャンセル」を押すと、${tracks.length > 1 ? '最初の1件を' : ''}ルートとして表示します。`)) {
    try {
      let n = 0;
      for (const tk of tracks) {
        const rec = gpxToRecord(tk);
        if (rec.track.length >= 2) { await putRide(rec); n++; }
      }
      histList = (await allRides()).sort((a, b) => b.start - a.start);
      renderHistory();
      refreshLearned();
      msg(`${n}件の記録を取り込みました`);
    } catch (err) {
      msg('取り込みに失敗しました：' + (err && err.message ? err.message : err), true);
    }
    return;
  }
  const tk = tracks[0];
  const track = [];
  tk.segs.forEach(sg => sg.forEach(p => track.push([p.t, p.lat, p.lng, p.ele, 0])));
  closeModals();
  loadTrackAsRoute(track, label);
});

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
