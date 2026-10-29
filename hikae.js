'use strict';
/* ChariMiru 版19：記録の控え（MichiMiru の「4つのアプリの控え」と同じ考え方）
   ・走った記録すべてと設定を、1つのファイル（JSON）に書き出す
   ・読み込むと、記録は今ある分に足し合わせ（同じ記録は2つにならない）、設定は控えのものに置き換える
   ・バッジ・マス・旅の進みは記録から計算し直すので、記録が戻れば元どおり
   ・最後に控えた日を覚えておき、30日以上たっていたら走り終わりのまとめで一言
   hist.js・play.js の後に読み込む                                                    */

const HK_LAST = 'chari_hikae_last';
// 控えに入れる設定（走行中の一時保存 chari_ride と、紹介を見たかどうか chari_help_v1 は入れない）
const HK_KEYS = ['chari_settings', 'chari_ride_prefs', 'chari_sensor', 'chari_panel_h'];
const HK_DAYS = 30;

function hkLast() {
  try { return Number(localStorage.getItem(HK_LAST)) || 0; } catch (e) { return 0; }
}
function hkDate(t) {
  const d = new Date(t);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// 控えをすすめる一言を出すか（前の控えから30日以上、その後に新しい記録がある）
// 控えたことがなければ、いちばん古い記録の日から数える
function hkNeeded(rides) {
  if (!rides || !rides.length) return false;
  const last = hkLast();
  const from = last || Math.min(...rides.map(r => r.start));
  if (Date.now() - from < HK_DAYS * 864e5) return false;
  return rides.some(r => r.start > last);
}

function hkStateText(n) {
  const last = hkLast();
  if (!last) return n ? 'まだ控えをとっていません' : '';
  const days = Math.floor((Date.now() - last) / 864e5);
  return `最後に控えたのは ${days === 0 ? '今日' : days + '日前'}（${hkDate(last)}）`;
}
function renderHikae() {
  const n = (typeof histList !== 'undefined' && histList) ? histList.length : 0;
  $('#hkState').textContent = hkStateText(n);
  $('#btnHkExp').disabled = !n;
}

async function hkExport() {
  let rides;
  try { rides = (await allRides()).sort((a, b) => a.start - b.start); } catch (e) {
    msg('記録を読み込めませんでした：' + (e && e.message ? e.message : e), true);
    return;
  }
  if (!rides.length) { msg('まだ記録がありません'); return; }
  const settings = {};
  HK_KEYS.forEach(k => {
    try { const v = localStorage.getItem(k); if (v != null) settings[k] = v; } catch (e) { /* 無視 */ }
  });
  const data = { app: 'ChariMiru', kind: 'hikae', format: 1, ver: CHARI_VER, t: Date.now(), settings, rides };
  const name = `charimiru-hikae-${stamp(Date.now()).slice(0, 8)}.json`;
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  try { localStorage.setItem(HK_LAST, String(Date.now())); } catch (e) { /* 無視 */ }
  renderHikae();
  if (typeof sumHikaeDone === 'function') sumHikaeDone();
  msg(`${name} を書き出しました（記録${rides.length}件と設定）`);
}

async function hkImport(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) {
    msg('このファイルは読み込めませんでした（ChariMiru の控えのファイルを選んでください）', true);
    return;
  }
  if (!data || data.app !== 'ChariMiru' || data.kind !== 'hikae' || !Array.isArray(data.rides)) {
    msg('ChariMiru の控えのファイルではないようです', true);
    return;
  }
  const rides = data.rides.filter(r => r && Number.isFinite(r.id) && Number.isFinite(r.start) && Array.isArray(r.track));
  let have;
  try { have = await allRides(); } catch (e) { msg('今の記録を読み込めませんでした', true); return; }
  const byId = new Map(have.map(r => [r.id, r]));
  const fresh = rides.filter(r => !byId.has(r.id));
  const hasSet = data.settings && Object.keys(data.settings).length > 0;
  const ok = confirm(
    `控え（${data.t ? hkDate(data.t) + ' 作成' : '作成日不明'}）を読み込みます。\n\n` +
    `記録 ${rides.length}件（うち、この端末にないもの ${fresh.length}件）\n` +
    '・今ある記録は消えません。同じ記録は2つになりません\n' +
    (hasSet ? '・設定（自転車の種類・好み・体重・音声・タイヤの周長など）は控えのものに置き換えます\n' : '') +
    '\nよろしいですか？');
  if (!ok) return;
  try {
    for (const r of fresh) await putRide(r);
    // 同じ記録でも、峠を調べた結果が控えにだけあるときは、それを足す
    for (const r of rides) {
      const cur = byId.get(r.id);
      if (cur && !cur.passChecked && r.passChecked) { cur.passes = r.passes; cur.passChecked = true; await putRide(cur); }
    }
  } catch (e) {
    msg('記録の取り込みに失敗しました：' + (e && e.message ? e.message : e), true);
    return;
  }
  if (hasSet) {
    HK_KEYS.forEach(k => {
      if (typeof data.settings[k] !== 'string') return;
      try { localStorage.setItem(k, data.settings[k]); } catch (e) { /* 無視 */ }
    });
  }
  // 控えを読み込んだ直後は、すぐに「控えをとって」とは言わない
  try { localStorage.setItem(HK_LAST, String(Math.max(hkLast(), data.t || 0))); } catch (e) { /* 無視 */ }
  const text = `控えを読み込みました：記録${fresh.length}件を足しました${hasSet ? '・設定を置き換えました' : ''}`;
  if (hasSet) {
    // 設定はあちこちのファイルが起動時に読むので、開き直して反映する
    try { sessionStorage.setItem('chari_after_import', text); } catch (e) { /* 無視 */ }
    location.reload();
    return;
  }
  histList = (await allRides()).sort((a, b) => b.start - a.start);
  renderHistory();
  refreshLearned();
  msg(text);
}

$('#btnHkExp').addEventListener('click', hkExport);
$('#hkFile').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (f) hkImport(f);
});

// 読み込みのあと開き直したときの知らせ
(function afterImport() {
  let t = null;
  try { t = sessionStorage.getItem('chari_after_import'); sessionStorage.removeItem('chari_after_import'); } catch (e) { /* 無視 */ }
  if (t) msg(t);
})();
