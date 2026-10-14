'use strict';
/* ChariMiru 版8：バーチャル長距離の旅
   ・これまでの全記録の合計距離で、短いコースから順に進む（1つ制覇すると次が開く）
   ・地図を地球儀にして、制覇したコース・今のコースの進み具合・いまいる場所を表示
   ・保存したときに、地点への到着やコースの制覇を知らせる（ride.js から journeyEvents を呼ぶ）
   距離は代表的な地点を大円（地球上の最短の線）で結び、全体の長さを公称の距離に合わせたもの */

const COURSES = [
  {
    id: 'tokaido', name: '東海道五十三次', sub: '日本橋 → 京都・三条大橋', km: 495.4, zoom: 5.6,
    stops: [
      ['日本橋', 35.6840, 139.7745], ['品川宿', 35.6170, 139.7400], ['神奈川宿', 35.4720, 139.6290],
      ['戸塚宿', 35.3960, 139.5330], ['小田原宿', 35.2500, 139.1560], ['箱根宿', 35.1910, 139.0260],
      ['三島宿', 35.1190, 138.9180], ['府中宿', 34.9760, 138.3830], ['島田宿', 34.8340, 138.1770],
      ['掛川宿', 34.7690, 138.0140], ['浜松宿', 34.7080, 137.7300], ['吉田宿', 34.7680, 137.3920],
      ['岡崎宿', 34.9550, 137.1650], ['宮宿', 35.1260, 136.9080], ['桑名宿', 35.0680, 136.6990],
      ['四日市宿', 34.9650, 136.6240], ['亀山宿', 34.8560, 136.4520], ['関宿', 34.8510, 136.3930],
      ['土山宿', 34.9380, 136.2730], ['草津宿', 35.0170, 135.9600], ['大津宿', 35.0050, 135.8650],
      ['三条大橋', 35.0090, 135.7720]
    ]
  },
  {
    id: 'route66', name: 'ルート66', sub: 'シカゴ → サンタモニカ', km: 3940, zoom: 3.2,
    stops: [
      ['シカゴ', 41.8789, -87.6359], ['セントルイス', 38.6270, -90.1994], ['スプリングフィールド', 37.2090, -93.2923],
      ['タルサ', 36.1540, -95.9928], ['オクラホマシティ', 35.4676, -97.5164], ['アマリロ', 35.2220, -101.8313],
      ['アルバカーキ', 35.0844, -106.6504], ['フラッグスタッフ', 35.1983, -111.6513], ['キングマン', 35.1894, -114.0530],
      ['バーストー', 34.8958, -117.0173], ['サンバーナーディーノ', 34.1083, -117.2898], ['サンタモニカ', 34.0094, -118.4973]
    ]
  },
  {
    id: 'silkroad', name: 'シルクロード', sub: '西安 → イスタンブール', km: 7000, zoom: 2.4,
    stops: [
      ['西安', 34.3416, 108.9398], ['蘭州', 36.0611, 103.8343], ['敦煌', 40.1421, 94.6620],
      ['トルファン', 42.9513, 89.1895], ['カシュガル', 39.4704, 75.9898], ['サマルカンド', 39.6542, 66.9597],
      ['ブハラ', 39.7681, 64.4556], ['メルブ', 37.6620, 62.1900], ['テヘラン', 35.6892, 51.3890],
      ['タブリーズ', 38.0800, 46.2919], ['エルズルム', 39.9043, 41.2679], ['アンカラ', 39.9334, 32.8597],
      ['イスタンブール', 41.0082, 28.9784]
    ]
  },
  {
    id: 'siberia', name: 'シベリア鉄道', sub: 'モスクワ → ウラジオストク', km: 9289, zoom: 2.2,
    stops: [
      ['モスクワ', 55.7760, 37.6550], ['ヤロスラヴリ', 57.6260, 39.8940], ['キーロフ', 58.6040, 49.6680],
      ['ペルミ', 58.0100, 56.2290], ['エカテリンブルク', 56.8380, 60.5970], ['チュメニ', 57.1530, 65.5340],
      ['オムスク', 54.9890, 73.3680], ['ノボシビルスク', 55.0300, 82.9200], ['クラスノヤルスク', 56.0100, 92.8520],
      ['イルクーツク（バイカル湖）', 52.2870, 104.3050], ['ウラン・ウデ', 51.8340, 107.5840], ['チタ', 52.0340, 113.4990],
      ['スコボロジノ', 53.9870, 123.9430], ['ベロゴルスク', 50.9210, 128.4740], ['ハバロフスク', 48.4800, 135.0720],
      ['ウラジオストク', 43.1150, 131.8860]
    ]
  },
  {
    id: 'japan', name: '日本一周', sub: '東京から時計回り', km: 10000, zoom: 3.8,
    stops: [
      ['東京', 35.6812, 139.7671], ['水戸', 36.3660, 140.4710], ['仙台', 38.2680, 140.8690], ['宮古', 39.6410, 141.9570],
      ['青森', 40.8220, 140.7470], ['函館', 41.7690, 140.7290], ['襟裳岬', 41.9250, 143.2490], ['釧路', 42.9850, 144.3810],
      ['網走', 44.0200, 144.2730], ['宗谷岬', 45.5230, 141.9370], ['札幌', 43.0620, 141.3540], ['函館（戻り）', 41.7690, 140.7290],
      ['秋田', 39.7200, 140.1030], ['新潟', 37.9160, 139.0360], ['金沢', 36.5610, 136.6560], ['鳥取', 35.5010, 134.2350],
      ['松江', 35.4680, 133.0490], ['下関', 33.9580, 130.9410], ['長崎', 32.7500, 129.8780], ['鹿児島', 31.5960, 130.5570],
      ['佐多岬', 30.9940, 130.6610], ['宮崎', 31.9080, 131.4200], ['大分', 33.2380, 131.6130], ['松山', 33.8390, 132.7660],
      ['足摺岬', 32.7250, 133.0190], ['高知', 33.5590, 133.5310], ['室戸岬', 33.2440, 134.1770], ['徳島', 34.0700, 134.5540],
      ['和歌山', 34.2260, 135.1670], ['潮岬', 33.4370, 135.7620], ['伊勢', 34.4870, 136.7090], ['名古屋', 35.1810, 136.9060],
      ['浜松', 34.7110, 137.7260], ['静岡', 34.9760, 138.3830], ['東京（ゴール）', 35.6812, 139.7671]
    ]
  },
  {
    id: 'earth', name: '地球一周', sub: '東京から東回りで東京へ', km: 40075, zoom: 1.1,
    stops: [
      ['東京', 35.6812, 139.7671], ['ホノルル', 21.3069, -157.8583], ['サンフランシスコ', 37.7749, -122.4194],
      ['ニューヨーク', 40.7128, -74.0060], ['ロンドン', 51.5074, -0.1278], ['パリ', 48.8566, 2.3522],
      ['ローマ', 41.9028, 12.4964], ['イスタンブール', 41.0082, 28.9784], ['ドバイ', 25.2048, 55.2708],
      ['デリー', 28.6139, 77.2090], ['バンコク', 13.7563, 100.5018], ['シンガポール', 1.3521, 103.8198],
      ['上海', 31.2304, 121.4737], ['東京（ゴール）', 35.6812, 139.7671]
    ]
  },
  { id: 'moon', name: '月まで', sub: '地球 → 月（宇宙への旅）', km: 384400, zoom: 0.8, moon: true }
];

