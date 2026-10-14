'use strict';
/* ChariMiru 版4：走行モード
   ・走行中の速度・時間・距離・平均・登り、ルートがあれば残り距離・到着予定・この先の坂
   ・自動一時停止、手動の一時停止
   ・記録の保存（端末内の IndexedDB）。途中で閉じても30分以内なら続きから
   ・音声案内、3D表示（進む方向が上・建物が立体）
   app.js の後に読み込む（app.js の state・map・$ などを使う）            */

const RIDE_KEY = 'chari_ride';        // 走行中の記録の一時保存
const RIDE_PREFS = 'chari_ride_prefs'; // 音声・3Dの設定
const AUTO_PAUSE_KMH = 2;   // これより遅い状態が続いたら自動一時停止
const AUTO_RESUME_KMH = 4;  // これより速くなったら再開
const AUTO_PAUSE_SEC = 5;
const OFF_ROUTE_M = 50;     // ルートからこれ以上離れたら「外れた」
const MILESTONE_KM = 5;     // 何kmごとに音声で知らせるか
const CLIMB_WARN_M = 300;   // 坂の何m手前で知らせるか
const RESUME_MIN = 30;      // 何分以内なら続きから再開できるか

let ride = null;
let watchId = null, wakeLock = null, rideTimer = null, rideMarker = null;
let follow = true, lastLineDraw = 0;

// 地図の向き：north＝北が上、heading＝進行方向が上、3d＝進行方向が上＋斜めから
const VIEWS = ['north', 'heading', '3d'];
const VIEW_LABEL = { north: '北↑', heading: '進↑', '3d': '3D' };
let voiceOn = true, viewMode = 'north', autoReroute = true;
try {
  const p = JSON.parse(localStorage.getItem(RIDE_PREFS) || '{}');
  voiceOn = p.voice !== false;
  autoReroute = p.reroute !== false;
  viewMode = VIEWS.includes(p.view) ? p.view : (p.view3d ? '3d' : 'north');
} catch (e) { /* 初期値のまま */ }
function saveRidePrefs() {
  try { localStorage.setItem(RIDE_PREFS, JSON.stringify({ voice: voiceOn, view: viewMode, reroute: autoReroute })); } catch (e) { /* 無視 */ }
}

// ---------- コンパス（止まっている・ゆっくりのときの向き） ----------
const COMPASS_BELOW_KMH = 5; // これより遅いときはコンパス、速いときはGPSの移動の向き
let compass = null, compassOn = false, lastRot = 0;

function enableCompass() {
  if (compassOn) return;
  const listen = () => {
    const ev = ('ondeviceorientationabsolute' in window) ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(ev, onOrient, true);
    compassOn = true;
  };
  try {
    // iPhoneは、ボタンを押した直後に許可を求める必要がある
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then(r => { if (r === 'granted') listen(); })
        .catch(() => { /* 許可されなければGPSの向きだけ使う */ });
    } else if (typeof DeviceOrientationEvent !== 'undefined') {
      listen();
    }
  } catch (e) { /* 使えない端末ではGPSの向きだけ */ }
}

function smoothAngle(a, b, k) {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * k + 360) % 360;
}

