'use strict';
/* ChariMiru 版19：走り終わりのまとめカード（MichiMiru の「散歩のまとめ」と同じ考え方）
   ・走り終わって保存したら、地図の上に1枚のカード。地図は今回走った線全体に寄せる
   ・距離・走行時間・平均速度を大きく。成果（新しいマス・峠・バッジ・旅のいま・カロリー）
   ・同じ日に2回以上走ったら今日の合計。最後に一言（自己ベスト・次のバッジ・今月の距離）
   ・履歴の「まとめ」からも、その記録の時点の数で見られる
   hikae.js の後に読み込む                                                              */

// ---------- カロリー ----------
// 平均速度ごとの運動の強さ（METs）。運動の強さの一覧（Compendium of Physical Activities）の自転車の目安
const METS = [[16, 4.0], [19, 6.8], [22, 8.0], [25.5, 10.0], [30, 12.0], [Infinity, 15.8]];
const WEIGHT_DEF = 60;
function rideKcal(rec) {
  const h = (rec.movingMs || 0) / 3600000;
  if (h <= 0 || !rec.dist) return null;
  const kmh = rec.dist / 1000 / h;
  let mets = METS.find(m => kmh < m[0])[1];
  if (rec.bike === 'ebike') mets = Math.max(2.5, mets * 0.6); // 電動アシストは少なめ
  const w = state.weight || WEIGHT_DEF;
  // 安静にしていても使う分（1 METs）は引いた「正味」の量
  return { kcal: Math.round((mets - 1) * w * h), assumed: !state.weight };
}
// 食べ物の例え（日替わり）。k はおおよそのカロリー
const FOODS = [
  { n: 'おにぎり', k: 180, u: '個' }, { n: 'あんパン', k: 280, u: '個' }, { n: 'どら焼き', k: 220, u: '個' },
  { n: '肉まん', k: 250, u: '個' }, { n: 'みたらし団子', k: 120, u: '本' }, { n: 'ソフトクリーム', k: 190, u: '個' },
  { n: 'ショートケーキ', k: 320, u: '切れ' }, { n: '大福', k: 240, u: '個' }, { n: 'ラーメン', k: 500, u: '杯' },
  { n: 'カツ丼', k: 900, u: '杯' }, { n: 'ポテトチップス', k: 330, u: '袋' }, { n: 'バナナ', k: 86, u: '本' }
];
const BANANA = FOODS[FOODS.length - 1];
function foodText(kcal, t) {
  const d = new Date(t);
  const seed = d.getFullYear() * 400 + d.getMonth() * 31 + d.getDate();
  let f = FOODS[seed % FOODS.length];
  if (kcal / f.k < 0.75) f = BANANA; // 少ないときは小さいもので
  const c = Math.round(kcal / f.k * 2) / 2;
  if (c < 0.5) return '';
  return c === 0.5 ? `${f.n}半分ぶん` : `${f.n}${c % 1 ? c.toFixed(1) : c}${f.u}分`;
}

// ---------- 旅のいま ----------
function journeyNowText(J) {
  if (J.cur < 0) return '🏆 すべての旅を制覇しています';
  const c = COURSES[J.cur];
  const pct = (J.inKm / c.km * 100).toFixed(1);
  if (c.moon) return `${c.name}：あと ${Math.round(c.km - J.inKm).toLocaleString()}km（${pct}%）`;
  const k = c.stopKm.findIndex(v => v > J.inKm);
  if (k <= 0) return `${c.name}（${pct}%）`;
  const passed = k === 1 ? `${c.stops[0][0]}を出発して` : `${c.stops[k - 1][0]}を過ぎて`;
  return `${c.name}：${passed}、次の${c.stops[k][0]}まであと${(c.stopKm[k] - J.inKm).toFixed(1)}km（${pct}%）`;
}