// ---------- コースの下ごしらえ ----------
function gcInterp(a, b, f) {
  // 大円（球面上の最短経路）に沿って a から b へ f の割合だけ進んだ点。a, b は [経度, 緯度]
  const r = Math.PI / 180;
  const la1 = a[1] * r, lo1 = a[0] * r, la2 = b[1] * r, lo2 = b[0] * r;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2));
  if (d < 1e-9) return [a[0], a[1]];
  const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
  const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
  const z = A * Math.sin(la1) + B * Math.sin(la2);
  return [Math.atan2(y, x) / r, Math.atan2(z, Math.sqrt(x * x + y * y)) / r];
}

(function prepareCourses() {
  let offset = 0;
  COURSES.forEach(c => {
    c.offset = offset;
    c.end = offset + c.km;
    offset = c.end;
    if (c.moon) return;
    const st = c.stops.map(s => [s[2], s[1]]);
    const raw = [0];
    for (let i = 1; i < st.length; i++) raw[i] = raw[i - 1] + haversine(st[i - 1], st[i]) / 1000;
    const scale = c.km / raw[raw.length - 1];
    c.stopKm = raw.map(v => v * scale);
    // 50kmごとに点を足して、地球儀の上でなめらかな線にする
    const pts = [];
    for (let i = 0; i < st.length - 1; i++) {
      const segKm = c.stopKm[i + 1] - c.stopKm[i];
      const n = Math.max(1, Math.ceil((raw[i + 1] - raw[i]) / 50));
      for (let k = 0; k < n; k++) {
        const f = k / n;
        const p = gcInterp(st[i], st[i + 1], f);
        pts.push({ lng: p[0], lat: p[1], km: c.stopKm[i] + segKm * f });
      }
    }
    pts.push({ lng: st[st.length - 1][0], lat: st[st.length - 1][1], km: c.km });
    // 日付変更線をまたいでも線が反対側へ飛ばないよう、経度をつなげる
    for (let i = 1; i < pts.length; i++) {
      while (pts[i].lng - pts[i - 1].lng > 180) pts[i].lng -= 360;
      while (pts[i].lng - pts[i - 1].lng < -180) pts[i].lng += 360;
    }
    c.pts = pts;
  });
})();