function onOrient(e) {
  let h = null;
  if (e.webkitCompassHeading != null && !isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading; // iPhone
  else if (e.absolute && e.alpha != null) h = 360 - e.alpha; // Android
  if (h == null) return;
  const so = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  h = (h + so + 360) % 360;
  compass = compass == null ? h : smoothAngle(compass, h, 0.25);
  if (ride && riding) onCompassTick();
}

// 今使う向き：走っていればGPSの移動の向き、遅ければコンパス
function headingNow() {
  if (!ride) return null;
  if (ride.spd >= COMPASS_BELOW_KMH && ride.course != null) return ride.course;
  if (compass != null) return compass;
  return ride.course;
}

function onCompassTick() {
  if (ride.spd >= COMPASS_BELOW_KMH) return;
  if (rideMarker) rideMarker.setRotation(compass);
  if (!follow || viewMode === 'north' || !ride.pos) return;
  const now = Date.now();
  if (now - lastRot < 250) return;
  const diff = Math.abs(((compass - map.getBearing() + 540) % 360) - 180);
  if (diff < 4) return; // 小さな揺れでは回さない
  lastRot = now;
  map.easeTo({
    center: ride.pos, bearing: compass, pitch: viewMode === '3d' ? 60 : 0,
    offset: camOffset(viewMode === '3d' ? 0.72 : 0.62), duration: 250
  });
}

// ---------- 小さな道具 ----------
function bearing(a, b) {
  const r = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r);
  const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
function fmtHMS(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function fmtM(m) { return m >= 1000 ? (m / 1000).toFixed(1) + 'km' : Math.round(m / 10) * 10 + 'm'; }
function sayLen(m) { return m >= 1000 ? `${(m / 1000).toFixed(1)}キロ` : `${Math.round(m / 100) * 100}メートル`; }

function speak(text) {
  if (!voiceOn || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch (e) { /* 無視 */ }
}

let statusText = '', statusWarn = false, noteText = '';
function setStatus(text, warn) {
  const el = $('#rdStatus');
  el.textContent = text;
  el.className = 'ride-status' + (warn ? ' warn' : '');
  statusText = text === '● 記録中' ? '' : text; // 小さい表示では、普段の「記録中」は出さない
  statusWarn = !!warn;
  updToast();
}
function setNote(text) { noteText = text || ''; $('#rdNote').textContent = noteText; updToast(); }
function updToast() {
  const el = $('#rdToast');
  el.textContent = statusText || noteText;
  el.className = statusText && statusWarn ? 'warn' : '';
}
// 知らせをタップすると、注意書き（自動ロックなど）は消す
$('#rdToast').addEventListener('click', () => { if (!statusText) setNote(''); });

function toggleRideFull() {
  const full = $('#panel').classList.toggle('ride-full');
  document.body.classList.toggle('ride-full', full);
  if (ride) { renderHud(); if (follow && ride.pos) moveCamera(ride.pos); }
}
$('#rideBar .rb-text').addEventListener('click', toggleRideFull);

// ---------- ルートの下ごしらえ（坂の区間、残りの登り） ----------
let rr = null;
function prepRoute() {
  const r = state.route;
  if (!r) { rr = null; return; }
  const S = r.samples;
  const cumUp = [0];
  for (let i = 1; i < S.length; i++) {
    const de = S[i].es - S[i - 1].es;
    cumUp[i] = cumUp[i - 1] + (de > 0 ? de : 0);
  }
  // 勾配3%以上が続く所を「登り」とする（100m未満の切れ目はつなぐ）
  const raw = [];
  let cur = null;
  for (let i = 0; i < S.length; i++) {
    if (S[i].g >= 3) { if (!cur) cur = { si: i, ei: i }; else cur.ei = i; }
    else if (cur && S[i].d - S[cur.ei].d > 100) { raw.push(cur); cur = null; }
  }
  if (cur) raw.push(cur);
  const climbs = raw.map(c => {
    const a = S[c.si], b = S[Math.min(S.length - 1, c.ei + WIN)];
    const len = b.d - a.d, gain = b.es - a.es;
    return { start: a.d, end: b.d, len, gain, avg: len > 0 ? gain / len * 100 : 0, spoken: false };
  }).filter(c => c.len >= 200 && c.gain >= 10);
  const steps = (r.steps || []).map(s => ({ ...s, saidFar: false, saidNear: false }));
  rr = { S, total: r.total, cumUp, totalUp: cumUp[cumUp.length - 1], climbs, steps, end: S[S.length - 1] };
}

// ---------- 曲がり角の案内 ----------
function nextTurn(prog) {
  if (!rr || !rr.steps) return null;
  return rr.steps.find(s => s.d > prog - 10) || null;
}
function turnWords(s) { return TURN[s.type] ? TURN[s.type][0] : ''; }
function turnText(s, prog) {
  const dist = Math.max(0, s.d - prog);
  return `${TURN[s.type][1]} ${fmtM(dist)} ${turnWords(s)}${s.name ? '（' + s.name + '）' : ''}`;
}
function checkTurnVoice(prog) {
  const s = nextTurn(prog);
  if (!s) return;
  const dist = s.d - prog;
  // 速いほど早めに案内（15秒前。150〜300mの間）
  const far = Math.min(300, Math.max(150, ride.spd / 3.6 * 15));
  if (!s.saidFar && dist <= far && dist > 60) {
    s.saidFar = true;
    speak(`${Math.max(50, Math.round(dist / 50) * 50)}メートル先、${turnWords(s)}${s.name ? '。' + s.name : ''}`);
  }
  if (!s.saidNear && dist <= 35) {
    s.saidNear = true;
    s.saidFar = true;
    const after = rr.steps[rr.steps.indexOf(s) + 1];
    const soon = after && after.d - s.d < 100 ? `。すぐ${turnWords(after)}` : '';
    speak(`まもなく${turnWords(s)}${soon}`);
  }
}

function climbText(prog) {
  for (const c of rr.climbs) {
    if (c.end < prog) continue;
    if (c.start > prog) return `⛰ ${fmtM(c.start - prog)}先から登り ${fmtM(c.len)}・平均${c.avg.toFixed(1)}%`;
    return `⛰ 登り中：残り ${fmtM(c.end - prog)}・平均${c.avg.toFixed(1)}%`;
  }
  return 'この先に目立った登りはありません';
}

function checkClimbVoice(prog) {
  for (const c of rr.climbs) {
    if (c.end < prog) continue;
    const ahead = c.start - prog;
    if (!c.spoken && ahead <= CLIMB_WARN_M) {
      c.spoken = true;
      speak(ahead > 60
        ? `この先${Math.round(ahead / 50) * 50}メートルから上り坂。長さ${sayLen(c.len)}、平均${Math.round(c.avg)}パーセントです`
        : `上り坂です。長さ${sayLen(c.len)}、平均${Math.round(c.avg)}パーセントです`);
    }
    return;
  }
}

// ルート上のどこにいるか
let rerouting = false, lastReroute = 0;
function updProgress(pos, acc, wide, t) {
  const S = rr.S;
  const cosLat = Math.cos(pos[1] * Math.PI / 180);
  const from = (ride.offRoute || wide) ? 0 : Math.max(0, ride.progIdx - 50);
  const to = (ride.offRoute || wide) ? S.length - 1 : Math.min(S.length - 1, ride.progIdx + 300);
  let best = ride.progIdx, bd = Infinity;
  for (let i = from; i <= to; i++) {
    const dx = (S[i].lng - pos[0]) * cosLat * 111320, dy = (S[i].lat - pos[1]) * 110540;
    const dd = dx * dx + dy * dy;
    if (dd < bd) { bd = dd; best = i; }
  }
  bd = Math.sqrt(bd);
  const lim = Math.max(OFF_ROUTE_M, Math.min(acc, 80));
  if (bd > lim) {
    ride.offCount++;
    if (!ride.offSince) ride.offSince = t;
    if (ride.offCount >= 3 && !ride.offRoute) { ride.offRoute = true; speak('ルートから外れました'); }
    if (ride.offRoute && autoReroute && !rerouting && t - ride.offSince >= 15000 && Date.now() - lastReroute > 30000) reroute(pos);
    return null;
  }
  if (ride.offRoute) speak('ルートに戻りました');
  ride.offRoute = false;
  ride.offCount = 0;
  ride.offSince = null;
  ride.progIdx = best;
  return S[best];
}

async function reroute(pos) {
  if (!ride || !state.route) return;
  rerouting = true;
  lastReroute = Date.now();
  setStatus('ルートを引き直しています…');
  try {
    const prog = rr.S[ride.progIdx].d;
    const wp = state.route.wpPts || [];
    const wpD = state.route.wpD || [];
    // まだ通っていない経由地と目的地
    let rest = wp.filter((p, i) => i > 0 && (wpD[i] == null || wpD[i] > prog + 30));
    if (!rest.length && wp.length) rest = [wp[wp.length - 1]];
    const pts = [{ name: '現在地', lng: pos[0], lat: pos[1] }, ...rest];
    const res = await fetchRoute(pts.map(p => [p.lng, p.lat]));
    const f = res.j.features && res.j.features[0];
    if (!f) throw new Error('結果が空でした');
    const route = await makeRoute(f, true);
    if (!ride) return;
    route.wpPts = pts.map(p => ({ name: p.name, lng: p.lng, lat: p.lat }));
    state.route = route;
    state.points = route.wpPts.map(p => ({ ...p }));
    ride.points = state.points;
    setRouteLayer(route);
    renderPoints();
    updateMarkers();
    prepRoute();
    ride.progIdx = 0;
    ride.offRoute = false;
    ride.offCount = 0;
    ride.offSince = null;
    ride.arrived = false;
    speak('ルートを引き直しました');
    renderHud();
    persist();
  } catch (e) {
    setStatus('ルートを引き直せませんでした（通信を確認してください）', true);
  } finally {
    rerouting = false;
  }
}

function updRerouteBtn() {
  $('#btnReroute').textContent = '自動で引き直す：' + (autoReroute ? 'オン' : 'オフ');
  $('#btnReroute').classList.toggle('on', autoReroute);
}
$('#btnReroute').addEventListener('click', () => {
  autoReroute = !autoReroute;
  saveRidePrefs();
  updRerouteBtn();
  speak(autoReroute ? 'ルートを外れたら自動で引き直します' : '自動の引き直しをオフにしました');
});

// ---------- 自分の速さを履歴から学ぶ ----------
// 自転車の種類ごとに、走行時間10分以上の最近10回から「平地の速さ」を出す（登りにかかった分は差し引く）
async function refreshLearned() {
  let all = [];
  try { all = await allRides(); } catch (e) { return; }
  const out = {};
  Object.keys(BIKES).forEach(k => {
    const rs = all.filter(r => r.bike === k && r.movingMs >= 600000 && r.dist > 1000)
      .sort((a, b) => b.start - a.start).slice(0, 10);
    if (rs.length < 2) return;
    let dist = 0, flatMs = 0;
    rs.forEach(r => {
      dist += r.dist;
      flatMs += Math.max(r.movingMs * 0.5, r.movingMs - (r.up || 0) / 10 * BIKES[k].climb * 60000);
    });
    const v = dist / 1000 / (flatMs / 3600000);
    if (v >= 6 && v <= 45) out[k] = { v, n: rs.length };
  });
  state.learned = out;
  renderCond();
  if (state.route && !riding) updateResult();
}

// ---------- 走行の開始 ----------
function routeLabel() {
  const pts = state.points.filter(p => p.lng != null);
  return pts.length >= 2 ? `${pts[0].name} → ${pts[pts.length - 1].name}` : null;
}

function startRide(withRoute) {
  if (!navigator.geolocation) { msg('この端末では位置情報が使えません', true); return; }
  if (withRoute && !state.route) withRoute = false;
  // iPhoneでは、最初の音声はボタンを押した直後に出す必要がある
  speak(withRoute ? 'ルート案内と記録を始めます' : '記録を始めます');
  enableCompass();
  ride = {
    start: Date.now(), withRoute,
    routeName: withRoute ? routeLabel() : null,
    points: withRoute ? state.points : null,
    bike: state.bike,
    track: [], dist: 0, movingMs: 0, maxSpd: 0, up: 0, down: 0,
    paused: false, autoPaused: false, slowSince: null,
    last: null, prevFixT: null, lastPushT: 0, segBreak: false, eleBase: null,
    spd: 0, course: null,
    progIdx: 0, offCount: 0, offRoute: false,
    nextMilestone: MILESTONE_KM, arrived: false, savedAt: Date.now()
  };
  beginRide();
}

function beginRide() {
  riding = true;
  document.body.classList.add('riding');
  $('#panel').classList.toggle('with-route', !!ride.withRoute);
  if (ride.withRoute) prepRoute(); else rr = null;
  setMode('ride');
  setNote('');
  statusText = '';
  updateMarkers(); // 走行中は印を動かせないようにする
  follow = true;
  updFollowBtn();
  ensureRideLayer();
  drawRideLine(true);
  setNote('');
  setStatus('GPSの電波を探しています…');
  updVoiceBtn();
  upd3dBtn();
  updRerouteBtn();
  apply3d(true);
  startWatch();
  requestWake();
  clearInterval(rideTimer);
  rideTimer = setInterval(tick, 1000);
  renderHud();
  persist();
}

function startWatch() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(onFix, onFixErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
}
function onFixErr(e) {
  if (!ride) return;
  setStatus(e && e.code === 1 ? '位置情報の利用が許可されていません（設定を確認してください）' : 'GPSの電波を探しています…', true);
}

async function requestWake() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
      return;
    }
  } catch (e) { /* 下の案内へ */ }
  setNote('画面が消えると記録が止まります。自動ロックを「なし」に（設定→画面表示と明るさ）。タップで閉じる');
}

