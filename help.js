'use strict';
/* ChariMiru 版12：はじめての紹介・使い方ナビ・ヘルプ（TenMiru・MichiMiru と同じ作り）
   ・はじめての紹介：初めて開いたときだけ、カード5枚
   ・使い方ナビ：黄色い吹き出しで次にやることを出し、押す場所を黄色い枠で点滅させる
   ・ヘルプ：項目ごとに開閉できる説明。スマホの戻る操作で閉じる
   いちばん最後に読み込む                                                       */

const HELP_KEY = 'chari_help_v1';
let H = { intro: false, on: true, done: {}, ev: {} };
try { H = Object.assign(H, JSON.parse(localStorage.getItem(HELP_KEY) || '{}')); } catch (e) { /* 初期値 */ }
function saveHelp() { try { localStorage.setItem(HELP_KEY, JSON.stringify(H)); } catch (e) { /* 無視 */ } }
const isTouch = window.matchMedia && matchMedia('(pointer: coarse)').matches;

// ---------- はじめての紹介 ----------
const INTRO = [
  ['🚲', '坂がわかる自転車ナビ', '出発地と目的地を決めると、自転車向けのルートと坂の断面図、到着予定が出ます。坂の高さは国土地理院の細かいデータを使っています。'],
  ['🔊', '走ると案内と記録', '「▶ 走る」で、曲がり角や坂の手前を音声で案内します。信号待ちは自動で一時停止。地図は北↑・進行方向↑・3Dを選べます。'],
  ['🗂', '記録とあそび', '走った記録は「履歴」に残ります。走った場所のマス塗り、峠のスタンプ帳、バッジ集めも楽しめます。'],
  ['🌏', '長距離の旅', '走った距離の合計で、東海道からルート66、シベリア鉄道…と世界の旅を進みます。最後は月まで。'],
  ['📍', '位置情報と記録の置き場所', '位置情報はルートと記録のためだけに使います。記録はこの端末の中だけに保存され、どこにも送りません。iPhoneはホーム画面に置いて使い、ときどき履歴からGPXで控えを取ってください。']
];
let introIdx = 0;
function showIntro() {
  introIdx = 0;
  renderIntro();
  $('#intro').hidden = false;
}
function renderIntro() {
  const c = INTRO[introIdx];
  $('#introCard').innerHTML = `<div class="in-icon">${c[0]}</div><div class="in-title">${c[1]}</div><p>${c[2]}</p>`;
  $('#introDots').innerHTML = INTRO.map((_, i) => `<i class="${i === introIdx ? 'on' : ''}"></i>`).join('');
  $('#introPrev').style.visibility = introIdx ? 'visible' : 'hidden';
  $('#introNext').textContent = introIdx === INTRO.length - 1 ? 'はじめる' : '次へ';
}
function closeIntro() {
  $('#intro').hidden = true;
  H.intro = true;
  saveHelp();
}
$('#introNext').addEventListener('click', () => {
  if (introIdx < INTRO.length - 1) { introIdx++; renderIntro(); } else closeIntro();
});
$('#introPrev').addEventListener('click', () => { if (introIdx > 0) { introIdx--; renderIntro(); } });
$('#introSkip').addEventListener('click', closeIntro);

// ---------- 使い方ナビ ----------
const STEPS = ['bike', 'start', 'goal', 'trace', 'detail', 'ride', 'hist', 'tabs', 'journey'];
const vis = sel => { const el = document.querySelector(sel); return !!(el && el.offsetParent !== null); };
const modalOpen = id => !$(id).hidden;
const anyModal = () => [...document.querySelectorAll('.modal')].some(m => !m.hidden);