// ---------- 一言 ----------
function avgKmh(r) { return r.movingMs > 0 ? r.dist / 1000 / (r.movingMs / 3600000) : 0; }
function sumNudge(rec, before, upto, sA) {
  if (!before.length) return 'はじめての記録です！ ここから距離を積み上げていきましょう';
  const km = v => (v / 1000).toFixed(1);
  const maxD = Math.max(...before.map(r => r.dist || 0));
  if (rec.dist > maxD && before.length >= 1) return `これまででいちばん長い距離です（これまでは${km(maxD)}km）`;
  const maxUp = Math.max(...before.map(r => r.up || 0));
  if ((rec.up || 0) >= 50 && rec.up > maxUp) return `これまででいちばん登りました（これまでは${Math.round(maxUp)}m）`;
  const fair = r => r.movingMs >= 600000 && r.dist >= 3000 && (r.bike || null) === (rec.bike || null);
  const sp = before.filter(fair);
  if (fair(rec) && sp.length >= 2) {
    const maxV = Math.max(...sp.map(avgKmh));
    if (avgKmh(rec) > maxV) return `同じ自転車で、これまででいちばん速い平均速度です（これまでは${maxV.toFixed(1)}km/h）`;
  }
  // 次のバッジがあと半分を切っていたら
  const next = BADGES.filter(b => !earned(b, sA))
    .map(b => ({ b, f: b.v(sA) / b.goal })).filter(x => x.f >= 0.5).sort((x, y) => y.f - x.f)[0];
  if (next) return `次のバッジ「${next.b.icon} ${next.b.name}」まで${fmtLeft(next.b, sA)}`;
  // 今月の距離と、先月の同じ日まで
  const d = new Date(rec.start);
  const m0 = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const p0 = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
  const pEnd = new Date(d.getFullYear(), d.getMonth() - 1, d.getDate(), 23, 59, 59).getTime();
  const mon = upto.filter(r => r.start >= m0).reduce((s, r) => s + r.dist, 0);
  const prevRides = upto.filter(r => r.start >= p0 && r.start < m0);
  if (!prevRides.length) return `今月はこれで${km(mon)}kmです`;
  const prev = prevRides.filter(r => r.start <= pEnd).reduce((s, r) => s + r.dist, 0);
  const diff = (mon - prev) / 1000;
  return `今月はこれで${km(mon)}km。先月の同じ日までより${diff >= 0 ? '＋' : '−'}${Math.abs(diff).toFixed(1)}km`;
}