// ---------- 位置が届いたとき ----------
function onFix(p) {
  if (!ride) return;
  const c = p.coords, t = p.timestamp || Date.now();
  const pos = [c.longitude, c.latitude];
  const acc = c.accuracy || 999;
  ride.pos = pos;
  showRidePos(pos);

  if (ride.paused) { ride.last = null; ride.prevFixT = t; ride.segBreak = true; renderHud(); return; }
  if (acc > 40) { setStatus(`GPSの精度が低い状態です（±${Math.round(acc)}m）`, true); return; }

  const gapMs = ride.prevFixT ? t - ride.prevFixT : 0;
  const gap = gapMs > 30000;
  let d = 0;
  if (ride.last) d = haversine(ride.last, pos);

  // 速度（GPSが出す値。無ければ移動距離から計算）
  let spd = (c.speed != null && c.speed >= 0) ? c.speed * 3.6 : null;
  if (spd == null) spd = (ride.last && gapMs > 0 && !gap) ? d / (gapMs / 1000) * 3.6 : 0;
  if (spd > 90) spd = ride.spd; // あり得ない値は捨てる
  ride.spd = ride.spd * 0.4 + spd * 0.6;

  // 自動一時停止
  if (ride.spd < AUTO_PAUSE_KMH) {
    if (!ride.slowSince) ride.slowSince = t;
    if (!ride.autoPaused && t - ride.slowSince >= AUTO_PAUSE_SEC * 1000) ride.autoPaused = true;
  } else {
    ride.slowSince = null;
    if (ride.autoPaused && ride.spd >= AUTO_RESUME_KMH) ride.autoPaused = false;
  }

  // 距離と走行時間
  let moved = false;
  if (!ride.last) {
    moved = true;
  } else if (gap) {
    // 画面が消えていた間は直線で距離を足す（速さが自転車らしいときだけ走行時間にも足す）
    const kmh = d / (gapMs / 1000) * 3.6;
    ride.dist += d;
    if (kmh >= 5 && kmh <= 60) ride.movingMs += gapMs;
    ride.segBreak = true;
    moved = true;
    setNote(`画面が消えていた約${Math.round(gapMs / 60000)}分の間は記録できていません（距離は直線で足しました）`);
  } else {
    if (!ride.autoPaused) ride.movingMs += Math.min(gapMs, 10000);
    if (!ride.autoPaused && d >= 3) { ride.dist += d; moved = true; }
  }
  ride.prevFixT = t;

  if (moved) {
    if (ride.last && d >= 8) ride.course = bearing(ride.last, pos);
    ride.last = pos;
  } else if (c.heading != null && !isNaN(c.heading) && ride.spd > 5) {
    ride.course = c.heading;
  }
  if (acc <= 25 && spd < 80 && !ride.autoPaused) ride.maxSpd = Math.max(ride.maxSpd, ride.spd);

  // ルート上の位置
  let onSample = null;
  if (ride.withRoute && rr) {
    onSample = updProgress(pos, acc, gap, t);
    if (onSample) {
      const prog = onSample.d;
      checkTurnVoice(prog);
      checkClimbVoice(prog);
      if (!ride.arrived && rr.total - prog < 60 && haversine(pos, [rr.end.lng, rr.end.lat]) < 50) {
        ride.arrived = true;
        speak('目的地に到着しました。終了ボタンで記録を保存できます');
      }
    }
  }

  // 標高（ルート上ならルートの標高、外ならGPSの高度）と登りの合計
  const ele = onSample ? onSample.es : (c.altitude != null ? c.altitude : null);
  if (ele != null && moved) {
    if (ride.eleBase == null) ride.eleBase = ele;
    else if (ele - ride.eleBase >= 5) { ride.up += ele - ride.eleBase; ride.eleBase = ele; }
    else if (ride.eleBase - ele >= 5) { ride.down += ride.eleBase - ele; ride.eleBase = ele; }
  }

  // 道筋の記録（4秒ごと、または途切れたとき）
  if (moved && (t - ride.lastPushT >= 4000 || ride.segBreak || !ride.track.length)) {
    ride.track.push([t, +pos[1].toFixed(6), +pos[0].toFixed(6), ele != null ? Math.round(ele * 10) / 10 : null, ride.segBreak ? 1 : 0]);
    ride.lastPushT = t;
    ride.segBreak = false;
  }

  // 5kmごとの音声
  if (ride.dist / 1000 >= ride.nextMilestone) {
    const avg = avgKmh();
    let s = `${ride.nextMilestone}キロ走りました。`;
    if (avg) s += `平均時速${Math.round(avg)}キロ。`;
    if (onSample) s += `残り${Math.round((rr.total - onSample.d) / 100) / 10}キロです`;
    speak(s);
    ride.nextMilestone += MILESTONE_KM;
  }

  drawRideLine(false);
  moveCamera(pos);
  renderHud();
}

