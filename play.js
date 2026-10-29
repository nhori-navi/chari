'use strict';
/* ChariMiru 版10：遊びの機能
   ・マス塗り：約1km四方のマス（標準地域メッシュの3次メッシュと同じ区切り）を、走った道筋で塗る
   ・峠のスタンプ帳：地図データ（OpenStreetMap）にある名前のある峠を、道筋が50m以内で通ったら記録
   ・記録とバッジ：月ごとの距離、今年・去年、登った高さ（富士山○個分）、バッジ
   journey.js の後に読み込む                                                         */

// ---------- マス塗り ----------
const meshKey = (lat, lng) => Math.floor(lat * 120) + '_' + Math.floor(lng * 80);

function meshOfTrack(track, set) {
  set = set || new Set();
  (track || []).forEach((p, i) => {
    set.add(meshKey(p[1], p[2]));
    if (i === 0 || p[4]) return; // 途切れた所（画面が消えていた・一時停止）は塗らない
    const q = track[i - 1];
    const n = Math.floor(haversine([q[2], q[1]], [p[2], p[1]]) / 100);
    for (let k = 1; k < n; k++) {
      const f = k / n;
      set.add(meshKey(q[1] + (p[1] - q[1]) * f, q[2] + (p[2] - q[2]) * f));
    }
  });
  return set;
}
function meshOfRides(rides) {
  const s = new Set();
  rides.forEach(r => meshOfTrack(r.track, s));
  return s;
}
function meshFC(set) {
  const features = [];
  set.forEach(k => {
    const [a, b] = k.split('_').map(Number);
    const s = a / 120, n = (a + 1) / 120, w = b / 80, e = (b + 1) / 80;
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });
  });
  return { type: 'FeatureCollection', features };
}

function showMeshMap(set) {
  if (!mapReady) return;
  if (!map.getSource('mesh')) {
    map.addSource('mesh', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'mesh-fill', type: 'fill', source: 'mesh', slot: 'middle', paint: { 'fill-color': '#e07b2e', 'fill-opacity': 0.35 } }, 'route-casing');
    map.addLayer({ id: 'mesh-line', type: 'line', source: 'mesh', slot: 'middle', paint: { 'line-color': '#c0602a', 'line-width': 0.8 } }, 'route-casing');
  }
  const fc = meshFC(set);
  map.getSource('mesh').setData(fc);
  if (fc.features.length) {
    const b = new mapboxgl.LngLatBounds();
    fc.features.forEach(f => f.geometry.coordinates[0].forEach(c => b.extend(c)));
    map.fitBounds(b, { padding: fitPadding(), maxZoom: 13, duration: 600 });
  }
  showPlayChip(`塗ったマス ${set.size}個`, hideMeshMap);
}
function hideMeshMap() {
  if (mapReady && map.getSource('mesh')) map.getSource('mesh').setData({ type: 'FeatureCollection', features: [] });
}

// 地図の上の小さな札（× で消す）
let playChipClose = null;
function showPlayChip(text, onClose) {
  if (playChipClose) playChipClose();
  playChipClose = onClose;
  $('#playChipText').textContent = text;
  $('#playChip').hidden = false;
}
$('#playChipClose').addEventListener('click', () => {
  if (playChipClose) playChipClose();
  playChipClose = null;
  $('#playChip').hidden = true;
});

// ---------- 峠のスタンプ帳 ----------
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];
async function overpass(q) {
  for (const u of OVERPASS) {
    try {
      const ctl = new AbortController();
      const tm = setTimeout(() => ctl.abort(), 30000);
      const r = await fetch(u, {
        method: 'POST', body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal
      });
      clearTimeout(tm);
      if (!r.ok) continue;
      const j = await r.json();
      if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) continue;
      return j;
    } catch (e) { /* 次の所へ */ }
  }
  throw new Error('峠の情報を取得できませんでした（通信を確認してください）');
}

function nearTrack(track, lng, lat, lim) {
  const cos = Math.cos(lat * Math.PI / 180);
  const P = p => [(p[2] - lng) * cos * 111320, (p[1] - lat) * 110540];
  for (let i = 0; i < track.length; i++) {
    const b = P(track[i]);
    if (Math.hypot(b[0], b[1]) <= lim) return true;
    if (i === 0 || track[i][4]) continue;
    const a = P(track[i - 1]);
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    if (!L) continue;
    const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / L));
    if (Math.hypot(a[0] + dx * t, a[1] + dy * t) <= lim) return true;
  }
  return false;
}

