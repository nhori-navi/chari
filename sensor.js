'use strict';
/* ChariMiru 版11：Bluetoothセンサー（試験版）
   ・心拍計（Heart Rate）と、スピード・ケイデンスセンサー（Cycling Speed and Cadence）の共通規格に対応
   ・ブラウザの Web Bluetooth を使う。iPhoneは Safari が対応していないため「Bluefy」アプリで開く
   ・切れたら自動でつなぎ直す（最大10回）
   ride.js より前に読み込む（ride.js が sensorSpd・sensorHr などを使う）                   */

const WHEEL_PRESETS = [
  ['700×23C（ロード）', 2096], ['700×25C（ロード）', 2105], ['700×28C（ロード・クロス）', 2136],
  ['700×32C（クロス）', 2155], ['700×38C（クロス）', 2180], ['26×1.95（MTB）', 2050],
  ['27.5×2.1（MTB）', 2148], ['29×2.2（MTB）', 2298], ['20インチ（ミニベロ）', 1590],
  ['24インチ', 1890], ['26インチ（街乗り）', 2070], ['27インチ（街乗り）', 2150]
];
let wheelMm = 2105;
try { wheelMm = Number(JSON.parse(localStorage.getItem('chari_sensor') || '{}').wheel) || 2105; } catch (e) { /* 初期値 */ }
function saveWheel() { try { localStorage.setItem('chari_sensor', JSON.stringify({ wheel: wheelMm })); } catch (e) { /* 無視 */ } }

const sensor = { hr: null, hrT: 0, spd: null, spdT: 0, cad: null, cadT: 0, wheelDist: 0, wheelT: 0, devices: [] };
const FRESH_MS = 4000;

// 走行画面から使う：新しい値だけ返す（古ければ null）
function sensorHr() { return sensor.hr != null && Date.now() - sensor.hrT < FRESH_MS ? sensor.hr : null; }
function sensorSpd() { return sensor.spd != null && Date.now() - sensor.spdT < FRESH_MS ? sensor.spd : null; }
function sensorCad() { return sensor.cad != null && Date.now() - sensor.cadT < FRESH_MS ? sensor.cad : null; }
function wheelActive() { return sensor.devices.some(d => d.connected && d.hasWheel) && Date.now() - sensor.wheelT < FRESH_MS; }

// ---------- 受け取ったデータの読み方 ----------
function onHr(dv) {
  const flags = dv.getUint8(0);
  const v = (flags & 1) ? dv.getUint16(1, true) : dv.getUint8(1);
  if (v > 25 && v < 240) { sensor.hr = v; sensor.hrT = Date.now(); }
  updSensorUi();
}

function onCsc(dev, dv) {
  const flags = dv.getUint8(0);
  const now = Date.now();
  let o = 1;
  if (flags & 1) { // 車輪の回転
    const revs = dv.getUint32(o, true), t = dv.getUint16(o + 4, true);
    o += 6;
    dev.hasWheel = true;
    if (dev.w) {
      let dr = revs - dev.w.revs; if (dr < 0) dr += 4294967296;
      let dt = t - dev.w.t; if (dt < 0) dt += 65536;
      if (dr > 0 && dr < 60 && dt > 0) {
        const kmh = dr * wheelMm / 1000 / (dt / 1024) * 3.6;
        if (kmh < 120) {
          // 少しならして表示の揺れを抑える（止まった直後からの再開はそのまま）
          sensor.spd = sensor.spd ? sensor.spd * 0.4 + kmh * 0.6 : kmh; sensor.spdT = now;
          sensor.wheelDist += dr * wheelMm / 1000;
          dev.wChange = now;
        }
      } else if (now - (dev.wChange || now) > 2500) {
        sensor.spd = 0; sensor.spdT = now; // 回っていない＝止まっている
      }
    } else {
      dev.wChange = now;
    }
    dev.w = { revs, t };
    sensor.wheelT = now;
  }
  if (flags & 2) { // ペダル（クランク）の回転
    const revs = dv.getUint16(o, true), t = dv.getUint16(o + 2, true);
    dev.hasCrank = true;
    if (dev.c) {
      let dr = revs - dev.c.revs; if (dr < 0) dr += 65536;
      let dt = t - dev.c.t; if (dt < 0) dt += 65536;
      if (dr > 0 && dr < 20 && dt > 0) {
        const rpm = dr * 60 / (dt / 1024);
        if (rpm < 250) { sensor.cad = rpm; sensor.cadT = now; dev.cChange = now; }
      } else if (now - (dev.cChange || now) > 2500) {
        sensor.cad = 0; sensor.cadT = now;
      }
    } else {
      dev.cChange = now;
    }
    dev.c = { revs, t };
  }
  updSensorUi();
}

// ---------- つなぐ・つなぎ直す ----------
const KINDS = {
  hr: { svc: 'heart_rate', chr: 'heart_rate_measurement', label: '心拍計' },
  csc: { svc: 'cycling_speed_and_cadence', chr: 'csc_measurement', label: 'スピード・ケイデンス' }
};

async function connectSensor(kind) {
  if (!navigator.bluetooth) { updSensorUi(); return; }
  const K = KINDS[kind];
  let device;
  try {
    device = await navigator.bluetooth.requestDevice({ filters: [{ services: [K.svc] }] });
  } catch (e) {
    if (e && e.name !== 'NotFoundError') setSensorNote('つなげませんでした：' + (e.message || e));
    return; // 一覧で「キャンセル」した場合も、ここに来る
  }
  const old = sensor.devices.find(d => d.device.id === device.id);
  if (old) removeDev(old, true);
  const dev = { device, kind, name: device.name || K.label, connected: false, tries: 0 };
  sensor.devices.push(dev);
  device.addEventListener('gattserverdisconnected', () => onDisconnected(dev));
  setSensorNote('');
  await startDev(dev);
}

