/* 无头冒烟测试：用假的 DOM/Canvas/Gamepad 跑主循环，捕获运行时异常并输出状态。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = path.join(__dirname, '..', 'game.js');
const code = fs.readFileSync(SRC, 'utf8');

const calls = { fill: 0, stroke: 0, arc: 0 };
function fakeCtx() {
  const target = {};
  return new Proxy(target, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'canvas') return { width: 0, height: 0 };
      return (...args) => {
        if (p === 'fill') calls.fill++;
        if (p === 'stroke') calls.stroke++;
        if (p === 'arc' || p === 'ellipse') calls.arc++;
        if (p === 'createLinearGradient' || p === 'createRadialGradient')
          return { addColorStop() {} };
        return undefined;
      };
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}
const ctx = fakeCtx();

function mkEl(id) {
  return {
    id, textContent: '', innerHTML: '', value: 0,
    style: {}, classList: { add() {}, remove() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {},
    getContext: () => ctx, width: 0, height: 0,
  };
}
const els = {};
const listeners = {};
const win = {
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
  removeEventListener() {},
  AudioContext: undefined, webkitAudioContext: undefined,
};
const doc = {
  getElementById: (id) => (els[id] = els[id] || mkEl(id)),
  addEventListener: win.addEventListener,
};

/* ---- 假手柄：左摇杆满舵 + RT 油门 ---- */
function mkPad(index) {
  const buttons = [];
  for (let i = 0; i < 17; i++) buttons.push({ pressed: false, value: 0, touched: false });
  return { index, id: 'Fake Pad (STANDARD GAMEPAD)', connected: true, mapping: 'standard',
    axes: [0, 0, 0, 0], buttons, timestamp: 0 };
}
const PAD = mkPad(0);
PAD.buttons[0].pressed = true; PAD.buttons[0].value = 1;   // A：开局 / 手刹

const rafQueue = [];
const sandbox = {
  window: win, document: doc, navigator: { getGamepads: () => [PAD] },
  requestAnimationFrame: (f) => { rafQueue.push(f); return rafQueue.length; },
  setTimeout, clearTimeout, console, performance: { now: () => 0 },
  Path2D: class { moveTo() {} lineTo() {} closePath() {} },
  Math, Date, Object, Array, JSON, isNaN, parseInt, parseFloat,
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

const errors = [];
try {
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'game.js' });
} catch (e) {
  errors.push('加载阶段: ' + e.stack);
}

function drain(n, tStart, step) {
  let t = tStart;
  for (let f = 0; f < n; f++) {
    const cb = rafQueue.shift();
    if (!cb) throw new Error('第 ' + f + ' 帧没有排队的 rAF 回调（主循环停止）');
    t += step;
    try { cb(t); } catch (e) { errors.push('第 ' + f + ' 帧: ' + e.stack); break; }
  }
  return t;
}