// ---------- カードの中身 ----------
const SUM = { rec: null, live: false, passFail: false };
function sameDay(a, b) {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

function summaryHtml(rec, all) {
  const before = all.filter(r => r.start < rec.start && r.id !== rec.id);
  const upto = before.concat([rec]);
  const meshB = meshOfRides(before).size, meshA = meshOfRides(upto).size;
  const sB = playStats(before, meshB), sA = playStats(upto, meshA);
  const kmB = before.reduce((s, r) => s + (r.dist || 0), 0) / 1000;
  const kmA = kmB + rec.dist / 1000;
  const ev = journeyEvents(kmB, kmA);
  const J = computeJourney(upto);
  const avg = avgKmh(rec);
  const rows = [];
  const row = (ic, html, cls) => rows.push(`<div class="sm-row${cls ? ' ' + cls : ''}"><span class="sm-ic">${ic}</span><span>${html}</span></div>`);

  if (meshA > meshB) row('🟧', `新しいマスを <b>${meshA - meshB}個</b> 塗りました（合計${meshA}マス）`);
  if (rec.passChecked) {
    if (rec.passes && rec.passes.length) {
      const seen = new Set(passBook(before).map(p => p.id));
      row('🔖', '峠のスタンプ：' + rec.passes.map(p => `<b>${esc(p.name)}</b>${seen.has(p.id) ? '' : '（はじめて）'}`).join('・'));
    }
  } else if (SUM.live && SUM.rec && SUM.rec.id === rec.id) {
    if (SUM.passFail) row('🔖', '峠は通信できず調べられませんでした。あとで履歴の「峠」の「過去の記録も調べる」から調べられます', 'sm-muted');
    else row('🔖', '通った峠を調べています…', 'sm-muted');
  }
  BADGES.filter(b => earned(b, sA) && !earned(b, sB)).forEach(b => row('🏅', `バッジ獲得：<b>${b.icon} ${esc(b.name)}</b>`));
  // 旅：着いた地点・制覇を出してから、いまの場所
  const stops = ev.filter(x => x.type === 'stop'), dones = ev.filter(x => x.type === 'done');
  dones.forEach(x => row('🎉', `<b>${esc(x.text.replace('🎉 ', ''))}</b>`, 'sm-big-ev'));
  if (stops.length) row('📍', esc(stops.slice(-3).map(x => x.text).join('、')) + (stops.length > 3 ? `（ほか${stops.length - 3}か所）` : ''));
  row('🌏', esc(journeyNowText(J)));
  const kc = rideKcal(rec);
  if (kc && kc.kcal > 0) {
    const ft = foodText(kc.kcal, rec.start);
    row('🔥', `約 <b>${kc.kcal.toLocaleString()}kcal</b>${ft ? '＝' + esc(ft) : ''}` +
      (kc.assumed ? '<small>（体重60kgで計算。⚙で変えられます）</small>' : ''));
  }

  // 今日の合計（同じ日に2回以上）
  const today = upto.filter(r => sameDay(r.start, rec.start));
  let todayHtml = '';
  if (today.length >= 2) {
    const tD = today.reduce((s, r) => s + r.dist, 0), tM = today.reduce((s, r) => s + (r.movingMs || 0), 0);
    todayHtml = `<div class="sm-today">この日の合計：${today.length}回・<b>${(tD / 1000).toFixed(1)}km</b>・走行${fmtHMS(tM)}</div>`;
  }

  const small = [
    `最高 ${(rec.maxSpd || 0).toFixed(1)}km/h`,
    `登り ${Math.round(rec.up || 0)}m`,
    `経過 ${fmtHMS(rec.elapsedMs || 0)}`
  ];
  if (rec.avgHr) small.push(`心拍 ${rec.avgHr}／${rec.maxHr}bpm`);
  if (rec.avgCad) small.push(`ケイデンス ${rec.avgCad}rpm`);

  const hkHtml = SUM.live && typeof hkNeeded === 'function' && hkNeeded(upto)
    ? '<div class="sm-hk"><span>💾 しばらく控えをとっていません。控えをとっておくと、機種変更やブラウザの引っ越しのときも安心です</span><button id="sumHk">控えを書き出す</button></div>'
    : '';

  return '<div class="sm-head">' +
      `<div><div class="sm-title">${SUM.live ? 'おつかれさまでした' : '走行のまとめ'}</div>` +
      `<div class="sm-sub">${esc(rec.routeName || 'ルートなし')}・${fmtDate(rec.start)}</div></div>` +
      '<button id="sumX" title="閉じる">×</button></div>' +
    '<div class="sm-big">' +
      `<div><b>${(rec.dist / 1000).toFixed(2)}</b><small>km</small><span>距離</span></div>` +
      `<div><b>${fmtHMS(rec.movingMs)}</b><span>走行時間</span></div>` +
      `<div><b>${avg.toFixed(1)}</b><small>km/h</small><span>平均速度</span></div>` +
    '</div>' +
    `<div class="sm-small">${small.join('・')}</div>` +
    `<div class="sm-gains">${rows.join('')}</div>` +
    todayHtml +
    `<div class="sm-nudge">💬 ${esc(sumNudge(rec, before, upto, sA))}</div>` +
    hkHtml +
    `<p class="sm-total">これまでの記録 ${upto.length}件・総走行距離 <b>${kmA.toFixed(1)} km</b></p>` +
    '<div class="sm-btns">' +
      (ev.length ? '<button id="sumJourney" class="go-t">🌏 旅の地図を見る</button>' : '') +
      '<button id="sumClose">閉じる</button>' +
    '</div>';
}

let sumAll = [];
function renderSummary() {
  if (!SUM.rec) return;
  $('#sumCard').innerHTML = summaryHtml(SUM.rec, sumAll);
  $('#sumX').addEventListener('click', closeSummary);
  $('#sumClose').addEventListener('click', closeSummary);
  const bj = $('#sumJourney');
  if (bj) bj.addEventListener('click', () => { closeSummary(); openJourney(); });
  const bh = $('#sumHk');
  if (bh) bh.addEventListener('click', hkExport);
}

// 走り終わり（live）または履歴から開く
async function openSummary(rec, opts = {}) {
  if (riding) return;
  try { sumAll = await allRides(); } catch (e) { sumAll = [rec]; }
  if (!sumAll.some(r => r.id === rec.id)) sumAll.push(rec);
  SUM.rec = rec;
  SUM.live = !!opts.live;
  SUM.passFail = false;
  closeModals();
  renderSummary();
  $('#sumCard').hidden = false;
  $('#sumCard').scrollTop = 0;
  document.body.classList.add('summary');
  layoutChanged();
  // カードの大きさが決まってから、走った線に寄せる
  setTimeout(() => { if (SUM.rec === rec && typeof showTrack === 'function') showTrack(rec); }, 60);
}

// 峠を調べ終わったとき・控えを書き出したときに書き直す（ride.js・play.js・hikae.js から）
function sumRefresh(rec, opts = {}) {
  if (!SUM.rec || SUM.rec.id !== rec.id || $('#sumCard').hidden) return;
  SUM.rec = rec;
  sumAll = sumAll.map(r => (r.id === rec.id ? rec : r));
  if (opts.passFail) SUM.passFail = true;
  const st = $('#sumCard').scrollTop;
  renderSummary();
  $('#sumCard').scrollTop = st;
}
function sumHikaeDone() { if (SUM.rec && !$('#sumCard').hidden) sumRefresh(SUM.rec); }

function closeSummary() {
  if ($('#sumCard').hidden) return;
  $('#sumCard').hidden = true;
  document.body.classList.remove('summary');
  // 走り終わりのときは線も消す。履歴から開いたときは「地図で見る」と同じく線を残す
  if (SUM.live && typeof clearTrack === 'function') clearTrack();
  SUM.rec = null;
  layoutChanged();
}