async function findPasses(track) {
  if (!track || track.length < 2) return [];
  let s = 90, w = 180, n = -90, e = -180;
  track.forEach(p => { s = Math.min(s, p[1]); n = Math.max(n, p[1]); w = Math.min(w, p[2]); e = Math.max(e, p[2]); });
  const m = 0.001;
  s -= m; n += m; w -= m; e += m;
  if ((n - s) * (e - w) > 4) return []; // 範囲が広すぎるときは調べない
  const bb = `${s},${w},${n},${e}`;
  const j = await overpass(`[out:json][timeout:25];(node["mountain_pass"="yes"]["name"](${bb});node["natural"="saddle"]["name"](${bb}););out;`);
  return (j.elements || [])
    .filter(el => el.tags && el.tags.name && nearTrack(track, el.lon, el.lat, 50))
    .map(el => ({ id: el.id, name: el.tags.name, ele: el.tags.ele ? parseFloat(el.tags.ele) : null, lat: el.lat, lng: el.lon }));
}

async function checkRidePasses(rec) {
  const passes = await findPasses(rec.track);
  rec.passes = passes;
  rec.passChecked = true;
  await putRide(rec);
  return passes;
}

function passBook(rides) {
  const book = new Map();
  rides.slice().sort((a, b) => a.start - b.start).forEach(r => (r.passes || []).forEach(p => {
    const e = book.get(p.id);
    if (e) e.count++;
    else book.set(p.id, { ...p, first: r.start, count: 1 });
  }));
  return [...book.values()].sort((a, b) => b.first - a.first);
}

// ---------- 記録とバッジ ----------
const FUJI = 3776;
function playStats(rides, meshCount) {
  const months = {};
  let maxDist = 0, up = 0, early = 0;
  rides.forEach(r => {
    const d = new Date(r.start);
    const k = d.getFullYear() * 100 + d.getMonth() + 1;
    months[k] = (months[k] || 0) + r.dist / 1000;
    maxDist = Math.max(maxDist, r.dist / 1000);
    up += r.up || 0;
    if (d.getHours() >= 3 && d.getHours() < 6) early++;
  });
  return {
    count: rides.length,
    total: rides.reduce((s, r) => s + r.dist, 0) / 1000,
    maxDist, up, early, months,
    maxMonth: Math.max(0, ...Object.values(months)),
    passes: passBook(rides).length,
    mesh: meshCount
  };
}

const BADGES = [
  { icon: '🚲', name: 'はじめの一歩', v: s => s.count, goal: 1, unit: '回' },
  { icon: '🔟', name: '10回走った', v: s => s.count, goal: 10, unit: '回' },
  { icon: '🎖', name: '50回走った', v: s => s.count, goal: 50, unit: '回' },
  { icon: '💯', name: '100回走った', v: s => s.count, goal: 100, unit: '回' },
  { icon: '🌅', name: '朝活（朝6時前に出発）', v: s => s.early, goal: 1, unit: '回' },
  { icon: '🛣', name: '1回で50km', v: s => s.maxDist, goal: 50, unit: 'km' },
  { icon: '🏁', name: '1回で100km', v: s => s.maxDist, goal: 100, unit: 'km' },
  { icon: '📅', name: 'ひと月で100km', v: s => s.maxMonth, goal: 100, unit: 'km' },
  { icon: '🗓', name: 'ひと月で300km', v: s => s.maxMonth, goal: 300, unit: 'km' },
  { icon: '🌏', name: '合計1,000km', v: s => s.total, goal: 1000, unit: 'km' },
  { icon: '🌍', name: '合計5,000km', v: s => s.total, goal: 5000, unit: 'km' },
  { icon: '🗻', name: '富士山1個分登った', v: s => s.up, goal: FUJI, unit: 'm' },
  { icon: '⛰', name: '富士山10個分登った', v: s => s.up, goal: FUJI * 10, unit: 'm' },
  { icon: '🔖', name: 'はじめての峠', v: s => s.passes, goal: 1, unit: 'か所' },
  { icon: '📜', name: '峠を5か所', v: s => s.passes, goal: 5, unit: 'か所' },
  { icon: '🏯', name: '峠を10か所', v: s => s.passes, goal: 10, unit: 'か所' },
  { icon: '🟧', name: '100マス塗った', v: s => s.mesh, goal: 100, unit: 'マス' },
  { icon: '🗾', name: '500マス塗った', v: s => s.mesh, goal: 500, unit: 'マス' },
  { icon: '🏮', name: '東海道を制覇', v: s => s.total, goal: COURSES[0].end, unit: 'km' },
  { icon: '🛻', name: 'ルート66を制覇', v: s => s.total, goal: COURSES[1].end, unit: 'km' }
];
const earned = (b, s) => b.v(s) >= b.goal;
function fmtLeft(b, s) {
  const left = b.goal - b.v(s);
  return b.unit === 'km' ? `あと${left.toFixed(1)}km` : `あと${Math.ceil(left).toLocaleString()}${b.unit}`;
}