function stepTip(step) {
  const n = state.points.length;
  const needRoute = () => {
    if (state.route && !$('#panel').classList.contains('mode-result')) {
      return { target: '#btnBackResult', text: '「ルートの表示に戻る」を押してください' };
    }
    if (!state.route) return stepTip(state.points[0].lng == null ? 'start' : 'goal');
    return null;
  };
  switch (step) {
    case 'bike':
      if (modalOpen('#settingsModal')) return { target: '#btnSaveSettings', text: '自転車の種類とルートの好みを選んで「保存」を押してください。平均速度は空欄のままで大丈夫です' };
      if (!vis('#condLine')) return { target: '#btnEdit', text: '「✎ 変更」で地点を決める画面に戻れます' };
      return { target: '#condLine', text: 'まず、ここをタップして自転車の種類を選びましょう（ロード・クロス・街乗り・電動アシスト）' };
    case 'start':
    case 'goal': {
      const i = step === 'start' ? 0 : n - 1;
      if (modalOpen('#searchModal')) return { target: '#searchInput', text: '駅名や地名を入れて、出てきた候補をタップします。「現在地を使う」でもOK' };
      if (!vis('#points')) return { target: '#btnEdit', text: '「✎ 変更」で地点を決める画面に戻れます' };
      return {
        target: `#points .ptname[data-i="${i}"]`,
        text: step === 'start'
          ? '「出発」の欄をタップして出発地を決めましょう。地図を長押し（パソコンは右クリック）しても決められます'
          : '次は「到着」の欄で目的地を決めましょう。決めるとすぐにルートが出ます'
      };
    }
    case 'trace':
      return needRoute() || { target: '#profile', text: 'これが坂の断面図です。指でなぞると、その地点の標高と勾配が出て、地図にも黒い丸が動きます' };
    case 'detail':
      return needRoute() || { target: '#btnDetail', text: '「詳しく」で最大勾配や、到着予定の計算のしかたが見られます' };
    case 'ride':
      return needRoute() || { target: '#btnRide', text: '「▶ 走る」で案内と記録が始まります。押すのは止まっている間に。走り終わったら■で終了します' };
    case 'hist':
      return { target: '#btnHist', text: '「履歴」で、これまでの記録が見られます' };
    case 'tabs':
      if (!modalOpen('#histModal')) return { target: '#btnHist', text: '「履歴」を開いてください' };
      return { target: '#histTabs', text: '上のタブで、塗ったマス・峠のスタンプ・記録とバッジに切り替えられます' };
    case 'journey':
      if (modalOpen('#histModal')) return { target: '#histModal .close', text: '「閉じる」で履歴を閉じましょう' };
      return { target: '#btnJourney', text: '「旅」で、走った距離の合計で進む世界の旅が見られます' };
  }
  return null;
}

function pickTip() {
  // 走行中は、初めて走ったときに下の帯の見方を1回だけ（20秒）
  if (riding) {
    if (!H.ev.rideNote) { H.ev.rideNote = Date.now(); saveHelp(); }
    if (Date.now() - H.ev.rideNote < 20000) {
      return { key: 'rideNote', target: '#rideBar', text: '下の帯：次の曲がり角・残り距離・到着予定・この先の坂。帯をタップすると詳しい表示。⏸で一時停止、■で終了。操作は止まっている間に' };
    }
    return null;
  }
  if (document.body.classList.contains('journey')) {
    if (!H.on) return null;
    return { key: 'journeyView', target: '#jpList', text: '地球儀に、制覇したコースと今のコースの進み具合が出ます。一覧のコースをタップするとそこへ飛びます。「地図に戻る」で戻ります' };
  }
  if (!H.on || !$('#intro').hidden || !$('#helpBox').hidden) return null;
  const step = STEPS.find(s => !H.done[s] && !(s === 'ride' && !isTouch));
  if (!step) {
    // 全部できた
    if (!H.ev.complete) { H.ev.complete = Date.now(); saveHelp(); }
    if (Date.now() - H.ev.complete < 10000) return { key: 'complete', target: null, text: '🎉 レクチャー完了！ いつでも「？ 使い方」から説明を見られます' };
    H.on = false;
    saveHelp();
    $('#helpOn').checked = false;
    return null;
  }
  // 手順に関係ない画面（センサー・走り終わりなど）を開いている間は出さない
  const known = ['#settingsModal', '#searchModal', '#histModal'];
  if (modalOpen('#farModal')) return null;
  if (anyModal() && !known.some(modalOpen)) return null;
  const t = stepTip(step);
  return t ? { key: step + ':' + t.target, ...t } : null;
}

let tipKey = null, dismissed = null, hlEl = null;
function helpTick() {
  // 終わった手順を覚える
  if (state.points[0].lng != null) H.done.start = true;
  if (state.points[state.points.length - 1].lng != null && state.route) H.done.goal = true;

  const t = pickTip();
  if (hlEl) { hlEl.classList.remove('hl'); hlEl = null; }
  if (!t || t.key === dismissed) { $('#tip').hidden = true; tipKey = t ? t.key : null; return; }
  if (t.key !== tipKey) { dismissed = null; tipKey = t.key; }
  $('#tipText').textContent = t.text;
  $('#tip').hidden = false;
  const el = t.target ? document.querySelector(t.target) : null;
  if (el && el.offsetParent !== null) { el.classList.add('hl'); hlEl = el; }
}
$('#tipClose').addEventListener('click', () => {
  dismissed = tipKey; // 状況が変わるまで出さない
  $('#tip').hidden = true;
  if (hlEl) { hlEl.classList.remove('hl'); hlEl = null; }
});