function avgKmh() {
  return ride.movingMs > 60000 && ride.dist > 100 ? ride.dist / 1000 / (ride.movingMs / 3600000) : null;
}

// ---------- 表示 ----------
function renderHud() {
  if (!ride) return;
  const r = ride;
  const stopped = r.paused || r.autoPaused;
  $('#rdSpd').textContent = stopped ? '0.0' : r.spd.toFixed(1);
  $('#rdTime').textContent = fmtHMS(r.movingMs);
  $('#rdDist').textContent = (r.dist / 1000).toFixed(2) + ' km';
  const avg = avgKmh();
  $('#rdAvg').textContent = avg ? avg.toFixed(1) + ' km/h' : '--';
  $('#rdUp').textContent = Math.round(r.up) + ' m';
  $('#btnPause').textContent = r.paused ? '▶ 再開' : '⏸ 一時停止';
  $('#btnPauseS').textContent = r.paused ? '▶' : '⏸';
  $('#rcSpd').textContent = $('#rdSpd').textContent;
  $('#rcDist').textContent = (r.dist / 1000).toFixed(2) + ' km';
  $('#rcTime').textContent = fmtHMS(r.movingMs);
  $('#rbLine1').textContent = `平均 ${avg ? avg.toFixed(1) + 'km/h' : '--'}｜登り ${Math.round(r.up)}m`;

  if (r.withRoute && rr) {
    const prog = rr.S[r.progIdx].d;
    const rem = Math.max(0, rr.total - prog);
    const b = BIKES[r.bike] || BIKES.cross;
    const v = (avg && r.dist > 1000) ? avg : planSpeed().v;
    const remUp = rr.totalUp - rr.cumUp[r.progIdx];
    const min = rem / 1000 / v * 60 + remUp / 10 * b.climb;
    $('#rdRem').textContent = (rem / 1000).toFixed(1) + ' km';
    $('#rdEta').textContent = fmtClock(new Date(Date.now() + min * 60000));
    $('#rdClimb').textContent = climbText(prog);
    const nt = nextTurn(prog);
    const tt = nt && nt.d - prog <= 2000 && !r.offRoute ? turnText(nt, prog) : '';
    $('#rbTurn').textContent = tt;
    $('#rdTurn').textContent = tt;
    $('#rbLine1').textContent = `残り ${(rem / 1000).toFixed(1)}km｜到着 ${$('#rdEta').textContent}`;
    $('#rbLine2').textContent = climbText(prog);
    if ($('#panel').classList.contains('ride-full')) drawProfile(r.progIdx, $('#rideProfile'));
  }

  if (r.paused) setStatus('⏸ 一時停止中（記録していません）');
  else if (r.offRoute) setStatus('⚠ ルートから外れています', true);
  else if (r.arrived) setStatus('🏁 目的地に到着しました');
  else if (r.autoPaused) setStatus('止まっています（自動で一時停止中）');
  else if (r.last) setStatus('● 記録中');
}