// ---------- 保存したときの知らせ（ride.js の saveAndReport から呼ぶ） ----------
// 版19：画面への表示はまとめカード（matome.js）。ここは読み上げと、峠を調べること
async function afterSavePlay(rec, all) {
  const before = all.filter(r => r.id !== rec.id);
  const meshB = meshOfRides(before).size;
  const meshA = meshOfRides(all).size;
  const sB = playStats(before, meshB), sA = playStats(all, meshA);
  const talk = [];
  if (meshA > meshB) talk.push(`新しいマスを${meshA - meshB}個塗りました`);
  BADGES.filter(b => earned(b, sA) && !earned(b, sB)).forEach(b => talk.push(`バッジ獲得、${b.name}`));
  talk.forEach(t => speak(t));

  // 峠は通信して調べるので、少し後から知らせる
  try {
    const passes = await checkRidePasses(rec);
    if (typeof sumRefresh === 'function') sumRefresh(rec);
    if (!passes.length) return;
    const allNow = all.map(r => (r.id === rec.id ? rec : r));
    const pB = playStats(all, meshA), pA = playStats(allNow, meshA); // 違いは峠だけ
    speak(`${passes.map(p => p.name).join('、')}を通過しました。スタンプを押しました`);
    BADGES.filter(b => earned(b, pA) && !earned(b, pB)).forEach(b => speak(`バッジ獲得、${b.name}`));
  } catch (e) {
    // 通信できないときは、あとで「過去の記録も調べる」から
    if (typeof sumRefresh === 'function') sumRefresh(rec, { passFail: true });
  }
}

// ---------- 履歴画面のタブ ----------
let playRides = [];
async function showTab(name) {
  document.querySelectorAll('#histTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p => { p.hidden = p.id !== 'tab-' + name; });
  if (name === 'list') return;
  try { playRides = await allRides(); } catch (e) { playRides = []; }
  if (name === 'mesh') renderMeshTab();
  else if (name === 'pass') renderPassTab();
  else if (name === 'stats') renderStatsTab();
}
$('#histTabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (b) showTab(b.dataset.tab);
});
// 履歴を開いたときは「一覧」から
$('#btnHist').addEventListener('click', () => showTab('list'));

function renderMeshTab() {
  const set = meshOfRides(playRides);
  const now = new Date();
  const mStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const before = meshOfRides(playRides.filter(r => r.start < mStart)).size;
  $('#meshSum').innerHTML =
    `<div><span class="label">塗ったマス</span><span>${set.size}</span></div>` +
    `<div><span class="label">今月の新しいマス</span><span>${set.size - before}</span></div>` +
    `<div><span class="label">面積の目安</span><span>約${set.size}km²</span></div>`;
}
$('#btnMeshMap').addEventListener('click', () => {
  const set = meshOfRides(playRides);
  if (!set.size) { msg('まだ塗ったマスがありません', true); return; }
  closeModals();
  showMeshMap(set);
});