let t = 0;
try {
  t = drain(10, t, 16.7);            // 菜单：A 键已按下 -> 开局
  PAD.buttons[0].pressed = false; PAD.buttons[0].value = 0;

  // ---- 自动驾驶：沿赛道前进，用来验证检查点与计圈 ----
  const R = () => sandbox.window.__racer;
  let autopilotFrames = 0;
  const autopilot = () => {
    autopilotFrames++;
    const g = R();
    const { car, PATH, S } = g;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < S; i++) {
      const dx = PATH[i][0] - car.x, dy = PATH[i][1] - car.y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; bi = i; }
    }
    const tgt = PATH[(bi + 26) % S];
    let diff = Math.atan2(tgt[1] - car.y, tgt[0] - car.x) - car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    PAD.axes[0] = Math.max(-1, Math.min(1, diff * 2.4));
    const spd = Math.hypot(car.vx, car.vy);
    const on = spd < 430;
    PAD.buttons[7].pressed = on; PAD.buttons[7].value = on ? 1 : 0;
  };
  PAD.axes[1] = 0;

  let maxLateral = 0, offRoadFrames = 0;
  let tt = 0;
  for (let f = 0; f < 9000; f++) {
    autopilot();
    const cb = rafQueue.shift();
    tt += 16.7; cb(tt);
    const c = R().car;
    maxLateral = Math.max(maxLateral, c.dist);
    if (c.off) offRoadFrames++;
  }
  console.log('自动驾驶: ' + autopilotFrames + ' 帧, 最大横向偏移 ' + maxLateral.toFixed(0) +
              ', 出界帧 ' + offRoadFrames);
  console.log('比赛状态: 圈数=' + R().race.laps + ' 最快=' +
              (R().race.best == null ? '--' : R().race.best.toFixed(2)) +
              ' 上一圈=' + (R().race.last == null ? '--' : R().race.last.toFixed(2)));
  if (R().race.laps < 2) errors.push('计圈失败：自动驾驶跑了 150 秒只完成 ' + R().race.laps + ' 圈');

  // ---- 手刹 / 刹车 / 倒车 / 出界，跑一段看看有没有异常 ----
  R().resetCar(true);
  PAD.axes[0] = 0.55; PAD.buttons[7].value = 1;
  t = drain(600, tt, 16.7);
  PAD.buttons[6].pressed = true; PAD.buttons[6].value = 1;
  t = drain(600, t, 16.7);
  PAD.buttons[6].pressed = false; PAD.buttons[6].value = 0;
  PAD.buttons[0].pressed = true; PAD.buttons[0].value = 1;   // A 手刹漂移
  PAD.axes[0] = -1; PAD.buttons[7].value = 0.6;
  t = drain(1200, t, 16.7);
  PAD.buttons[0].pressed = false; PAD.buttons[0].value = 0;

  // ---- 断开手柄，用键盘跑 ----
  PAD.connected = false;
  const kd = (listeners.keydown || []);
  kd.forEach((f) => f({ code: 'KeyW', key: 'w', preventDefault() {} }));
  kd.forEach((f) => f({ code: 'KeyD', key: 'd', preventDefault() {} }));
  t = drain(900, t, 16.7);
  const ku = (listeners.keyup || []);
  ku.forEach((f) => f({ code: 'KeyW', key: 'w' }));
  t = drain(300, t, 16.7);

  // ---- 暂停 / 继续 / 重置 ----
  kd.forEach((f) => f({ code: 'Escape', key: 'Escape', preventDefault() {} }));
  t = drain(60, t, 16.7);
  kd.forEach((f) => f({ code: 'Escape', key: 'Escape', preventDefault() {} }));
  kd.forEach((f) => f({ code: 'KeyR', key: 'r', preventDefault() {} }));
  t = drain(300, t, 16.7);

  // ---- 重连手柄 ----
  PAD.connected = true;
  const gcs = (listeners.gamepadconnected || []);
  gcs.forEach((f) => f({ gamepad: PAD }));
  t = drain(120, t, 16.7);
} catch (e) {
  errors.push('循环: ' + e.stack);
}

console.log('模拟帧数: 约 ' + Math.round(t / 16.7) + ' 帧 (' + (t / 1000).toFixed(1) + ' 秒)');
console.log('canvas 调用: fill=' + calls.fill + ' stroke=' + calls.stroke + ' arc/ellipse=' + calls.arc);
console.log('面板文本: 圈数=' + els.lap.textContent + ' 本圈=' + els.cur.textContent +
            ' 最快=' + els.best.textContent + ' 上圈=' + els.last.textContent + ' 速度=' + els.spd.textContent);
console.log('手柄名显示: ' + els.padname.textContent);
console.log('Toast: ' + els.toast.textContent);

if (errors.length) {
  console.log('\n❌ 发现 ' + errors.length + ' 个运行时错误:');
  errors.forEach((e) => console.log('---\n' + e));
  process.exit(1);
} else {
  console.log('\n✅ 全程无运行时错误');
}