function tick() {
  if (!ride) return;
  renderHud();
  if (Date.now() - ride.savedAt > 15000) persist();
}

function showRidePos(pos) {
  if (!rideMarker) {
    const el = document.createElement('div');
    el.className = 'ride-pos';
    el.innerHTML = '<svg viewBox="0 0 30 30" width="30" height="30"><circle cx="15" cy="15" r="12.5" fill="#2a7de1" stroke="#fff" stroke-width="3"/><path d="M15 6.5 L21 21 L15 17.5 L9 21 Z" fill="#fff"/></svg>';
    rideMarker = new mapboxgl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' });
  }
  rideMarker.setLngLat(pos).addTo(map);
  const h = headingNow();
  if (h != null) rideMarker.setRotation(h);
}

function ensureRideLayer() {
  if (!mapReady || map.getSource('ride')) return;
  map.addSource('ride', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'ride-line', type: 'line', source: 'ride',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#2a7de1', 'line-width': 4, 'line-opacity': 0.85 }
  });
}
function drawRideLine(force) {
  if (!mapReady || !ride) return;
  ensureRideLayer();
  if (!force && Date.now() - lastLineDraw < 3000) return;
  lastLineDraw = Date.now();
  const coords = ride.track.map(p => [p[2], p[1]]);
  if (ride.last) coords.push(ride.last);
  map.getSource('ride').setData({
    type: 'FeatureCollection',
    features: coords.length >= 2 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] : []
  });
}