let passMarker = null;
function renderPassTab() {
  const book = passBook(playRides);
  const unchecked = playRides.filter(r => !r.passChecked && (r.track || []).length >= 2).length;
  $('#passSum').textContent = `スタンプ ${book.length}か所`;
  $('#btnPassScan').hidden = !unchecked;
  $('#btnPassScan').textContent = `過去の記録も調べる（${unchecked}件）`;
  $('#passList').innerHTML = book.length
    ? book.map((p, i) => `<li data-i="${i}"><div class="h-top"><b>🔖 ${esc(p.name)}</b><span>${p.ele ? Math.round(p.ele) + 'm' : ''}</span></div>` +
        `<div class="h-sub">初めて ${fmtDate(p.first).replace(/（.）.*/, '')}・${p.count}回</div></li>`).join('')
    : '<li class="muted">まだスタンプがありません。名前のある峠を通ると押されます</li>';
  $('#passList').onclick = e => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    const p = book[Number(li.dataset.i)];
    closeModals();
    if (!passMarker) {
      const el = document.createElement('div');
      el.className = 'pass-mk';
      el.textContent = '🔖';
      passMarker = new mapboxgl.Marker({ element: el });
    }
    passMarker.setLngLat([p.lng, p.lat]).addTo(map);
    map.flyTo({ center: [p.lng, p.lat], zoom: 14, duration: 800 });
    showPlayChip(`${p.name}${p.ele ? '・標高' + Math.round(p.ele) + 'm' : ''}`, () => passMarker && passMarker.remove());
  };
}
$('#btnPassScan').addEventListener('click', async () => {
  const todo = playRides.filter(r => !r.passChecked && (r.track || []).length >= 2);
  const btn = $('#btnPassScan');
  btn.disabled = true;
  let found = 0;
  for (let i = 0; i < todo.length; i++) {
    btn.textContent = `調べています… ${i + 1}／${todo.length}`;
    try {
      found += (await checkRidePasses(todo[i])).length;
    } catch (e) {
      msg(e.message, true);
      break;
    }
    await new Promise(r => setTimeout(r, 1200)); // 地図データのサーバーに負担をかけないよう間をあける
  }
  btn.disabled = false;
  try { playRides = await allRides(); } catch (e) { /* 無視 */ }
  renderPassTab();
  if (found) speak(`峠のスタンプを${found}個見つけました`);
});

function renderStatsTab() {
  const s = playStats(playRides, meshOfRides(playRides).size);
  const y = new Date().getFullYear();
  const yearKm = yy => Object.entries(s.months).filter(([k]) => Math.floor(k / 100) === yy).reduce((a, [, v]) => a + v, 0);
  $('#statSum').innerHTML =
    `<div><span class="label">今年</span><span>${yearKm(y).toFixed(1)} km</span></div>` +
    `<div><span class="label">去年</span><span>${yearKm(y - 1).toFixed(1)} km</span></div>` +
    `<div><span class="label">いちばん長い</span><span>${s.maxDist.toFixed(1)} km</span></div>` +
    `<div class="wide"><span class="label">登った高さの合計</span><span>${Math.round(s.up).toLocaleString()} m（富士山 ${(s.up / FUJI).toFixed(2)} 個分）</span></div>`;
  drawMonthChart(s.months);
  const got = BADGES.filter(b => earned(b, s)).length;
  $('#badgeSum').textContent = `バッジ ${got}／${BADGES.length}`;
  $('#badgeGrid').innerHTML = BADGES.map(b => {
    const ok = earned(b, s);
    return `<div class="badge ${ok ? 'ok' : ''}"><div class="b-icon">${b.icon}</div><div class="b-name">${esc(b.name)}</div>` +
      `<div class="b-sub">${ok ? '獲得' : fmtLeft(b, s)}</div></div>`;
  }).join('');
}

function drawMonthChart(months) {
  const cv = $('#monthChart');
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  if (!W) return;
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const now = new Date();
  const keys = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(d.getFullYear() * 100 + d.getMonth() + 1);
  }
  const vals = keys.map(k => months[k] || 0);
  const max = Math.max(10, ...vals);
  const padB = 16, padT = 14, bw = W / 12;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  keys.forEach((k, i) => {
    const h = (H - padB - padT) * vals[i] / max;
    ctx.fillStyle = i === 11 ? '#e07b2e' : cssVar('--accent');
    ctx.fillRect(i * bw + bw * 0.18, H - padB - h, bw * 0.64, h);
    ctx.fillStyle = cssVar('--sub');
    ctx.fillText((k % 100) + '月', i * bw + bw / 2, H - 3);
    if (vals[i] >= 1) ctx.fillText(Math.round(vals[i]), i * bw + bw / 2, H - padB - h - 3);
  });
}