async function startDev(dev) {
  const K = KINDS[dev.kind];
  dev.state = 'つないでいます…';
  updSensorUi();
  try {
    const server = await dev.device.gatt.connect();
    const svc = await server.getPrimaryService(K.svc);
    const chr = await svc.getCharacteristic(K.chr);
    chr.addEventListener('characteristicvaluechanged', e => {
      if (dev.removed) return;
      if (dev.kind === 'hr') onHr(e.target.value); else onCsc(dev, e.target.value);
    });
    await chr.startNotifications();
    dev.connected = true;
    dev.tries = 0;
    dev.w = null; dev.c = null;
    dev.state = 'つながっています';
    if (riding) speak(`${K.label}につながりました`);
  } catch (e) {
    dev.connected = false;
    dev.state = 'つながりません';
    scheduleReconnect(dev);
  }
  updSensorUi();
}

function onDisconnected(dev) {
  if (dev.removed) return;
  dev.connected = false;
  dev.state = '切れました（つなぎ直しています）';
  if (riding) speak(`${KINDS[dev.kind].label}との接続が切れました`);
  updSensorUi();
  scheduleReconnect(dev);
}

function scheduleReconnect(dev) {
  if (dev.removed || dev.tries >= 10) {
    if (!dev.removed) { dev.state = 'つながりません（もう一度「つなぐ」を押してください）'; updSensorUi(); }
    return;
  }
  dev.tries++;
  setTimeout(() => { if (!dev.removed && !dev.connected) startDev(dev); }, Math.min(30000, 2000 * dev.tries));
}

function removeDev(dev, quiet) {
  dev.removed = true;
  try { if (dev.device.gatt.connected) dev.device.gatt.disconnect(); } catch (e) { /* 無視 */ }
  sensor.devices = sensor.devices.filter(d => d !== dev);
  if (!quiet) updSensorUi();
}

// ---------- 画面 ----------
function setSensorNote(t) { $('#sensorNote').textContent = t || ''; }

function updSensorUi() {
  const ok = !!navigator.bluetooth;
  $('#sensorSupport').textContent = ok
    ? 'センサーの電源を入れ（車輪やペダルを回すと起きるものもあります）、下のボタンから選んでください。'
    : 'このブラウザではBluetoothセンサーにつなげません。iPhoneでは無料の「Bluefy」アプリでこのページを開いてください。AndroidはChromeで使えます。';
  $('#btnConnHr').disabled = !ok;
  $('#btnConnCsc').disabled = !ok;
  const hr = sensorHr(), sp = sensorSpd(), cd = sensorCad();
  $('#sensorLive').innerHTML =
    `<div><span class="label">心拍</span><span>${hr != null ? hr + ' bpm' : '--'}</span></div>` +
    `<div><span class="label">スピード</span><span>${sp != null ? sp.toFixed(1) + ' km/h' : '--'}</span></div>` +
    `<div><span class="label">ケイデンス</span><span>${cd != null ? Math.round(cd) + ' rpm' : '--'}</span></div>`;
  $('#sensorList').innerHTML = sensor.devices.length
    ? sensor.devices.map((d, i) => `<li><div class="h-top"><b>${d.kind === 'hr' ? '♥' : '⟳'} ${esc(d.name)}</b>` +
        `<button data-i="${i}" class="mini-del">外す</button></div><div class="h-sub ${d.connected ? 'okc' : ''}">${esc(d.state || '')}` +
        `${d.hasWheel ? '・スピード' : ''}${d.hasCrank ? '・ケイデンス' : ''}</div></li>`).join('')
    : '';
  const on = sensor.devices.some(d => d.connected);
  const b = document.getElementById('btnRideSensor');
  if (b) { b.classList.toggle('on', on); b.textContent = on ? 'センサー：つながっています' : 'センサーをつなぐ'; }
}

function openSensor() {
  closeModals();
  const sel = $('#wheelSel');
  const hit = WHEEL_PRESETS.find(w => w[1] === wheelMm);
  sel.innerHTML = WHEEL_PRESETS.map(w => `<option value="${w[1]}">${w[0]}：${w[1]}mm</option>`).join('') +
    '<option value="0">その他（右に直接入力）</option>';
  sel.value = hit ? String(wheelMm) : '0';
  $('#wheelMm').value = wheelMm;
  setSensorNote('');
  updSensorUi();
  openModal('#sensorModal');
}

$('#wheelSel').addEventListener('change', () => {
  const v = Number($('#wheelSel').value);
  if (v) { wheelMm = v; $('#wheelMm').value = v; saveWheel(); }
});
$('#wheelMm').addEventListener('change', () => {
  const v = Number($('#wheelMm').value);
  if (v >= 1000 && v <= 2600) {
    wheelMm = v;
    saveWheel();
    const hit = WHEEL_PRESETS.find(w => w[1] === v);
    $('#wheelSel').value = hit ? String(v) : '0';
  }
});
$('#btnConnHr').addEventListener('click', () => connectSensor('hr'));
$('#btnConnCsc').addEventListener('click', () => connectSensor('csc'));
$('#sensorList').addEventListener('click', e => {
  const b = e.target.closest('button[data-i]');
  if (b) removeDev(sensor.devices[Number(b.dataset.i)]);
});
$('#btnOpenSensor').addEventListener('click', openSensor);
$('#btnRideSensor').addEventListener('click', openSensor);
setInterval(() => { if (!$('#sensorModal').hidden) updSensorUi(); }, 1000);
