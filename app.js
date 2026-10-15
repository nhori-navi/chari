'use strict';
/* ChariMiru 段階1：ルート検索版
   ・出発地／経由地／目的地を指定して自転車ルートを検索
   ・坂の断面図、登り下り、最大勾配、所要時間と到着予定
   ・共有リンク                                            */

// ---------- 基本の設定値 ----------
// profile：OpenRouteServiceの自転車の種類
// speed：平地での標準の速度（km/h）
// climb：登り10mごとに足す時間（分）
const BIKES = {
  road:  { name: 'ロードバイク', profile: 'cycling-road',     speed: 25, climb: 0.8 },
  cross: { name: 'クロスバイク', profile: 'cycling-regular',  speed: 20, climb: 1.0 },
  city:  { name: '街乗り',       profile: 'cycling-regular',  speed: 15, climb: 1.3 },
  ebike: { name: '電動アシスト', profile: 'cycling-electric', speed: 18, climb: 0.4 }
};
const PREFS = {
  fast: '速さ優先',
  easy: '走りやすさ優先',
  flat: '坂をなるべく避ける'
};
// 上り坂の色分け
const GRADES = [
  { max: 3,        color: '#3d8b6e', label: '〜3%' },
  { max: 6,        color: '#e0b630', label: '3〜6%' },
  { max: 10,       color: '#e07b2e', label: '6〜10%' },
  { max: Infinity, color: '#d04437', label: '10%〜' }
];
const STEP = 20;   // 断面図の点の間隔（m）
const WIN = 5;     // 勾配を計算する幅（STEP×WIN＝100m）
const MAX_VIA = 8; // 経由地の上限