// できたことを覚える
const markDone = s => { if (!H.done[s]) { H.done[s] = true; saveHelp(); } };
$('#btnSaveSettings').addEventListener('click', () => markDone('bike'));
$('#profile').addEventListener('pointerdown', () => markDone('trace'));
$('#btnDetail').addEventListener('click', () => markDone('detail'));
$('#btnHist').addEventListener('click', () => markDone('hist'));
$('#histTabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b && b.dataset.tab !== 'list') markDone('tabs'); });
$('#btnJourney').addEventListener('click', () => markDone('journey'));
let wasRiding = false;
setInterval(() => {
  if (wasRiding && !riding) markDone('ride'); // 走り終わったら
  wasRiding = riding;
  helpTick();
}, 1000);

$('#helpOn').addEventListener('change', () => {
  H.on = $('#helpOn').checked;
  if (H.on && STEPS.every(s => H.done[s] || (s === 'ride' && !isTouch))) { H.done = {}; delete H.ev.complete; } // 完了後に入れ直したら最初から
  dismissed = null;
  saveHelp();
  helpTick();
});

// ---------- ヘルプ ----------
const HELP_ITEMS = [
  ['ChariMiru とは', '坂の高低差がわかる自転車のルート検索と、走行の記録・音声案内ができるアプリです。無料で、登録もいりません。記録はこの端末の中だけに保存されます。'],
  ['画面の見方', '下のパネルで地点を決めると、ルートが地図に出ます。ルートの色は上り坂のきつさ（緑〜3%・黄3〜6%・橙6〜10%・赤10%〜）です。パネル上の灰色のつまみを上下に動かすと、パネルの高さ（地図の広さ）を変えられます（2回タップで元の高さ）。スマホを横にすると、パネルは右側の列になり、地図が広く出ます。右上のボタンは、旅（世界の旅）・履歴・？（使い方）・◎（現在地）・⚙（設定）。'],
  ['ルートを比べる（A・B）', '検索のたびに、選んだ好みのルート（A）と、比べるためのもう1本（B、地図の灰色の線）を出します。「走りやすさ優先」は車の多い大きな道を避けて静かな道を選びますが、日本の地図データでは裏道の信号や細さが考えに入らないため、大きな道をまっすぐ行ったほうが楽で速いこともあります。そんなときは「速さ優先（大きな道も使う）」のルートと比べて、ボタンか灰色の線をタップして選んでください。2本がほとんど同じ道なら1本だけ出します。'],
  ['夜間モード', '⚙ の「画面の明るさ」で、自動（日の入りから日の出までは暗く）・いつも明るい・いつも暗い を選べます。夜は地図も夜の色になり、夕方と明け方は夕暮れの色になります。'],
  ['地点の決め方', '「出発」「到着」の欄をタップして、駅名・地名・住所で検索するか「現在地を使う」。地図を長押し（パソコンは右クリック）すると、その場所を出発地・経由地・目的地にできます。地図上の S・G・数字の印はドラッグで動かせます。「＋経由地」で寄り道、「⇅ 入れ替え」で行きと帰りを逆に。'],
  ['自転車の種類・好み・速さ', '⚙ または条件の行から変えられます。自転車の種類（ロード・クロス・街乗り・電動アシスト）で通る道と速さが変わり、好み（速さ優先・走りやすさ優先・坂をなるべく避ける）で道の選び方が変わります。平均速度を空欄にしておくと、同じ自転車の種類で10分以上の記録が2回たまったところで、履歴から自分の速さを計算して使います。'],
  ['坂の見方', '断面図は、横がスタートからの距離、縦が標高です。指でなぞると、その地点の標高と勾配（100mあたりの上り下り）が出て、地図に黒い丸が動きます。「詳しく」で登り・下りの合計と最大勾配。到着予定は「平地の速さ」と「登りの量」から出した目安です。'],
  ['共有リンク', '「共有」で、出発地・経由地・目的地と自転車の種類を入れたリンクを作ります。受け取った人がリンクを開くと、同じ条件でルートが出ます。履歴の道から作ったルートは共有できません（GPXを使ってください）。'],
  ['走る（案内と記録）', '「▶ 走る」で、ルートに沿った案内と記録が始まります。ルートを決めずに記録だけなら「▶ ルートなしで走る」。曲がり角の手前で「○メートル先、右へ」、坂の約300m手前で長さと勾配、5kmごとに距離と平均速度を知らせます。信号待ちなどで止まると自動で一時停止します。ルートから外れて15秒たつと自動で引き直します（詳しい表示でオフにできます）。右上のボタンで、地図の向きを 北↑・進↑（進行方向が上）・3D に切り替え。🔊 で音声のオン／オフ。地図を指で動かすと追いかけをやめ、◎ で戻ります。走行中は画面をつけたままにしてください（画面ONは走り始めると自動で「入」。詳しい表示で切り替えられますが、切ると画面が消えたときに記録が止まります）。🔒 のタッチロックで、雨やポケットでの誤操作を防げます（解除は 🔒 を1.5秒長押し）。走行中は出発地の印（S）と通り過ぎた経由地の印は消え、走り終わると元のルートに戻ります。出発地から300m以上離れた所で「▶ 走る」を押すと、出発地まで案内するか聞きます。走っている途中で行き先を変えたいときは、地図を長押しして「ここを目的地にする」「ここに寄ってから行く」を選ぶか、詳しい表示の「🔍 目的地を変える」「＋ 寄り道を足す」で検索します。現在地から引き直し、走り終わったあとも変えた行き先のルートが残ります。ルートなしで走っているときも、こうして行き先を決められます。スマホを横にすると、地図が全画面になり、情報は右下の小さな箱に出ます。'],
  ['履歴とGPX', '「履歴」の一覧で、記録をタップすると「この道を走る」（同じ道をルートにする）・「地図で見る」・「GPX」（ファイルに書き出し）・「削除」。下の「GPXファイルを読み込む」で、ほかのアプリのコースや、書き出した記録を取り込めます。記録はこの端末の中だけにあるので、ときどき「全部をGPXで書き出す」で控えを取ってください。'],
  ['マス・峠・バッジ', '履歴のタブで切り替えます。マス：走った道が通った約1km四方のマスを塗ります。峠：地図データに名前のある峠を通るとスタンプ（保存したあとに通信して調べます）。記録：月ごとの距離、登った高さ（富士山○個分）、バッジ20種類。'],
  ['長距離の旅', 'これまでの記録の合計距離で、短いコースから順に進みます（東海道 → ルート66 → シルクロード → シベリア鉄道 → 日本一周 → 地球一周 → 月まで）。「旅」で地球儀に進み具合が出ます。地点に着いたり制覇したりすると、走り終わりに知らせます。'],
  ['センサー（Bluetooth）', '⚙ の「センサー（Bluetooth）をつなぐ」から、心拍計とスピード・ケイデンスセンサーにつなげます（共通規格のBLEのもの）。iPhoneは Safari が対応していないため、無料の「Bluefy」アプリでこのページを開いてください。Android は Chrome で使えます。つながると、速度と距離はスピードセンサーを優先し、心拍・ケイデンスを記録とGPXに残します。ページを開き直すたびに、もう一度つなぐ必要があります。'],
  ['現在地と記録の保存', '位置情報は、ルートの出発地・走行の案内と記録のためだけに使い、記録はこの端末（このブラウザ）の中だけに保存します。iPhone では、Safari・ホーム画面に置いたアプリ・Bluefy で保存場所が別々です。ホーム画面に置いて使うのがおすすめです（Safariのままだと、7日間使わないと保存が消えることがあります）。移すときは GPX の書き出しと読み込みを使ってください。'],
  ['うまくいかないとき', 'ルートが出ない：通信を確認し、「再検索」を押してください。地点を少し動かすと出ることもあります。現在地が出ない：スマホの設定で、ブラウザ（またはアプリ）の位置情報を許可してください。音声が出ない：マナーモードを解除し、音量を上げてください。地図が回らない：「進↑」か「3D」にして、iPhone では向きの許可を「許可」に。新しい版にならない：ホーム画面のアプリなら、一度上にスワイプして閉じてから開き直してください。<br><br><b>データの出典</b>：地図 © Mapbox © OpenStreetMap contributors／ルート OpenRouteService（© openrouteservice.org by HeiGIT）／標高 国土地理院（標高タイル）／峠 OpenStreetMap（Overpass API）／地名の検索 Mapbox']
];

function openHelp() {
  closeModals();
  $('#helpList').innerHTML = HELP_ITEMS.map(([t, b]) => `<details><summary>${t}</summary><p>${b}</p></details>`).join('');
  $('#helpBox').hidden = false;
  try { history.pushState({ chariHelp: 1 }, ''); } catch (e) { /* 無視 */ }
}
function closeHelp(fromPop) {
  if ($('#helpBox').hidden) return;
  $('#helpBox').hidden = true;
  if (!fromPop && history.state && history.state.chariHelp) { try { history.back(); } catch (e) { /* 無視 */ } }
}
window.addEventListener('popstate', () => closeHelp(true));
$('#btnHelp').addEventListener('click', openHelp);
$('#btnHelp2').addEventListener('click', openHelp);
$('#btnHelp3').addEventListener('click', openHelp);
$('#helpClose').addEventListener('click', () => closeHelp(false));
$('#helpIntro').addEventListener('click', () => { closeHelp(false); showIntro(); });
$('#helpRestart').addEventListener('click', () => {
  H.on = true;
  H.done = {};
  delete H.ev.complete;
  dismissed = null;
  saveHelp();
  $('#helpOn').checked = true;
  closeHelp(false);
  setMode('edit');
  helpTick();
});

// ---------- 起動 ----------
$('#helpOn').checked = H.on;
if (!H.intro) showIntro();