function posInCourse(c, km) {
  const P = c.pts;
  if (km <= 0) return [P[0].lng, P[0].lat];
  for (let i = 1; i < P.length; i++) {
    if (P[i].km >= km) {
      const f = (km - P[i - 1].km) / Math.max(1e-9, P[i].km - P[i - 1].km);
      return [P[i - 1].lng + (P[i].lng - P[i - 1].lng) * f, P[i - 1].lat + (P[i].lat - P[i - 1].lat) * f];
    }
  }
  return [P[P.length - 1].lng, P[P.length - 1].lat];
}

// ---------- 記録から、旅の状態を出す ----------
function computeJourney(rides) {
  const rs = rides.slice().sort((a, b) => a.start - b.start);
  const totalKm = rs.reduce((s, r) => s + (r.dist || 0), 0) / 1000;
  const done = {};
  let acc = 0, ci = 0;
  for (const r of rs) {
    acc += (r.dist || 0) / 1000;
    while (ci < COURSES.length && acc >= COURSES[ci].end) { done[COURSES[ci].id] = r.end || r.start; ci++; }
  }
  const cur = COURSES.findIndex(c => totalKm < c.end);
  return { totalKm, done, cur, inKm: cur >= 0 ? totalKm - COURSES[cur].offset : null };
}

// 合計距離が a km から b km に増えたときに起きたこと（地点への到着、コースの制覇）
function journeyEvents(a, b) {
  const ev = [];
  COURSES.forEach((c, ci) => {
    if (b <= c.offset || a >= c.end) return;
    if (!c.moon) {
      c.stopKm.forEach((k, i) => {
        if (i === 0 || i === c.stopKm.length - 1) return;
        const abs = c.offset + k;
        if (a < abs && b >= abs) ev.push({ type: 'stop', text: `${c.name}：${c.stops[i][0]}に到着` });
      });
    } else {
      // 月までは1万kmごと
      for (let m = Math.floor((a - c.offset) / 10000) + 1; c.offset + m * 10000 <= b && m * 10000 < c.km; m++) {
        ev.push({ type: 'stop', text: `月まで：${(m * 10000).toLocaleString()}km地点を通過` });
      }
    }
    if (a < c.end && b >= c.end) {
      const next = COURSES[ci + 1];
      ev.push({ type: 'done', text: `🎉 ${c.name}を制覇しました！` + (next ? `次は「${next.name}」` : 'すべての旅を制覇しました！') });
    }
  });
  return ev;
}

// ---------- 旅の画面（地球儀） ----------
let J = null, savedView = null, jrMarker = null;

async function openJourney() {
  if (riding) return;
  let rides = [];
  try { rides = await allRides(); } catch (e) { msg('記録を読み込めませんでした', true); return; }
  J = computeJourney(rides);
  savedView = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: 0 };
  closeModals();
  document.body.classList.add('journey');
  $('#journeyPanel').hidden = false;
  try { map.setProjection('globe'); } catch (e) { /* 地球儀が使えない場合は平面の地図のまま */ }
  drawJourney();
  renderJourneyPanel();
  focusCourse(J.cur >= 0 ? J.cur : COURSES.length - 1);
}

function closeJourney() {
  document.body.classList.remove('journey');
  $('#journeyPanel').hidden = true;
  if (jrMarker) jrMarker.remove();
  if (mapReady && map.getSource('jr')) {
    map.getSource('jr').setData({ type: 'FeatureCollection', features: [] });
    map.getSource('jrStops').setData({ type: 'FeatureCollection', features: [] });
  }
  try { map.setProjection('mercator'); } catch (e) { /* 無視 */ }
  if (savedView) map.jumpTo(savedView);
}

function ensureJourneyLayers() {
  if (map.getSource('jr')) return;
  map.addSource('jr', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('jrStops', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'jr-rest', type: 'line', source: 'jr', filter: ['==', ['get', 'k'], 'rest'],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#8a8f8c', 'line-width': 2.5, 'line-dasharray': [1.5, 1.5] }
  });
  map.addLayer({
    id: 'jr-done', type: 'line', source: 'jr', filter: ['==', ['get', 'k'], 'done'],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#e07b2e', 'line-width': 4 }
  });
  map.addLayer({
    id: 'jr-stop', type: 'circle', source: 'jrStops',
    paint: {
      'circle-radius': 4, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#ffffff',
      'circle-color': ['case', ['get', 'reached'], '#e07b2e', '#8a8f8c']
    }
  });
  map.addLayer({
    id: 'jr-label', type: 'symbol', source: 'jrStops',
    layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
    paint: { 'text-color': '#333333', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 }
  });
}