// ---------- 地図の追いかけと3D ----------
function camOffset(ratio) {
  // パネルに隠れていない部分の、上から ratio の位置に現在地が来るようにする
  const ph = innerWidth >= 760 ? 0 : $('#panel').offsetHeight;
  const visible = innerHeight - ph;
  return [innerWidth >= 760 ? 200 : 0, Math.round(visible * ratio - innerHeight / 2)];
}
function moveCamera(pos) {
  if (!follow || !ride) return;
  const hn = headingNow();
  const brg = hn != null ? hn : map.getBearing();
  if (viewMode === '3d') {
    map.easeTo({ center: pos, bearing: brg, pitch: 60, offset: camOffset(0.72), duration: 900 });
  } else if (viewMode === 'heading') {
    map.easeTo({ center: pos, bearing: brg, pitch: 0, offset: camOffset(0.62), duration: 900 });
  } else {
    map.easeTo({ center: pos, bearing: 0, pitch: 0, offset: camOffset(0.5), duration: 900 });
  }
}
function rideRecenter() {
  follow = true;
  updFollowBtn();
  if (ride && ride.pos) moveCamera(ride.pos);
}
function updFollowBtn() { $('#btnLocate').classList.toggle('on', follow && riding); }

function apply3d(first) {
  if (!mapReady) return;
  try {
    if (viewMode === '3d' && !map.getLayer('bld3d') && map.getSource('composite')) {
      map.addLayer({
        id: 'bld3d', type: 'fill-extrusion', source: 'composite', 'source-layer': 'building', minzoom: 15,
        filter: ['==', ['get', 'extrude'], 'true'],
        paint: {
          'fill-extrusion-color': '#d6d6d6',
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': ['get', 'min_height'],
          'fill-extrusion-opacity': 0.6
        }
      }, 'route-casing');
    }
    if (map.getLayer('bld3d')) map.setLayoutProperty('bld3d', 'visibility', viewMode === '3d' ? 'visible' : 'none');
  } catch (e) { /* 建物が出せなくても走行は続ける */ }
  const z = Math.max(map.getZoom(), viewMode === '3d' ? 16.5 : 15.5);
  const hn = headingNow();
  if (first || !ride || !ride.pos) {
    map.easeTo({ pitch: viewMode === '3d' ? 60 : 0, bearing: viewMode !== 'north' && hn != null ? hn : 0, zoom: z, duration: 600 });
  } else {
    map.easeTo({ zoom: z, duration: 300 });
    moveCamera(ride.pos);
  }
}
function upd3dBtn() {
  $('#btn3d').textContent = VIEW_LABEL[viewMode];
  $('#btn3d').classList.toggle('on', viewMode !== 'north');
}
function updVoiceBtn() {
  $('#btnVoice').textContent = voiceOn ? '🔊' : '🔇';
}

