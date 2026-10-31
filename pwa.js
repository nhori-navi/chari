'use strict';
/* ChariMiru 版20：ホーム画面のアプリ（PWA）の仕上げ
   ① ホーム画面に置く案内（⚙ の設定のいちばん上・3回目に開いたときに1回だけパネルの上に一言）
   ② 記録の引っ越し：ホーム画面のアプリを初めて開いて記録が0件なら、控えを読み込む案内
   ③ 電波がないとき：画面は sw.js の控えで開く。地図とルート検索は使えないことを知らせる
   ④ 新しい版の知らせ：GitHub に新しい版が上がったら「開き直す」
   hikae.js・matome.js の後、help.js の前に読み込む                                    */

const PWA_KEY = 'chari_pwa';
let PW = { n: 0, barShown: false, moveOff: false };
try { PW = Object.assign(PW, JSON.parse(localStorage.getItem(PWA_KEY) || '{}')); } catch (e) { /* 初期値 */ }
function savePw() { try { localStorage.setItem(PWA_KEY, JSON.stringify(PW)); } catch (e) { /* 無視 */ } }
PW.n++;
savePw();

// ---------- どこで開いているか ----------
const UA = navigator.userAgent;
const isStandalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const isIOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(UA);
function browserKind() {
  if (isIOS) {
    if (/Bluefy/i.test(UA)) return 'ios-bluefy';
    if (/CriOS/.test(UA)) return 'ios-chrome';
    if (/FxiOS|EdgiOS|OPiOS|Line\//.test(UA)) return 'ios-other';
    return 'ios-safari';
  }
  if (isAndroid) return /Chrome/.test(UA) && !/SamsungBrowser|EdgA|Line\//.test(UA) ? 'android-chrome' : 'android-other';
  return 'pc';
}
const BK = browserKind();

// Android の Chrome は「インストール」をボタン1つで出せる
let installEv = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installEv = e;
  renderPwaBox();
});
window.addEventListener('appinstalled', () => { installEv = null; renderPwaBox(); msg('ホーム画面のアプリにしました'); });

// ---------- ① 設定のいちばん上の案内 ----------
const STEPS_HTML = {
  'ios-chrome': '<ol><li>アドレス欄の右にある<b>共有ボタン</b>（四角から上向きの矢印）を押します</li><li>出てきた一覧を下へ動かして<b>「ホーム画面に追加」</b>を押し、右上の<b>「追加」</b>を押します</li><li>ホーム画面にできた緑の自転車のアイコンから開きます</li></ol>',
  'ios-safari': '<ol><li>画面の下（または上）の<b>共有ボタン</b>（四角から上向きの矢印）を押します</li><li>出てきた一覧を下へ動かして<b>「ホーム画面に追加」</b>を押し、右上の<b>「追加」</b>を押します</li><li>ホーム画面にできた緑の自転車のアイコンから開きます</li></ol>',
  'ios-other': '<p>このブラウザからはホーム画面に置けないことがあります。<b>Safari か Chrome</b> でこのページを開き直してから、共有ボタン →「ホーム画面に追加」を押してください。</p>',
  'ios-bluefy': '<p>Bluefy はセンサー（Bluetooth）を使うためのブラウザです。ふだん使いのホーム画面のアプリは、<b>Safari か Chrome</b> で開いて、共有ボタン →「ホーム画面に追加」で置いてください（Bluefy とは記録の置き場所が別になります）。</p>',
  'android-chrome': '<ol><li>右上の<b>︙</b>（メニュー）を押します</li><li><b>「ホーム画面に追加」</b>か<b>「アプリをインストール」</b>を押します</li></ol>',
  'android-other': '<p>Chrome でこのページを開き、右上の︙ →「ホーム画面に追加」を押してください。</p>',
  'pc': '<p>パソコンの Chrome・Edge では、アドレス欄の右のインストールのしるしから、アプリとして置けます。スマホでは Safari・Chrome の「ホーム画面に追加」です。</p>'
};
let pwRides = 0;
async function renderPwaBox() {
  const box = $('#pwaBox');
  if (!box) return;
  if (isStandalone) { box.hidden = true; return; }
  try { pwRides = (await allRides()).length; } catch (e) { pwRides = 0; }
  box.hidden = false;
  const ios = BK.startsWith('ios');
  box.innerHTML =
    '<div class="glabel">📲 ホーム画面のアプリにする</div>' +
    '<p class="pw-why">ホーム画面に置くと、アドレス欄のない全画面で開けて、記録も消えにくくなります（iPhone の Safari のままだと、しばらく開かないと保存が消されることがあります）。</p>' +
    (installEv ? '<button id="pwInstall" class="primary wide-btn">📲 インストール（ホーム画面に置く）</button>' : (STEPS_HTML[BK] || STEPS_HTML.pc)) +
    (ios && pwRides
      ? '<div class="pw-move"><b>⚠ 先に記録の控えを</b><br>iPhone では、ホーム画面のアプリと、いま開いているブラウザとで記録の置き場所が別になります。置く前に <b>履歴 →「控えを書き出す」</b> でファイルを保存しておいてください。ホーム画面のアプリを初めて開くと、そのファイルを読み込む案内が出ます。' +
        `<button id="pwHk" class="wide-btn go-t">💾 いま控えを書き出す（記録${pwRides}件）</button></div>`
      : '') +
    (ios
      ? '<p class="hint">センサー（Bluetooth）は、ホーム画面のアプリでも使えません（iPhone の決まりで、今までどおり Bluefy で開いてください）。</p>'
      : '');
  const bi = $('#pwInstall');
  if (bi) bi.addEventListener('click', async () => {
    const ev = installEv;
    if (!ev) return;
    installEv = null;
    try { ev.prompt(); await ev.userChoice; } catch (e) { /* 無視 */ }
    renderPwaBox();
  });
  const bh = $('#pwHk');
  if (bh) bh.addEventListener('click', hkExport);
}