function drawJourney() {
  if (!mapReady) return;
  ensureJourneyLayers();
  const lines = [], stops = [];
  COURSES.forEach((c, i) => {
    if (c.moon || J.cur >= 0 && i > J.cur) return; // まだ開いていないコースは出さない
    const isCur = i === J.cur;
    const upto = isCur ? J.inKm : c.km;
    const doneC = c.pts.filter(p => p.km <= upto).map(p => [p.lng, p.lat]);
    const here = posInCourse(c, upto);
    if (isCur) {
      if (doneC.length) lines.push({ type: 'Feature', properties: { k: 'done' }, geometry: { type: 'LineString', coordinates: [...doneC, here] } });
      const rest = [here, ...c.pts.filter(p => p.km > upto).map(p => [p.lng, p.lat])];
      lines.push({ type: 'Feature', properties: { k: 'rest' }, geometry: { type: 'LineString', coordinates: rest } });
    } else {
      lines.push({ type: 'Feature', properties: { k: 'done' }, geometry: { type: 'LineString', coordinates: c.pts.map(p => [p.lng, p.lat]) } });
    }
    c.stops.forEach((s, k) => {
      // 同じ緯度経度に揃えた位置に置く（線とずれないように）
      const p = posInCourse(c, c.stopKm[k]);
      stops.push({ type: 'Feature', properties: { name: s[0], reached: c.stopKm[k] <= upto }, geometry: { type: 'Point', coordinates: p } });
    });
  });
  map.getSource('jr').setData({ type: 'FeatureCollection', features: lines });
  map.getSource('jrStops').setData({ type: 'FeatureCollection', features: stops });

  if (!jrMarker) {
    const el = document.createElement('div');
    el.className = 'jr-me';
    el.textContent = '🚲';
    jrMarker = new mapboxgl.Marker({ element: el });
  }
  const c = J.cur >= 0 ? COURSES[J.cur] : null;
  if (c && !c.moon) jrMarker.setLngLat(posInCourse(c, J.inKm)).addTo(map);
  else jrMarker.remove();
}

function focusCourse(i) {
  const c = COURSES[i];
  if (!c) return;
  if (c.moon) { map.flyTo({ center: [139.7, 35.7], zoom: c.zoom, pitch: 0, bearing: 0, duration: 1500 }); return; }
  const center = i === J.cur ? posInCourse(c, J.inKm) : posInCourse(c, c.km / 2);
  map.flyTo({ center, zoom: c.zoom, pitch: 0, bearing: 0, duration: 1500 });
}

function renderJourneyPanel() {
  const fmtKm = v => Math.round(v).toLocaleString() + 'km';
  $('#jpTotal').textContent = `これまでの合計 ${J.totalKm.toFixed(1)}km`;
  if (J.cur < 0) {
    $('#jpNow').innerHTML = '<b>🏆 すべての旅を制覇しました！</b>';
    $('#jpBarFill').style.width = '100%';
    $('#jpNext').textContent = '';
  } else {
    const c = COURSES[J.cur];
    const pct = J.inKm / c.km * 100;
    $('#jpNow').innerHTML = `<b>${esc(c.name)}</b>　${pct.toFixed(1)}%　<small>${esc(c.sub)}</small>`;
    $('#jpBarFill').style.width = Math.min(100, pct) + '%';
    if (c.moon) {
      $('#jpNext').textContent = `月まで あと ${fmtKm(c.km - J.inKm)}`;
    } else {
      const k = c.stopKm.findIndex(v => v > J.inKm);
      $('#jpNext').textContent = k > 0 ? `次は ${c.stops[k][0]}：あと ${(c.stopKm[k] - J.inKm).toFixed(1)}km　／　ゴールまで ${fmtKm(c.km - J.inKm)}` : '';
    }
  }
  $('#jpList').innerHTML = COURSES.map((c, i) => {
    let cls, st;
    if (J.done[c.id]) { cls = 'done'; st = `✓ 制覇 ${fmtDate(J.done[c.id]).replace(/（.）.*/, '')}`; }
    else if (i === J.cur) { cls = 'cur'; st = `進行中 ${(J.inKm / c.km * 100).toFixed(1)}%`; }
    else { cls = 'lock'; st = '🔒 まだ開いていません'; }
    return `<li data-i="${i}" class="${cls}"><div class="jl-top"><b>${i + 1}. ${esc(c.name)}</b><span>${fmtKm(c.km)}</span></div>` +
      `<div class="jl-sub">${cls === 'lock' ? '前のコースを制覇すると開きます' : esc(c.sub)}・${st}</div></li>`;
  }).join('');
}

$('#jpList').addEventListener('click', e => {
  const li = e.target.closest('li[data-i]');
  if (!li || li.classList.contains('lock')) return;
  focusCourse(Number(li.dataset.i));
});
$('#btnJourney').addEventListener('click', openJourney);
$('#btnJourneyClose').addEventListener('click', closeJourney);