$('#btn3d').addEventListener('click', () => {
  enableCompass();
  viewMode = VIEWS[(VIEWS.indexOf(viewMode) + 1) % VIEWS.length];
  saveRidePrefs();
  speak({ north: '北が上', heading: '進行方向が上', '3d': '3D表示' }[viewMode]);
  upd3dBtn();
  follow = true;
  updFollowBtn();
  apply3d(false);
});
$('#btnVoice').addEventListener('click', () => {
  voiceOn = !voiceOn;
  saveRidePrefs();
  updVoiceBtn();
  if (voiceOn) speak('音声案内をオンにしました');
  else if ('speechSynthesis' in window) speechSynthesis.cancel();
});
map.on('dragstart', e => {
  if (riding && e && e.originalEvent) { follow = false; updFollowBtn(); }
});

// ---------- 一時停止・終了 ----------
function togglePause() {
  if (!ride) return;
  ride.paused = !ride.paused;
  if (ride.paused) { ride.segBreak = true; speak('一時停止しました'); }
  else { ride.last = null; ride.slowSince = null; speak('記録を再開します'); }
  renderHud();
  persist();
}
$('#btnPause').addEventListener('click', togglePause);
$('#btnPauseS').addEventListener('click', togglePause);
$('#btnFinish').addEventListener('click', () => finishRide(true));
$('#btnFinishS').addEventListener('click', () => finishRide(true));

function stopHardware() {
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  clearInterval(rideTimer);
  rideTimer = null;
  if (wakeLock) { try { wakeLock.release(); } catch (e) { /* 無視 */ } wakeLock = null; }
}

function toRecord(r, endT) {
  return {
    id: r.start, start: r.start, end: endT,
    dist: r.dist, movingMs: r.movingMs, elapsedMs: endT - r.start,
    maxSpd: r.maxSpd, up: r.up, down: r.down,
    bike: r.bike, routeName: r.routeName, track: r.track
  };
}

function finishRide(ask) {
  if (!ride) return;
  if (ask) { openModal('#finishModal'); return; }
  endRide(true);
}
$('#fSave').addEventListener('click', () => { closeModals(); endRide(true); });
$('#fDiscard').addEventListener('click', () => { closeModals(); endRide(false); });

async function endRide(save) {
  if (!ride) return;
  stopHardware();
  const rec = toRecord(ride, Date.now());
  ride = null;
  riding = false;
  try { localStorage.removeItem(RIDE_KEY); } catch (e) { /* 無視 */ }
  document.body.classList.remove('riding');
  if (rideMarker) rideMarker.remove();
  updFollowBtn();
  if (mapReady && map.getSource('ride')) map.getSource('ride').setData({ type: 'FeatureCollection', features: [] });
  if (map.getLayer && map.getLayer('bld3d')) { try { map.setLayoutProperty('bld3d', 'visibility', 'none'); } catch (e) { /* 無視 */ } }
  map.easeTo({ pitch: 0, bearing: 0, duration: 500 });
  updateMarkers();
  setMode(state.route ? 'result' : 'edit');
  if (!save) { speak('記録を保存せずに終了しました'); msg('記録を保存せずに終了しました'); return; }
  await saveAndReport(rec, true);
}