// ---------- パネルの上の一言（新しい版 > 引っ越し > ホーム画面の案内 の順に1つだけ） ----------
let noteKind = null, newVer = null;
function pwNote(kind) {
  const el = $('#pwaNote');
  noteKind = kind;
  if (!kind) { el.hidden = true; el.innerHTML = ''; return; }
  if (kind === 'update') {
    el.innerHTML = `<span>🆕 新しい版（版${newVer}）があります</span><button id="pnReload" class="pn-go">開き直す</button>`;
    $('#pnReload').addEventListener('click', () => location.reload());
  } else if (kind === 'move') {
    el.innerHTML = '<div class="pn-text"><b>📦 ホーム画面のアプリへようこそ</b><br>Chrome や Safari で使っていた記録は、ここには移っていません。前のブラウザで書き出した「控え」のファイルを読み込むと、記録と設定が移ります。</div>' +
      '<div class="pn-btns"><label class="pn-go">💾 控えを読み込む<input type="file" id="pnFile" accept=".json,application/json" hidden></label><button id="pnLater">今はしない</button></div>';
    el.classList.add('pn-col');
    $('#pnFile').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) hkImport(f);
    });
    $('#pnLater').addEventListener('click', () => { PW.moveOff = true; savePw(); pwNote(null); });
  } else if (kind === 'install') {
    el.innerHTML = '<span class="pn-link">📲 ホーム画面に置くと、全画面で使えて記録も消えにくくなります ›</span><button id="pnX" class="pn-x" title="消す">×</button>';
    el.querySelector('.pn-link').addEventListener('click', () => { pwNote(null); renderPwaBox(); openSettings(); });
    $('#pnX').addEventListener('click', () => pwNote(null));
  }
  if (kind !== 'move') el.classList.remove('pn-col');
  el.hidden = false;
}

async function decideNote() {
  if (newVer) { pwNote('update'); return; }
  if (isStandalone && !PW.moveOff) {
    let n = 1;
    try { n = (await allRides()).length; } catch (e) { /* 無視 */ }
    if (n === 0) { pwNote('move'); return; }
  }
  if (!isStandalone && PW.n >= 3 && !PW.barShown && H.intro) {
    PW.barShown = true; // 1回だけ
    savePw();
    pwNote('install');
    return;
  }
  if (noteKind === 'move') pwNote(null);
}

// ---------- ④ 新しい版の知らせ ----------
let lastCheck = 0;
async function checkUpdate() {
  if (!/^https?:/.test(location.protocol)) return;
  lastCheck = Date.now();
  try {
    const res = await fetch('index.html?chk=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const m = (await res.text()).match(/app\.js\?v=(\d+)/);
    const v = m ? Number(m[1]) : 0;
    if (v > CHARI_VER) {
      newVer = v;
      if (!riding) pwNote('update'); // 走っている間は出さない（走り終わったあとに出す）
    }
  } catch (e) { /* 電波がないときは調べない */ }
}
setTimeout(checkUpdate, 8000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - lastCheck > 30 * 60000) checkUpdate();
});
// 走り終わったら、待っていた知らせを出す
new MutationObserver(() => {
  if (!document.body.classList.contains('riding') && newVer && noteKind !== 'update') pwNote('update');
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

// ---------- ③ 電波がないとき ----------
const OFF_TEXT = '📵 電波が届いていません。地図とルート検索は使えませんが、「▶ ルートなしで走る」で記録はとれます';
function offlineNote() { if (!riding) msg(OFF_TEXT, true); }
if (!navigator.onLine) offlineNote();
window.addEventListener('offline', offlineNote);
window.addEventListener('online', () => {
  if (riding) return;
  if ($('#msg').textContent === OFF_TEXT) msg(mapReady ? '電波が戻りました' : '電波が戻りました。地図が出ないときは、開き直してください');
  if (!lastCheck || Date.now() - lastCheck > 60000) checkUpdate();
});

// ---------- 起動 ----------
renderPwaBox();
$('#btnSettings').addEventListener('click', renderPwaBox);
$('#condLine').addEventListener('click', renderPwaBox);
// 紹介を見終わるのを待ってから
setTimeout(decideNote, 1500);