// ---------- 小さな道具 ----------
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function gradeClass(g) {
  for (let i = 0; i < GRADES.length; i++) if (g < GRADES[i].max) return i;
  return GRADES.length - 1;
}
function newPoint() { return { name: '', lng: null, lat: null }; }
function msg(text, isErr) {
  const m = $('#msg');
  m.textContent = text || '';
  m.className = isErr ? 'err' : '';
}
function fmtDur(min) {
  const m = Math.max(1, Math.round(min));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}時間${m % 60}分` : `${m}分`;
}
function fmtClock(date) {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}
function haversine(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// ---------- 状態 ----------
const state = {
  points: [newPoint(), newPoint()], // 先頭＝出発、最後＝到着、間＝経由
  bike: 'cross',
  pref: 'easy',
  avgSpeed: null,
  route: null,
  editIndex: null,
  pickLngLat: null
};

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('chari_settings') || '{}');
    if (BIKES[s.bike]) state.bike = s.bike;
    if (PREFS[s.pref]) state.pref = s.pref;
    if (s.avgSpeed > 0) state.avgSpeed = s.avgSpeed;
  } catch (e) { /* 保存領域が使えない場合は初期値のまま */ }
}
function saveSettings() {
  try {
    localStorage.setItem('chari_settings', JSON.stringify({ bike: state.bike, pref: state.pref, avgSpeed: state.avgSpeed }));
  } catch (e) { /* 無視 */ }
}

let riding = false; // 走行中か（ride.js が切り替える）

const keysOk = !!(CONFIG.MAPBOX_TOKEN && !CONFIG.MAPBOX_TOKEN.includes('ここに') &&
                  CONFIG.ORS_KEY && !CONFIG.ORS_KEY.includes('ここに'));

// ---------- 地図 ----------
mapboxgl.accessToken = CONFIG.MAPBOX_TOKEN;
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [139.35, 35.64],
  zoom: 11,
  attributionControl: false
});
map.addControl(new mapboxgl.AttributionControl({
  compact: true,
  customAttribution: 'ルート: © openrouteservice.org / © OpenStreetMap contributors / 標高: 国土地理院'
}));
map.dragRotate.disable();
map.touchZoomRotate.disableRotation();

let mapReady = false, pendingSearch = false;

map.on('load', () => {
  localizeLabels();
  map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'route-casing', type: 'line', source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 9 }
  });
  const colorExpr = ['match', ['get', 'cls']];
  GRADES.forEach((g, i) => colorExpr.push(i, g.color));
  colorExpr.push(GRADES[0].color);
  map.addLayer({
    id: 'route-line', type: 'line', source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': colorExpr, 'line-width': 5 }
  });
  mapReady = true;
  if (pendingSearch) { pendingSearch = false; searchRoute(); }
});

map.on('error', e => {
  if (e && e.error && (e.error.status === 401 || e.error.status === 403)) {
    msg('Mapboxのキーが正しくないか、このURLでの利用が許可されていません', true);
  }
});

// 地名を日本語表示にする
function localizeLabels() {
  for (const l of map.getStyle().layers) {
    if (l.type !== 'symbol') continue;
    const tf = map.getLayoutProperty(l.id, 'text-field');
    if (!tf || !JSON.stringify(tf).includes('"name')) continue;
    try { map.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', 'name_ja'], ['get', 'name']]); } catch (e) { /* 無視 */ }
  }
}

// ---------- 地図上の印 ----------
let markers = [], hereMarker = null, cursorMarker = null;

function updateMarkers() {
  markers.forEach(m => m.remove());
  markers = [];
  const n = state.points.length;
  state.points.forEach((p, i) => {
    if (p.lng == null) return;
    if (riding && typeof rideMarkerHidden === 'function' && rideMarkerHidden(i, n)) return;
    const el = document.createElement('div');
    el.className = 'mk ' + (i === 0 ? 'mk-s' : i === n - 1 ? 'mk-g' : 'mk-v');
    el.textContent = i === 0 ? 'S' : i === n - 1 ? 'G' : String(i);
    const m = new mapboxgl.Marker({ element: el, draggable: !riding }).setLngLat([p.lng, p.lat]).addTo(map);
    m.on('dragend', () => {
      const ll = m.getLngLat();
      setPoint(state.points.indexOf(p), ll.lng, ll.lat, null);
    });
    markers.push(m);
  });
}

function showHere(h) {
  if (!hereMarker) {
    const el = document.createElement('div');
    el.className = 'here';
    hereMarker = new mapboxgl.Marker({ element: el });
  }
  hereMarker.setLngLat([h.lng, h.lat]).addTo(map);
}

function showCursor(lng, lat) {
  if (!cursorMarker) {
    const el = document.createElement('div');
    el.className = 'cursor';
    cursorMarker = new mapboxgl.Marker({ element: el });
  }
  cursorMarker.setLngLat([lng, lat]).addTo(map);
}

// ---------- 位置と地名 ----------
function getHere() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('位置情報が使えません'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lng: p.coords.longitude, lat: p.coords.latitude }),
      err => reject(err),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });
}

async function reverseName(lng, lat) {
  try {
    const u = `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&language=ja&limit=1&access_token=${CONFIG.MAPBOX_TOKEN}`;
    const r = await fetch(u);
    const j = await r.json();
    const f = j.features && j.features[0];
    if (f) return f.properties.name || f.properties.full_address || '地図上の地点';
  } catch (e) { /* 無視 */ }
  return '地図上の地点';
}

async function searchPlaces(q) {
  const c = map.getCenter();
  const common = `language=ja&country=jp&limit=6&proximity=${c.lng},${c.lat}&access_token=${CONFIG.MAPBOX_TOKEN}`;
  // 1) 施設名・駅名に強い検索
  try {
    const r = await fetch(`https://api.mapbox.com/search/searchbox/v1/forward?q=${encodeURIComponent(q)}&${common}`);
    if (r.ok) {
      const j = await r.json();
      if (j.features && j.features.length) {
        return j.features.map(f => ({
          name: f.properties.name,
          sub: f.properties.full_address || f.properties.place_formatted || '',
          lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1]
        }));
      }
    }
  } catch (e) { /* 次の方法へ */ }
  // 2) 住所・地名の検索
  try {
    const r = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(q)}&${common}`);
    if (r.ok) {
      const j = await r.json();
      return (j.features || []).map(f => ({
        name: f.properties.name,
        sub: f.properties.full_address || f.properties.place_formatted || '',
        lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1]
      }));
    }
  } catch (e) { /* 無視 */ }
  return [];
}

// ---------- 地点の指定 ----------
function setPoint(i, lng, lat, name) {
  if (riding) return; // 走行中は地点を変えない
  const p = state.points[i];
  if (!p) return;
  p.lng = lng; p.lat = lat;
  p.name = name || '地図上の地点';
  if (!name) {
    reverseName(lng, lat).then(nm => {
      if (p.lng === lng && p.lat === lat) { p.name = nm; renderPoints(); }
    });
  }
  renderPoints();
  updateMarkers();
  autoSearch();
}

function canSearch() {
  const n = state.points.length;
  return state.points[0].lng != null && state.points[n - 1].lng != null;
}
function autoSearch() {
  if (canSearch()) searchRoute();
  else clearRoute();
}

function renderPoints() {
  const box = $('#points');
  box.innerHTML = '';
  const n = state.points.length;
  state.points.forEach((p, i) => {
    const kind = i === 0 ? 's' : i === n - 1 ? 'g' : 'v';
    const label = i === 0 ? '出発' : i === n - 1 ? '到着' : '経由' + i;
    const row = document.createElement('div');
    row.className = 'pt';
    let html = `<span class="tag tag-${kind}">${label}</span>` +
      `<button class="ptname" data-i="${i}">${p.lng == null ? '<span class="ph">タップして指定</span>' : esc(p.name)}</button>`;
    if (kind === 'v') {
      html += `<button class="mini" data-act="up" data-i="${i}" ${i === 1 ? 'disabled' : ''}>↑</button>` +
              `<button class="mini" data-act="down" data-i="${i}" ${i === n - 2 ? 'disabled' : ''}>↓</button>` +
              `<button class="mini" data-act="del" data-i="${i}">×</button>`;
    } else if (p.lng != null) {
      html += `<button class="mini" data-act="clear" data-i="${i}">×</button>`;
    }
    row.innerHTML = html;
    box.appendChild(row);
  });
}

$('#points').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const i = Number(b.dataset.i);
  if (b.classList.contains('ptname')) { openSearch(i); return; }
  const pts = state.points;
  const act = b.dataset.act;
  if (act === 'up') [pts[i - 1], pts[i]] = [pts[i], pts[i - 1]];
  else if (act === 'down') [pts[i + 1], pts[i]] = [pts[i], pts[i + 1]];
  else if (act === 'del') pts.splice(i, 1);
  else if (act === 'clear') pts[i] = newPoint();
  renderPoints();
  updateMarkers();
  autoSearch();
});

$('#btnAddVia').addEventListener('click', () => {
  if (state.points.length - 2 >= MAX_VIA) { msg(`経由地は${MAX_VIA}か所までです`, true); return; }
  state.points.splice(state.points.length - 1, 0, newPoint());
  renderPoints();
  openSearch(state.points.length - 2);
});

$('#btnSwap').addEventListener('click', () => {
  state.points.reverse();
  renderPoints();
  updateMarkers();
  autoSearch();
});

$('#btnSearch').addEventListener('click', () => searchRoute());

// ---------- モーダル（下から出る画面） ----------
function openModal(id) { $(id).hidden = false; }
function closeModals() { document.querySelectorAll('.modal').forEach(m => { m.hidden = true; }); }
document.querySelectorAll('.modal').forEach(m => {
  m.addEventListener('click', e => {
    if (e.target === m || e.target.hasAttribute('data-close')) closeModals();
  });
});

// 地点の検索
let searchTimer = null;
function openSearch(i) {
  state.editIndex = i;
  const n = state.points.length;
  $('#searchTitle').textContent = i === 0 ? '出発地を指定' : i === n - 1 ? '目的地を指定' : `経由地${i}を指定`;
  $('#searchInput').value = '';
  $('#searchResults').innerHTML = '';
  openModal('#searchModal');
  setTimeout(() => $('#searchInput').focus(), 50);
}

async function runSearch(q) {
  const ul = $('#searchResults');
  ul.innerHTML = '<li class="muted">検索中…</li>';
  const list = await searchPlaces(q);
  if ($('#searchInput').value.trim() !== q) return; // 入力が変わっていたら捨てる
  if (!list.length) { ul.innerHTML = '<li class="muted">見つかりませんでした</li>'; return; }
  ul.innerHTML = '';
  list.forEach(r => {
    const li = document.createElement('li');
    li.innerHTML = `<b>${esc(r.name)}</b><small>${esc(r.sub)}</small>`;
    li.addEventListener('click', () => {
      closeModals();
      setPoint(state.editIndex, r.lng, r.lat, r.name);
      if (!canSearch()) map.easeTo({ center: [r.lng, r.lat], zoom: Math.max(map.getZoom(), 14) });
    });
    ul.appendChild(li);
  });
}

$('#searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = $('#searchInput').value.trim();
  if (q.length < 2) { $('#searchResults').innerHTML = ''; return; }
  searchTimer = setTimeout(() => runSearch(q), 400);
});
$('#searchInput').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  clearTimeout(searchTimer);
  const q = $('#searchInput').value.trim();
  if (q) runSearch(q);
});

$('#btnUseHere').addEventListener('click', async () => {
  try {
    msg('現在地を取得中…');
    const h = await getHere();
    closeModals();
    showHere(h);
    msg('');
    setPoint(state.editIndex, h.lng, h.lat, '現在地');
    if (!canSearch()) map.easeTo({ center: [h.lng, h.lat], zoom: Math.max(map.getZoom(), 14) });
  } catch (e) {
    msg('現在地を取得できませんでした（位置情報の許可を確認してください）', true);
  }
});

// 地図の長押し（パソコンは右クリック）
let pressTimer = null, pressPoint = null;
function cancelPress() { clearTimeout(pressTimer); pressTimer = null; pressPoint = null; }
function openPick(lngLat) {
  if (riding || !$('#pickModal').hidden) return;
  state.pickLngLat = lngLat;
  openModal('#pickModal');
}
map.on('touchstart', e => {
  if (!e.originalEvent.touches || e.originalEvent.touches.length !== 1) { cancelPress(); return; }
  pressPoint = e.point;
  const ll = e.lngLat;
  pressTimer = setTimeout(() => { pressTimer = null; openPick(ll); }, 550);
});
map.on('touchmove', e => {
  if (pressPoint && (Math.abs(e.point.x - pressPoint.x) > 8 || Math.abs(e.point.y - pressPoint.y) > 8)) cancelPress();
});
map.on('touchend', cancelPress);
map.on('touchcancel', cancelPress);
map.on('dragstart', cancelPress);
map.on('zoomstart', cancelPress);
map.on('contextmenu', e => openPick(e.lngLat));

document.querySelectorAll('[data-pick]').forEach(b => {
  b.addEventListener('click', () => {
    const ll = state.pickLngLat;
    closeModals();
    if (!ll) return;
    const kind = b.dataset.pick;
    if (kind === 'start') setPoint(0, ll.lng, ll.lat, null);
    else if (kind === 'goal') setPoint(state.points.length - 1, ll.lng, ll.lat, null);
    else {
      if (state.points.length - 2 >= MAX_VIA) { msg(`経由地は${MAX_VIA}か所までです`, true); return; }
      const idx = state.points.length - 1;
      state.points.splice(idx, 0, newPoint());
      setPoint(idx, ll.lng, ll.lat, null);
    }
  });
});

// 現在地ボタン
$('#btnLocate').addEventListener('click', async () => {
  if (riding) { rideRecenter(); return; } // 走行中は「現在地を追いかける」に戻す
  try {
    const h = await getHere();
    showHere(h);
    map.easeTo({ center: [h.lng, h.lat], zoom: Math.max(map.getZoom(), 14) });
  } catch (e) {
    msg('現在地を取得できませんでした（位置情報の許可を確認してください）', true);
  }
});

// ---------- 設定 ----------
// 平地の速さ：設定した値 → 履歴から学んだ値 → 自転車の種類の標準 の順に使う
function planSpeed() {
  const b = BIKES[state.bike];
  if (state.avgSpeed) return { v: state.avgSpeed, src: '設定' };
  if (state.learned && state.learned[state.bike]) return { v: state.learned[state.bike].v, src: '履歴から' };
  return { v: b.speed, src: '標準' };
}
function renderCond() {
  const b = BIKES[state.bike];
  const ps = planSpeed();
  $('#condLine').innerHTML = `<b>${b.name}</b>・${PREFS[state.pref]}・平均${ps.v.toFixed(ps.src === '履歴から' ? 1 : 0)}km/h${ps.src === '履歴から' ? '（履歴）' : ''}　<span>変更 ›</span>`;
}

function openSettings() {
  $('#bikeOpts').innerHTML = Object.entries(BIKES).map(([k, b]) =>
    `<label><input type="radio" name="bike" value="${k}" ${k === state.bike ? 'checked' : ''}>${b.name}（標準 ${b.speed}km/h）</label>`).join('');
  $('#prefOpts').innerHTML = Object.entries(PREFS).map(([k, name]) =>
    `<label><input type="radio" name="pref" value="${k}" ${k === state.pref ? 'checked' : ''}>${name}</label>`).join('');
  $('#speedInput').value = state.avgSpeed || '';
  const L = state.learned || {};
  const lines = Object.entries(BIKES).filter(([k]) => L[k]).map(([k, b]) => `${b.name} ${L[k].v.toFixed(1)}km/h（最近${L[k].n}回の記録から）`);
  $('#learnedNote').textContent = lines.length
    ? '履歴から計算した平地の速さ：' + lines.join('、') + '。空欄にするとこちらを使います'
    : '同じ自転車の種類で10分以上の記録が2回たまると、自分の速さを計算して使います';
  openModal('#settingsModal');
}
$('#btnSettings').addEventListener('click', openSettings);
$('#condLine').addEventListener('click', openSettings);

$('#btnSaveSettings').addEventListener('click', () => {
  const bike = document.querySelector('input[name=bike]:checked');
  const pref = document.querySelector('input[name=pref]:checked');
  if (bike) state.bike = bike.value;
  if (pref) state.pref = pref.value;
  const v = parseFloat($('#speedInput').value);
  state.avgSpeed = v >= 5 && v <= 50 ? v : null;
  saveSettings();
  renderCond();
  closeModals();
  if (canSearch()) searchRoute();
});

// ---------- ルート検索 ----------
let searchSeq = 0;

async function orsRoute(profile, body) {
  const r = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
    method: 'POST',
    headers: {
      'Authorization': CONFIG.ORS_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/geo+json, application/json'
    },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    let m = j.error ? (j.error.message || j.error) : `エラー ${r.status}`;
    if (typeof m !== 'string') m = JSON.stringify(m);
    throw new Error(m);
  }
  return j;
}

// ORSにルートを頼む（細かい条件が通らなければ条件を外してもう一度）
async function fetchRoute(coordinates) {
  const bike = BIKES[state.bike];
  const preference = state.pref === 'fast' ? 'fastest' : 'recommended';
  const full = {
    coordinates, elevation: true, instructions: true, preference,
    options: { avoid_features: ['steps', 'ferries'] }
  };
  if (state.pref === 'flat') full.options.profile_params = { weightings: { steepness_difficulty: 0 } };
  try {
    return { j: await orsRoute(bike.profile, full), note: '' };
  } catch (e1) {
    const j = await orsRoute(bike.profile, { coordinates, elevation: true, instructions: true, preference });
    return { j, note: '※一部の条件（坂を避ける・階段を避ける等）を外して検索しました' };
  }
}

async function searchRoute() {
  if (riding) return;
  if (!canSearch()) { msg('出発地と目的地を指定してください', true); return; }
  if (!mapReady) { pendingSearch = true; return; }
  if (!keysOk) { msg('config.js にキーを設定してください', true); return; }

  const seq = ++searchSeq;
  $('#btnSearch').hidden = true;
  msg('ルートを検索中…');
  const pts = state.points.filter(p => p.lng != null);
  let res;
  try {
    res = await fetchRoute(pts.map(p => [p.lng, p.lat]));
  } catch (e2) {
    if (seq === searchSeq) {
      msg('ルートが見つかりませんでした：' + e2.message, true);
      setMode('edit');
      $('#btnSearch').hidden = false; // 失敗したときだけ「再検索」を出す
    }
    return;
  }
  if (seq !== searchSeq || riding) return; // より新しい検索が始まった・走行が始まったら捨てる

  try {
    const f = res.j.features && res.j.features[0];
    if (!f) throw new Error('結果が空でした');
    msg('坂の高さを調べています…');
    const route = await makeRoute(f, true);
    if (seq !== searchSeq || riding) return;
    route.wpPts = pts.map(p => ({ name: p.name, lng: p.lng, lat: p.lat }));
    showRoute(route);
    const notes = [res.note];
    if (route.elevSrc !== 'gsi') notes.push('※国土地理院の標高が取れなかったため、坂は粗いデータで表示しています');
    msg(notes.filter(Boolean).join(' '));
  } catch (e) {
    msg('ルートの表示に失敗しました：' + e.message, true);
  }
}

function clearRoute() {
  state.route = null;
  searchSeq++;
  if (mapReady) map.getSource('route').setData({ type: 'FeatureCollection', features: [] });
  setMode('edit');
  if (cursorMarker) cursorMarker.remove();
}

// ルートを20mごとの点に置き直し、標高をならして勾配を出す
function buildSamples(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + haversine(coords[i - 1], coords[i]);
  const total = cum[cum.length - 1];
  const out = [];
  let j = 0;
  for (let d = 0; d <= total; d += STEP) {
    while (j < cum.length - 2 && cum[j + 1] < d) j++;
    const a = coords[j], b = coords[Math.min(j + 1, coords.length - 1)];
    const seg = cum[Math.min(j + 1, cum.length - 1)] - cum[j];
    const t = seg > 0 ? (d - cum[j]) / seg : 0;
    const ea = a[2] ?? 0, eb = b[2] ?? 0;
    out.push({ d, lng: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t, e: ea + (eb - ea) * t });
  }
  const last = coords[coords.length - 1];
  if (!out.length || out[out.length - 1].d < total) out.push({ d: total, lng: last[0], lat: last[1], e: last[2] ?? 0 });
  finishSamples(out);
  return { samples: out, total, cum };
}

// 標高のでこぼこをならし（前後40m）、100mの幅で勾配（%）を出す
function finishSamples(out) {
  out.forEach((s, i) => {
    let sum = 0, c = 0;
    for (let k = i - 2; k <= i + 2; k++) if (k >= 0 && k < out.length) { sum += out[k].e; c++; }
    s.es = sum / c;
  });
  out.forEach((s, i) => {
    const k = Math.min(out.length - 1, i + WIN);
    const k0 = Math.max(0, k - WIN);
    const dd = out[k].d - out[k0].d;
    s.g = dd > 30 ? (out[k].es - out[k0].es) / dd * 100 : 0;
  });
}

// 曲がり角の種類（OpenRouteServiceの番号）→ 読み上げる言葉と矢印
const TURN = {
  0: ['左へ', '↰'], 1: ['右へ', '↱'], 2: ['大きく左へ', '↰'], 3: ['大きく右へ', '↱'],
  4: ['斜め左へ', '↖'], 5: ['斜め右へ', '↗'], 7: ['ロータリーへ', '⟲'], 8: ['ロータリーを出ます', '⟲'],
  9: ['Uターン', '↶'], 12: ['左側の道へ', '↖'], 13: ['右側の道へ', '↗']
};

// 検索していない道筋（記録・GPX）は、道の向きの変わり方から大きな曲がり角を見つける
function deriveTurns(samples) {
  const out = [];
  const brg = (a, b) => {
    const r = Math.PI / 180;
    const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
    const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
    return Math.atan2(y, x) / r;
  };
  const K = 2; // 前後40m
  let best = null;
  for (let i = K; i < samples.length - K; i++) {
    let dlt = brg(samples[i], samples[i + K]) - brg(samples[i - K], samples[i]);
    dlt = ((dlt + 540) % 360) - 180;
    if (Math.abs(dlt) >= 55) {
      if (!best || Math.abs(dlt) > Math.abs(best.dlt)) best = { i, dlt };
    } else if (best && i - best.i > K) {
      out.push(best);
      best = null;
    }
  }
  if (best) out.push(best);
  return out.filter((t, k) => k === 0 || samples[t.i].d - samples[out[k - 1].i].d > 60)
    .map(t => ({ d: samples[t.i].d, type: Math.abs(t.dlt) > 150 ? 9 : t.dlt > 0 ? (t.dlt > 120 ? 3 : 1) : (t.dlt < -120 ? 2 : 0), name: '' }));
}

// ルートの線（[経度, 緯度, 標高] の並び）から、表示に使う形を作る
async function makeRoute(f, useGsi) {
  const coords = f.geometry.coordinates;
  if (!coords || coords.length < 2) throw new Error('ルートの点が足りません');
  const { samples, total, cum } = buildSamples(coords);
  let elevSrc = 'ors';
  if (useGsi && typeof gsiFill === 'function') {
    let ok = false;
    try { ok = await gsiFill(samples); } catch (e) { ok = false; }
    if (ok) { finishSamples(samples); elevSrc = 'gsi'; }
  }
  let up = 0, down = 0, maxUp = 0, maxDown = 0;
  for (let i = 1; i < samples.length; i++) {
    const de = samples[i].es - samples[i - 1].es;
    if (de > 0) up += de; else down -= de;
  }
  samples.forEach(s => { maxUp = Math.max(maxUp, s.g); maxDown = Math.min(maxDown, s.g); });
  const props = f.properties || {};
  // 曲がり角（検索したルートはORSの案内、道筋だけのものは向きの変わり方から）
  let steps = [];
  if (Array.isArray(props.segments)) {
    props.segments.forEach(sg => (sg.steps || []).forEach(st => {
      if (!TURN[st.type] || !st.way_points) return;
      steps.push({ d: cum[Math.min(st.way_points[0], cum.length - 1)], type: st.type, name: st.name && st.name !== '-' ? st.name : '' });
    }));
  } else {
    steps = deriveTurns(samples);
  }
  return {
    steps,
    coords, samples, total, cum, elevSrc,
    dist: (props.summary && props.summary.distance) || total,
    ascent: up, descent: down, maxUp, maxDown,
    wpD: Array.isArray(props.way_points) ? props.way_points.map(i => cum[Math.min(i, cum.length - 1)]) : null
  };
}

// 地図に描く線を、勾配の色ごとに区切る（元の道の形のまま）
function buildSegments(coords, cum, samples) {
  const gAt = d => samples[Math.min(samples.length - 1, Math.round(d / STEP))].g;
  const feats = [];
  let cur = null;
  for (let i = 0; i < coords.length - 1; i++) {
    const cls = gradeClass(gAt((cum[i] + cum[i + 1]) / 2));
    if (!cur || cur.properties.cls !== cls) {
      cur = { type: 'Feature', properties: { cls }, geometry: { type: 'LineString', coordinates: [[coords[i][0], coords[i][1]]] } };
      feats.push(cur);
    }
    cur.geometry.coordinates.push([coords[i + 1][0], coords[i + 1][1]]);
  }
  return { type: 'FeatureCollection', features: feats };
}

function setRouteLayer(route) {
  map.getSource('route').setData(buildSegments(route.coords, route.cum, route.samples));
}

function showRoute(route) {
  state.route = route;
  setRouteLayer(route);
  if (cursorMarker) cursorMarker.remove();
  updateResult();
  $('#profileInfo').textContent = 'グラフを指でなぞると、地図にその地点が出ます';
  setMode('result', { detail: innerWidth >= 760 });
  const b = new mapboxgl.LngLatBounds();
  route.coords.forEach(c => b.extend([c[0], c[1]]));
  map.fitBounds(b, { padding: fitPadding(), maxZoom: 16, duration: 600 });
}

function fitPadding() {
  if (innerWidth >= 760) return { top: 70, bottom: 40, left: 420, right: 40 };
  const ph = $('#panel').offsetHeight;
  return { top: 70, bottom: Math.min(ph + 20, innerHeight * 0.6), left: 30, right: 30 };
}

function updateResult() {
  const r = state.route;
  if (!r) return;
  const b = BIKES[state.bike];
  const ps = planSpeed();
  const v = ps.v;
  const min = r.dist / 1000 / v * 60 + r.ascent / 10 * b.climb;
  $('#rDist').textContent = (r.dist / 1000).toFixed(1) + ' km';
  $('#rTime').textContent = fmtDur(min);
  $('#rEta').textContent = fmtClock(new Date(Date.now() + min * 60000)) + '（今出発）';
  $('#rClimb').textContent = `↑${Math.round(r.ascent)}m ／ ↓${Math.round(r.descent)}m`;
  $('#rGrade').textContent = `上り ${r.maxUp.toFixed(1)}% ／ 下り ${Math.abs(r.maxDown).toFixed(1)}%`;
  const sep = '<span class="sep">｜</span>';
  $('#sumLine').innerHTML =
    `<b>${(r.dist / 1000).toFixed(1)}km</b>${sep}${fmtDur(min)}${sep}到着 ${fmtClock(new Date(Date.now() + min * 60000))}${sep}↑${Math.round(r.ascent)}m`;
  $('#speedNote').textContent = `${b.name}・平地 平均${v.toFixed(1)}km/h（${ps.src}）、登り10mごとに約${b.climb}分を足して計算` +
    (r.elevSrc === 'gsi' ? '。標高は国土地理院（10mメッシュ）' : '');
}

// ---------- 坂の断面図 ----------
function drawProfile(cursorIdx, cvArg) {
  const r = state.route;
  const cv = cvArg || $('#profile');
  if (!r || cv.clientWidth === 0) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const s = r.samples;
  const small = H < 80; // 結果モードの小さい断面図
  const padL = 40, padR = 8, padT = small ? 6 : 10, padB = small ? 6 : 18;
  let eMin = Infinity, eMax = -Infinity;
  s.forEach(p => { eMin = Math.min(eMin, p.es); eMax = Math.max(eMax, p.es); });
  if (eMax - eMin < 20) { const m = (eMax + eMin) / 2; eMin = m - 10; eMax = m + 10; }
  const X = d => padL + (W - padL - padR) * (r.total > 0 ? d / r.total : 0);
  const Y = e => padT + (H - padT - padB) * (1 - (e - eMin) / (eMax - eMin));

  // 塗り
  ctx.beginPath();
  ctx.moveTo(X(0), H - padB);
  s.forEach(p => ctx.lineTo(X(p.d), Y(p.es)));
  ctx.lineTo(X(r.total), H - padB);
  ctx.closePath();
  ctx.fillStyle = cssVar('--fill');
  ctx.fill();

  // 勾配で色分けした線
  ctx.lineWidth = 2.5;
  for (let i = 1; i < s.length; i++) {
    ctx.beginPath();
    ctx.strokeStyle = GRADES[gradeClass(s[i].g)].color;
    ctx.moveTo(X(s[i - 1].d), Y(s[i - 1].es));
    ctx.lineTo(X(s[i].d), Y(s[i].es));
    ctx.stroke();
  }

  // 目盛り
  ctx.fillStyle = cssVar('--sub');
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(Math.round(eMax) + 'm', padL - 4, padT + 8);
  ctx.fillText(Math.round(eMin) + 'm', padL - 4, H - padB);
  if (!small) {
    ctx.textAlign = 'left';
    ctx.fillText('0', padL, H - 4);
    ctx.textAlign = 'right';
    ctx.fillText((r.total / 1000).toFixed(1) + 'km', W - padR, H - 4);
  }

  // なぞっている位置
  if (cursorIdx != null) {
    const p = s[cursorIdx];
    ctx.strokeStyle = cssVar('--fg');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(X(p.d), padT);
    ctx.lineTo(X(p.d), H - padB);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(X(p.d), Y(p.es), 4, 0, Math.PI * 2);
    ctx.fillStyle = cssVar('--fg');
    ctx.fill();
  }
  if (!cvArg) r.geom = { padL, padR, W };
}

function onProfile(e) {
  const r = state.route;
  if (!r || !r.geom) return;
  const rect = $('#profile').getBoundingClientRect();
  const { padL, padR, W } = r.geom;
  const t = Math.min(1, Math.max(0, (e.clientX - rect.left - padL) / (W - padL - padR)));
  const i = Math.min(r.samples.length - 1, Math.round(t * r.total / STEP));
  const p = r.samples[i];
  drawProfile(i);
  const info = `${(p.d / 1000).toFixed(2)}km地点　標高 ${Math.round(p.es)}m　勾配 ${p.g.toFixed(1)}%`;
  $('#profileInfo').textContent = info;
  if (!$('#panel').classList.contains('detail')) $('#sumLine').textContent = info;
  showCursor(p.lng, p.lat);
}
const cv = $('#profile');
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); onProfile(e); });
cv.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || e.buttons) onProfile(e); });
// なぞり終わったら、小さい表示の1行を元の要約に戻す
cv.addEventListener('pointerup', () => { if (!$('#panel').classList.contains('detail')) setTimeout(updateResult, 1500); });
cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !$('#panel').classList.contains('detail')) updateResult(); });
window.addEventListener('resize', () => drawProfile(null));

$('#legend').innerHTML = '上り坂：' + GRADES.map(g => `<span><i style="background:${g.color}"></i>${g.label}</span>`).join('');

// ---------- 共有リンク ----------
$('#btnShare').addEventListener('click', async () => {
  if (state.route && state.route.fromTrack) {
    msg('記録の道筋から作ったルートは、共有リンクにできません（GPXの書き出しを使ってください）', true);
    return;
  }
  const pts = state.points.filter(p => p.lng != null);
  const q = new URLSearchParams();
  q.set('p', pts.map(p => p.lng.toFixed(5) + ',' + p.lat.toFixed(5)).join(';'));
  q.set('n', pts.map(p => (p.name || '').replace(/\|/g, ' ')).join('|'));
  q.set('b', state.bike);
  q.set('r', state.pref);
  const url = location.origin + location.pathname + '?' + q.toString();
  if (navigator.share) {
    try { await navigator.share({ title: 'ChariMiru のルート', url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    msg('共有リンクをコピーしました');
  } catch (e) {
    window.prompt('このリンクをコピーしてください', url);
  }
});

function loadFromUrl() {
  const q = new URLSearchParams(location.search);
  const p = q.get('p');
  if (!p) return false;
  const coords = p.split(';').map(s => s.split(',').map(Number))
    .filter(a => a.length === 2 && a.every(Number.isFinite));
  if (coords.length < 2) return false;
  const names = (q.get('n') || '').split('|');
  state.points = coords.map((c, i) => ({ lng: c[0], lat: c[1], name: names[i] || '地点' }));
  if (BIKES[q.get('b')]) state.bike = q.get('b');
  if (PREFS[q.get('r')]) state.pref = q.get('r');
  return true;
}

// ---------- 画面の切り替え（地点の指定 ⇔ 結果） ----------
function setMode(mode, opts = {}) {
  const pn = $('#panel');
  pn.classList.toggle('mode-result', mode === 'result');
  pn.classList.toggle('mode-edit', mode === 'edit');
  pn.classList.toggle('mode-ride', mode === 'ride');
  if (mode !== 'ride') { pn.classList.remove('ride-full'); document.body.classList.remove('ride-full'); }
  pn.classList.remove('collapsed');
  if (mode === 'result') pn.classList.toggle('detail', !!opts.detail);
  $('#btnBackResult').hidden = !(mode === 'edit' && state.route);
  updDetailBtn();
  if (mode === 'result') drawProfile(null);
}
function updDetailBtn() {
  $('#btnDetail').textContent = $('#panel').classList.contains('detail') ? '閉じる ▴' : '詳しく ▾';
}
function toggleDetail() {
  $('#panel').classList.toggle('detail');
  updDetailBtn();
  drawProfile(null);
}
$('#btnEdit').addEventListener('click', () => setMode('edit'));
$('#btnBackResult').addEventListener('click', () => setMode('result', { detail: innerWidth >= 760 }));
$('#btnDetail').addEventListener('click', toggleDetail);

// ---------- パネルの開閉と表示調整 ----------
$('#panelHandle').addEventListener('click', () => {
  const pn = $('#panel');
  if (pn.classList.contains('mode-result')) toggleDetail();
  else if (pn.classList.contains('mode-edit')) pn.classList.toggle('collapsed');
  else if (pn.classList.contains('mode-ride')) toggleRideFull();
});

if (window.ResizeObserver) {
  new ResizeObserver(() => {
    const ph = innerWidth >= 760 ? 0 : $('#panel').offsetHeight;
    document.documentElement.style.setProperty('--ph', ph + 'px');
  }).observe($('#panel'));
}

if (CONFIG.SERIES_TOP_URL) {
  const a = $('#seriesLink');
  a.href = CONFIG.SERIES_TOP_URL;
  a.hidden = false;
}

// ---------- ホーム画面アプリ用 ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* 登録できなくても普通に使える */ });
}

// ---------- 起動 ----------
loadSettings();
const fromUrl = loadFromUrl();
renderPoints();
renderCond();
updateMarkers();
if (!keysOk) msg('config.js にMapboxとOpenRouteServiceのキーを設定してください', true);
if (fromUrl) {
  msg('共有されたルートを表示します');
  searchRoute();
}