async function saveAndReport(rec, talk) {
  if (rec.dist < 50) { msg('走った距離が短いため、記録は保存しませんでした'); return; }
  try {
    await putRide(rec);
    refreshLearned();
    const all = await allRides();
    const total = all.reduce((s, x) => s + (x.dist || 0), 0);
    const ev = typeof journeyEvents === 'function' ? journeyEvents((total - rec.dist) / 1000, total / 1000) : [];
    showDone(rec, all.length, total, ev);
    if (talk) {
      speak(`記録を保存しました。${(rec.dist / 1000).toFixed(1)}キロ、走行時間${Math.round(rec.movingMs / 60000)}分でした`);
      // 旅の知らせ（多いときは最後の3つ）
      ev.slice(-3).forEach(x => speak(x.text.replace('🎉 ', '').replace('：', '、')));
    }
    if (typeof afterSavePlay === 'function') afterSavePlay(rec, all); // マス・バッジ・峠の知らせ
  } catch (e) {
    msg('記録の保存に失敗しました：' + (e && e.message ? e.message : e), true);
  }
}

function showDone(rec, count, total, ev) {
  const avg = rec.movingMs > 0 ? rec.dist / 1000 / (rec.movingMs / 3600000) : 0;
  const row = (k, v) => `<div><span class="label">${k}</span><span>${v}</span></div>`;
  $('#doneBody').innerHTML =
    (rec.routeName ? `<p class="hint">${esc(rec.routeName)}</p>` : '') +
    '<div class="stats">' +
    row('距離', (rec.dist / 1000).toFixed(2) + ' km') +
    row('走行時間', fmtHMS(rec.movingMs)) +
    row('平均速度', avg.toFixed(1) + ' km/h') +
    row('最高速度', rec.maxSpd.toFixed(1) + ' km/h') +
    row('登り', Math.round(rec.up) + ' m') +
    row('経過時間（止まっていた時間も含む）', fmtHMS(rec.elapsedMs)) +
    '</div>' +
    `<p class="total">これまでの記録 ${count}件・総走行距離 <b>${(total / 1000).toFixed(1)} km</b></p>` +
    (ev && ev.length
      ? '<div class="jr-ev"><div class="glabel">バーチャル長距離の旅</div>' +
        (ev.length > 6 ? `<div>ほか${ev.length - 6}件…</div>` : '') +
        ev.slice(-6).map(x => `<div class="${x.type === 'done' ? 'big' : ''}">${esc(x.text)}</div>`).join('') +
        '<button id="btnDoneJourney" class="wide-btn">旅の地図を見る</button></div>'
      : '');
  const bj = document.getElementById('btnDoneJourney');
  if (bj) bj.addEventListener('click', () => { closeModals(); openJourney(); });
  openModal('#doneModal');
}

// ---------- 記録の保存場所（IndexedDB） ----------
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('chari', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('rides')) req.result.createObjectStore('rides', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function putRide(rec) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('rides', 'readwrite');
    tx.objectStore('rides').put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function allRides() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('rides', 'readonly').objectStore('rides').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// ---------- 途中で閉じたときの備え ----------
function persist() {
  if (!ride) return;
  ride.savedAt = Date.now();
  try { localStorage.setItem(RIDE_KEY, JSON.stringify(ride)); } catch (e) { /* 容量不足などは無視 */ }
}
document.addEventListener('visibilitychange', () => {
  if (!ride) return;
  if (document.hidden) persist();
  else { requestWake(); startWatch(); }
});
window.addEventListener('pagehide', persist);

async function checkResume() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(RIDE_KEY) || 'null'); } catch (e) { /* 無視 */ }
  if (!saved || !saved.start) return;
  const age = Date.now() - (saved.savedAt || saved.start);
  const finishSaved = async () => {
    try { localStorage.removeItem(RIDE_KEY); } catch (e) { /* 無視 */ }
    await saveAndReport(toRecord(saved, saved.savedAt || Date.now()), false);
  };
  if (age > RESUME_MIN * 60000) { await finishSaved(); return; }
  if (!confirm(`走行中の記録があります（${(saved.dist / 1000).toFixed(1)}km）。続きから記録しますか？\n「キャンセル」を押すと、そこまでの記録を保存して終わります。`)) {
    await finishSaved();
    return;
  }
  ride = saved;
  ride.slowSince = null;
  if (ride.withRoute && ride.points) {
    state.points = ride.points;
    if (BIKES[ride.bike]) state.bike = ride.bike;
    renderPoints();
    renderCond();
    updateMarkers();
    await searchRoute();
    if (!state.route) ride.withRoute = false;
  }
  beginRide();
}

// ---------- ボタン ----------
$('#btnRide').addEventListener('click', () => startRide(true));
$('#btnFreeRide').addEventListener('click', () => startRide(false));

// 地図の準備ができたら、途中の記録がないか確かめる
if (mapReady) checkResume(); else map.on('load', () => setTimeout(checkResume, 0));
refreshLearned();
