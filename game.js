/* 手柄赛车 Gamepad Racer —— 纯 Canvas 2D 小游戏
 * 手柄：左摇杆转向 / RT 油门 / LT 刹车倒车 / A 手刹 / B 重置 / Start 暂停
 * 键盘：方向键或 WASD / 空格手刹 / R 重置 / Esc 暂停 / M 静音
 */
'use strict';
(function () {

/* ------------------------------------------------------------------ 工具 */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const fmtTime = (t) => {
  if (t == null) return '--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return (m > 0 ? m + ':' + (s < 10 ? '0' : '') : '') + s.toFixed(2);
};
function roundRect(c, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

/* ------------------------------------------------------------- DOM & 画布 */
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
const el = {
  lap: document.getElementById('lap'),
  cur: document.getElementById('cur'),
  best: document.getElementById('best'),
  last: document.getElementById('last'),
  spd: document.getElementById('spd'),
  spdbar: document.getElementById('spdbar'),
  padname: document.getElementById('padname'),
  toast: document.getElementById('toast'),
  overlay: document.getElementById('overlay'),
};
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.max(1, Math.round(W * DPR));
  cv.height = Math.max(1, Math.round(H * DPR));
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  if (ctx.setTransform) ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);
resize();

/* ----------------------------------------------------------------- 赛道 */
const CTRL = [
  [0, 0], [620, -130], [1250, -95], [1750, 110], [2000, 430],
  [1850, 745], [1480, 840], [1180, 665], [930, 770], [640, 985],
  [220, 935], [-220, 780], [-500, 470], [-430, 150]
];
const SUB = 26;                 // 每段控制点的细分
const HALF_W = 132;             // 半个路宽
const WALL = HALF_W + 78;       // 护栏位置（出界上限）
const START_BACK = 8;           // 出生点在起点线后方几个采样点

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t +
    (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}
const PATH = [];
for (let i = 0; i < CTRL.length; i++) {
  const p0 = CTRL[(i - 1 + CTRL.length) % CTRL.length];
  const p1 = CTRL[i], p2 = CTRL[(i + 1) % CTRL.length];
  const p3 = CTRL[(i + 2) % CTRL.length];
  for (let j = 0; j < SUB; j++) PATH.push(catmull(p0, p1, p2, p3, j / SUB));
}
const S = PATH.length;
const DIR = [], NRM = [];
for (let i = 0; i < S; i++) {
  const a = PATH[(i - 1 + S) % S], b = PATH[(i + 1) % S];
  let dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  dx /= L; dy /= L;
  DIR.push([dx, dy]);
  NRM.push([-dy, dx]);
}
const GATES = [0, Math.floor(S * 0.25), Math.floor(S * 0.5), Math.floor(S * 0.75)];

/* 画一次赛道路径（屏幕外缓存不合适，因为缩放会变，直接每帧描边） */
function trackPath() {
  const p = new Path2D();
  p.moveTo(PATH[0][0], PATH[0][1]);
  for (let i = 1; i < S; i++) p.lineTo(PATH[i][0], PATH[i][1]);
  p.closePath();
  return p;
}
const TRACK_P = trackPath();

/* 最近采样点：优先在上一帧附近搜索，离得太远再全局搜索 */
let lastIdx = 0;
function nearestIndex(x, y, force) {
  let bi = 0, bd = Infinity;
  const scan = (from, to) => {
    for (let k = from; k < to; k++) {
      const i = ((k % S) + S) % S;
      const dx = PATH[i][0] - x, dy = PATH[i][1] - y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; bi = i; }
    }
  };
  if (force) scan(0, S);
  else {
    scan(lastIdx - 40, lastIdx + 41);
    if (bd > 300 * 300) { bd = Infinity; scan(0, S); }
  }
  return { i: bi, d: Math.sqrt(bd) };
}
/* 点到线段距离（更精确的横向距离） */
function lateralDist(x, y, i) {
  const a = PATH[i], b = PATH[(i + 1) % S];
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy || 1;
  let t = ((x - a[0]) * vx + (y - a[1]) * vy) / len2;
  t = clamp(t, 0, 1);
  const px = a[0] + vx * t, py = a[1] + vy * t;
  return Math.hypot(x - px, y - py);
}

/* ----------------------------------------------------------------- 车辆 */
const MAXSPEED = 660;     // 世界单位 / 秒
const ENGINE = 780;
const BRAKE_F = 1500;
const REVERSE = 320;
const DRAG_ROAD = 0.62;
const DRAG_GRASS = 3.1;
const GRIP_ROAD = 8.5;
const GRIP_GRASS = 2.4;
const TURN_RATE = 3.05;
const PX_PER_M = 8;       // 8 世界单位 = 1 米

const car = { x: 0, y: 0, angle: 0, vx: 0, vy: 0, steer: 0, off: false, dist: 0 };

function resetCar(full) {
  const i = (S - START_BACK) % S;
  car.x = PATH[i][0]; car.y = PATH[i][1];
  car.angle = Math.atan2(DIR[i][1], DIR[i][0]);
  car.vx = car.vy = 0; car.steer = 0; car.off = false; car.dist = 0;
  lastIdx = i;
  if (full) {
    race.lapTime = 0; race.laps = 0; race.best = null; race.last = null;
    race.expected = 0; race.crossed = false;
    marks.length = 0; dusts.length = 0;
  }
}

/* --------------------------------------------------------------- 游戏状态 */
const race = {
  mode: 'menu',      // menu | race | pause
  lapTime: 0, laps: 0, best: null, last: null,
  expected: 0, crossed: false, time: 0,
};
const cam = { x: 0, y: 0, zoom: 1 };
/* 视角：true = 镜头随车头旋转，车头永远朝屏幕上方；false = 固定的北朝上视角 */
const CAM_HEAD_UP = true;
const marks = [];   // 胎痕
const dusts = [];   // 尘土

/* ----------------------------------------------------------------- 输入 */
const input = { steer: 0, throttle: 0, brake: 0, hand: false };
const keys = Object.create(null);
let pad = null, padName = '', padPrev = [];

window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Spacebar'].indexOf(e.key) >= 0) e.preventDefault();
  keys[e.code] = true;
  if (e.code === 'Enter' || e.code === 'Space') {
    if (race.mode === 'menu') startRace();
    else if (race.mode === 'pause') resumeRace();
  }
  if (e.code === 'Escape') togglePause();
  if (e.code === 'KeyR') resetCar(true);
  if (e.code === 'KeyM') { Sound.on = !Sound.on; toast(Sound.on ? '音效 开' : '音效 关'); }
}, { passive: false });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function padConnected(e) { pad = e.gamepad; padName = e.gamepad.id; updatePadUI(); }
function padDisconnected() { pad = null; padName = ''; updatePadUI(); }
window.addEventListener('gamepadconnected', padConnected);
window.addEventListener('gamepaddisconnected', padDisconnected);

function pollPad() {
  const list = (navigator.getGamepads && navigator.getGamepads()) || [];
  let found = null;
  for (let i = 0; i < list.length; i++) {
    const g = list[i];
    if (!g || !g.connected) continue;
    if (!found) found = g;
    if (pad && g.index === pad.index) { found = g; break; }
  }
  const changed = (!!found !== !!pad) || (found && pad && found.id !== pad.id);
  pad = found;
  if (changed) { padName = pad ? pad.id : ''; updatePadUI(); }
  return pad;
}

function dz(v) { // 死区 + 重新映射到 0..1
  const a = Math.abs(v);
  if (a < 0.14) return 0;
  return Math.sign(v) * (a - 0.14) / 0.86;
}
function btnValue(g, i) {
  const b = g && g.buttons && g.buttons[i];
  if (!b) return 0;
  return typeof b === 'object' ? (b.value || 0) : (b ? 1 : 0);
}
function btnDown(g, i) {
  const b = g && g.buttons && g.buttons[i];
  if (!b) return false;
  return typeof b === 'object' ? !!(b.pressed || b.value > 0.5) : !!b;
}

function readInput(dt) {
  const g = pollPad();
  let steer = 0, thr = 0, brk = 0, hand = false;

  // ---- 键盘
  if (keys.ArrowLeft || keys.KeyA) steer -= 1;
  if (keys.ArrowRight || keys.KeyD) steer += 1;
  if (keys.ArrowUp || keys.KeyW) thr = 1;
  if (keys.ArrowDown || keys.KeyS) brk = 1;
  if (keys.Space) hand = true;

  // ---- 手柄
  if (g) {
    const ax = g.axes || [];
    const st = dz(ax[0] || 0);
    if (Math.abs(st) > Math.abs(steer)) steer = st;
    // 标准映射：RT=7 油门，LT=6 刹车；兼容用左摇杆 Y 轴当油门
    const rt = btnValue(g, 7), lt = btnValue(g, 6);
    const sy = -dz(ax[1] || 0);
    thr = Math.max(thr, rt, Math.max(0, sy));
    brk = Math.max(brk, lt, Math.max(0, -sy));
    const rY = -dz(ax[3] || 0);
    if (rY > 0.1) thr = Math.max(thr, rY);
    if (rY < -0.1) brk = Math.max(brk, -rY);
    if (btnDown(g, 0)) hand = true;

    // ---- 按键边沿（菜单开始 / 暂停 / 重置）
    const now = [];
    for (let i = 0; i < (g.buttons ? g.buttons.length : 0); i++) now[i] = btnDown(g, i);
    if (!padPrev.length) padPrev = now.slice();
    const pressed = (i) => now[i] && !padPrev[i];
    if (pressed(9) || pressed(8)) togglePause();
    if (pressed(1)) resetCar(true);
    if (pressed(0) && race.mode === 'menu') startRace();
    let anyBtn = false;
    for (let i = 0; i < now.length; i++) if (pressed(i)) anyBtn = true;
    padPrev = now;
    if (anyBtn && race.mode === 'menu') startRace();  // 菜单里按手柄任意键都能开局
  } else {
    padPrev = [];
  }

  input.steer = clamp(steer, -1, 1);
  input.throttle = clamp(thr, 0, 1);
  input.brake = clamp(brk, 0, 1);
  input.hand = hand;
}

/* ----------------------------------------------------------------- 音效 */
const Sound = {
  ctx: null, osc: null, gain: null, filt: null, on: true,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.osc = this.ctx.createOscillator();
      this.osc.type = 'sawtooth';
      this.osc.frequency.value = 70;
      this.filt = this.ctx.createBiquadFilter();
      this.filt.type = 'lowpass'; this.filt.frequency.value = 500; this.filt.Q.value = 3;
      this.gain = this.ctx.createGain(); this.gain.gain.value = 0;
      this.osc.connect(this.filt); this.filt.connect(this.gain); this.gain.connect(this.ctx.destination);
      this.osc.start();
    } catch (e) { this.ctx = null; }
  },
  update(ratio, thr, active) {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const t = this.ctx.currentTime;
    const target = this.on && active ? 0.03 + 0.055 * thr + 0.02 * ratio : 0;
    this.gain.gain.setTargetAtTime(target, t, 0.07);
    this.osc.frequency.setTargetAtTime(72 + ratio * 250 + thr * 45, t, 0.05);
    this.filt.frequency.setTargetAtTime(380 + ratio * 2600, t, 0.08);
  }
};

/* ----------------------------------------------------------------- 更新 */
function update(dt) {
  race.time += dt;
  race.lapTime += dt;

  const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
  const rx = -fy, ry = fx;
  let vf = car.vx * fx + car.vy * fy;   // 前向速度
  let vl = car.vx * rx + car.vy * ry;   // 侧向速度

  // 转向（速度越快转角越小，倒车反向）
  const speedAbs = Math.abs(vf);
  car.steer = lerp(car.steer, input.steer, clamp(dt * 10, 0, 1));
  const turnScale = (1 - 0.45 * clamp(speedAbs / MAXSPEED, 0, 1)) * Math.min(1, speedAbs / 90);
  car.angle += car.steer * TURN_RATE * turnScale * (vf < -5 ? -1 : 1) * dt;

  // 油门 / 刹车
  if (input.throttle > 0) vf += input.throttle * ENGINE * (1 - Math.max(0, vf) / MAXSPEED) * dt;
  if (input.brake > 0) {
    if (vf > 8) vf -= input.brake * BRAKE_F * dt;
    else vf -= input.brake * REVERSE * dt;
  }
  // 阻力
  vf -= vf * (car.off ? DRAG_GRASS : DRAG_ROAD) * dt;
  // 手刹：掉速 + 抓地骤降（甩尾）
  let grip = car.off ? GRIP_GRASS : GRIP_ROAD;
  if (input.hand) { grip *= 0.22; vf -= vf * 1.3 * dt; }
  vf = clamp(vf, -220, MAXSPEED);
  vl *= Math.exp(-grip * dt);

  car.vx = fx * vf + rx * vl;
  car.vy = fy * vf + ry * vl;
  car.x += car.vx * dt;
  car.y += car.vy * dt;

  // 赛道判定 + 护栏
  const near = nearestIndex(car.x, car.y, false);
  lastIdx = near.i;
  let d = lateralDist(car.x, car.y, near.i);
  car.off = d > HALF_W;
  car.dist = d;
  if (d > WALL) {
    // 沿法线拉回，损失速度
    const inward = Math.sign(
      (car.x - PATH[near.i][0]) * NRM[near.i][0] + (car.y - PATH[near.i][1]) * NRM[near.i][1]
    ) || 1;
    const nx = -NRM[near.i][0] * inward, ny = -NRM[near.i][1] * inward;
    const cx = PATH[near.i][0] + NRM[near.i][0] * WALL * inward;
    const cy = PATH[near.i][1] + NRM[near.i][1] * WALL * inward;
    car.x = cx; car.y = cy;
    const vn = car.vx * nx + car.vy * ny;
    if (vn < 0) { car.vx -= nx * vn * 1.4; car.vy -= ny * vn * 1.4; }
    car.vx *= 0.86; car.vy *= 0.86;
    if (Math.abs(vn) > 260) toast('撞护栏！');
  }

  // ---- 检查点 / 计圈
  for (let gi = 0; gi < GATES.length; gi++) {
    let diff = Math.abs(near.i - GATES[gi]);
    diff = Math.min(diff, S - diff);
    if (diff < 12 && gi === race.expected) {
      if (gi === 0) {
        if (race.crossed) completeLap();
        race.crossed = true;
      }
      race.expected = (gi + 1) % GATES.length;
      break;
    }
  }

  // ---- 胎痕与尘土
  const slip = Math.abs(vl);
  if (speedAbs > 90 && (input.hand || slip > 70) && !car.off) {
    if (marks.length > 900) marks.shift();
    marks.push({ x: car.x - fx * 18 + rx * 12, y: car.y - fy * 18 + ry * 12, a: car.angle, life: 1 });
    marks.push({ x: car.x - fx * 18 - rx * 12, y: car.y - fy * 18 - ry * 12, a: car.angle, life: 1 });
  }
  if (car.off && speedAbs > 60) {
    if (dusts.length > 260) dusts.shift();
    dusts.push({
      x: car.x - fx * 20 + (Math.random() - .5) * 22,
      y: car.y - fy * 20 + (Math.random() - .5) * 22,
      vx: -car.vx * 0.15 + (Math.random() - .5) * 40,
      vy: -car.vy * 0.15 + (Math.random() - .5) * 40,
      r: 6 + Math.random() * 12, life: 1
    });
  }
  for (let i = marks.length - 1; i >= 0; i--) { marks[i].life -= dt * 0.06; if (marks[i].life <= 0) marks.splice(i, 1); }
  for (let i = dusts.length - 1; i >= 0; i--) {
    const p = dusts[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 0.75;
    if (p.life <= 0) dusts.splice(i, 1);
  }

  // ---- 摄像机
  const look = 0.34;
  const tx = car.x + car.vx * look, ty = car.y + car.vy * look;
  cam.x = lerp(cam.x, tx, clamp(dt * 6, 0, 1));
  cam.y = lerp(cam.y, ty, clamp(dt * 6, 0, 1));
  const targetZoom = clamp(1.05 - speedAbs / MAXSPEED * 0.4, 0.62, 1.05) * (Math.min(W, H) / 900 + 0.42);
  cam.zoom = lerp(cam.zoom, targetZoom, clamp(dt * 3, 0, 1));

  Sound.update(clamp(speedAbs / MAXSPEED, 0, 1), input.throttle, true);
  updateHUD(speedAbs);
}

function completeLap() {
  race.laps++;
  race.last = race.lapTime;
  if (race.best == null || race.lapTime < race.best) {
    race.best = race.lapTime;
    toast('第 ' + race.laps + ' 圈 · 最快圈 ' + fmtTime(race.lapTime) + ' 🏁');
  } else {
    toast('第 ' + race.laps + ' 圈 · ' + fmtTime(race.lapTime));
  }
  race.lapTime = 0;
}

/* --------------------------------------------------------------- 状态切换 */
function startRace() {
  Sound.init();
  resetCar(true);
  race.mode = 'race';
  el.overlay.classList.remove('show');
  cam.x = car.x; cam.y = car.y; cam.zoom = 1;
  toast('出发！');
}
function resumeRace() { race.mode = 'race'; el.overlay.classList.remove('show'); }
function togglePause() {
  if (race.mode === 'race') {
    race.mode = 'pause';
    document.getElementById('ovbody').innerHTML =
      '<p class="big">已暂停</p><p class="tip">按 Start / Esc / 回车 继续</p>';
    el.overlay.classList.add('show');
    Sound.update(0, 0, false);
  } else if (race.mode === 'pause') {
    resumeRace();
  }
}
function updatePadUI() {
  if (padName) {
    el.padname.textContent = '🎮 ' + padName;
    el.padname.classList.add('on');
  } else {
    el.padname.textContent = '未检测到手柄（可用键盘游玩）';
    el.padname.classList.remove('on');
  }
}
let toastTimer = null;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1600);
}
function updateHUD(speedAbs) {
  const kmh = Math.round(speedAbs / PX_PER_M * 3.6);
  el.spd.textContent = kmh;
  el.spdbar.style.width = clamp(speedAbs / MAXSPEED * 100, 0, 100) + '%';
  el.lap.textContent = race.laps;
  el.cur.textContent = fmtTime(race.lapTime);
  el.best.textContent = fmtTime(race.best);
  el.last.textContent = fmtTime(race.last);
}

/* ----------------------------------------------------------------- 渲染 */
function hash2(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function render() {
  const z = cam.zoom;
  const vw = W / z, vh = H / z;
  // 镜头旋转后，屏幕能看到的世界范围是个旋转的矩形，
  // 用它的外接正方形（半径 = 半对角线）来铺草地，保证四个角不会露空。
  const rad = CAM_HEAD_UP ? Math.hypot(vw, vh) / 2 : 0;
  const x0 = CAM_HEAD_UP ? cam.x - rad : cam.x - vw / 2;
  const y0 = CAM_HEAD_UP ? cam.y - rad : cam.y - vh / 2;
  const gw = CAM_HEAD_UP ? rad * 2 : vw;
  const gh = CAM_HEAD_UP ? rad * 2 : vh;

  // 草地
  ctx.save();
  ctx.fillStyle = '#26503a';
  ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H / 2);
  ctx.scale(z, z);
  // 让车头（car.angle 方向）对齐屏幕上方：世界旋转 -(PI/2 + angle)
  if (CAM_HEAD_UP) ctx.rotate(-car.angle - Math.PI / 2);
  ctx.translate(-cam.x, -cam.y);

  ctx.fillStyle = '#2a5a41';
  ctx.fillRect(x0 - 40, y0 - 40, gw + 80, gh + 80);
  const GRID = 150;
  for (let gx = Math.floor(x0 / GRID); gx <= Math.floor((x0 + gw) / GRID); gx++) {
    for (let gy = Math.floor(y0 / GRID); gy <= Math.floor((y0 + gh) / GRID); gy++) {
      const r = hash2(gx, gy);
      if (r > 0.45) {
        ctx.fillStyle = r > 0.78 ? 'rgba(20,60,42,.55)' : 'rgba(60,120,86,.28)';
        const rw = 26 + r * 90, rh = 18 + hash2(gy, gx) * 60;
        ctx.beginPath();
        ctx.ellipse(gx * GRID + r * 90, gy * GRID + hash2(gy + 7, gx) * 90, rw, rh, r * 3, 0, TAU);
        ctx.fill();
      }
    }
  }

  // 赛道
  const RW = HALF_W * 2;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // 路肩红白块
  ctx.setLineDash([52, 52]); ctx.lineDashOffset = 0;
  ctx.strokeStyle = '#c0392b'; ctx.lineWidth = RW + 46;
  ctx.stroke(TRACK_P);
  ctx.lineDashOffset = 52;
  ctx.strokeStyle = '#e9eef2';
  ctx.stroke(TRACK_P);
  ctx.setLineDash([]); ctx.lineDashOffset = 0;

  // 白边线 + 路面
  ctx.strokeStyle = '#eef2f6'; ctx.lineWidth = RW + 10; ctx.stroke(TRACK_P);
  ctx.strokeStyle = '#454c56'; ctx.lineWidth = RW; ctx.stroke(TRACK_P);
  ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = RW - 34; ctx.stroke(TRACK_P);

  // 中线虚线
  ctx.setLineDash([34, 52]);
  ctx.strokeStyle = 'rgba(255,255,255,.34)'; ctx.lineWidth = 5;
  ctx.stroke(TRACK_P);
  ctx.setLineDash([]);

  // 起点线（黑白格）
  drawStartLine();

  // 检查点
  for (let gi = 1; gi < GATES.length; gi++) drawGate(GATES[gi], gi === race.expected);

  // 胎痕
  ctx.strokeStyle = 'rgba(20,20,22,.5)';
  ctx.lineWidth = 7; ctx.lineCap = 'butt';
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    ctx.globalAlpha = clamp(m.life, 0, 1) * 0.55;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x - Math.cos(m.a) * 12, m.y - Math.sin(m.a) * 12);
    ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.lineCap = 'round';

  // 尘土
  for (let i = 0; i < dusts.length; i++) {
    const p = dusts[i];
    ctx.globalAlpha = clamp(p.life, 0, 1) * 0.5;
    ctx.fillStyle = '#b9a37a';
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1.4 - p.life * 0.4), 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;

  drawCar();
  ctx.restore();

  if (race.mode !== 'menu') drawMinimap();
}

function drawStartLine() {
  const c = PATH[0], d = DIR[0], n = NRM[0];
  const a = Math.atan2(d[1], d[0]);
  const cols = 8, cell = (HALF_W * 2) / cols;
  ctx.save();
  ctx.translate(c[0], c[1]);
  ctx.rotate(a);
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < cols; i++) {
      ctx.fillStyle = ((i + s) % 2 === 0) ? '#f2f5f8' : '#20242b';
      ctx.fillRect(-14 + s * 14, -HALF_W + i * cell, 14, cell);
    }
  }
  ctx.restore();
}
function drawGate(idx, active) {
  const c = PATH[idx], d = DIR[idx];
  const a = Math.atan2(d[1], d[0]);
  ctx.save();
  ctx.translate(c[0], c[1]); ctx.rotate(a);
  ctx.fillStyle = active ? 'rgba(78,227,155,.30)' : 'rgba(255,255,255,.08)';
  ctx.fillRect(-6, -HALF_W, 12, HALF_W * 2);
  if (active) {
    ctx.fillStyle = 'rgba(78,227,155,.85)';
    ctx.fillRect(-6, -HALF_W, 12, 26);
    ctx.fillRect(-6, HALF_W - 26, 12, 26);
  }
  ctx.restore();
}

function drawCar() {
  const L = 66, Wd = 34;
  const steerAng = car.steer * 0.42;
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);

  // 影子
  ctx.fillStyle = 'rgba(0,0,0,.32)';
  roundRect(ctx, -L / 2 + 4, -Wd / 2 + 6, L, Wd, 9); ctx.fill();

  // 轮子
  ctx.fillStyle = '#15181c';
  const wheel = (wx, wy, ang) => {
    ctx.save(); ctx.translate(wx, wy); ctx.rotate(ang);
    roundRect(ctx, -10, -5, 20, 10, 3); ctx.fill(); ctx.restore();
  };
  wheel(-19, -Wd / 2 - 1, 0);
  wheel(-19, Wd / 2 + 1, 0);
  wheel(19, -Wd / 2 - 1, steerAng);
  wheel(19, Wd / 2 + 1, steerAng);

  // 车身
  const g = ctx.createLinearGradient(0, -Wd / 2, 0, Wd / 2);
  g.addColorStop(0, '#ff6b6b');
  g.addColorStop(0.55, '#e63946');
  g.addColorStop(1, '#a4161a');
  ctx.fillStyle = g;
  roundRect(ctx, -L / 2, -Wd / 2, L, Wd, 10); ctx.fill();

  // 座舱
  ctx.fillStyle = 'rgba(18,26,38,.92)';
  roundRect(ctx, -6, -Wd / 2 + 5, 20, Wd - 10, 5); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.22)';
  roundRect(ctx, -3, -Wd / 2 + 6, 6, Wd - 12, 3); ctx.fill();

  // 尾翼
  ctx.fillStyle = '#22262c';
  roundRect(ctx, -L / 2 - 5, -Wd / 2 + 1, 7, Wd - 2, 3); ctx.fill();

  // 前灯
  ctx.fillStyle = '#ffe9a8';
  roundRect(ctx, L / 2 - 7, -Wd / 2 + 4, 6, 6, 2); ctx.fill();
  roundRect(ctx, L / 2 - 7, Wd / 2 - 10, 6, 6, 2); ctx.fill();

  ctx.restore();
}

function drawMinimap() {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i < S; i++) {
    if (PATH[i][0] < minx) minx = PATH[i][0];
    if (PATH[i][1] < miny) miny = PATH[i][1];
    if (PATH[i][0] > maxx) maxx = PATH[i][0];
    if (PATH[i][1] > maxy) maxy = PATH[i][1];
  }
  const pw = 190, ph = 140;
  const ox = W - pw - 24, oy = H - ph - 24;
  const sc = Math.min((pw - 22) / (maxx - minx), (ph - 22) / (maxy - miny));
  const cxm = (minx + maxx) / 2, cym = (miny + maxy) / 2;

  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = 'rgba(14,18,26,.62)';
  roundRect(ctx, ox, oy, pw, ph, 14); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1; ctx.stroke();

  const map = (x, y) => [ox + pw / 2 + (x - cxm) * sc, oy + ph / 2 + (y - cym) * sc];
  ctx.beginPath();
  for (let i = 0; i < S; i += 2) {
    const p = map(PATH[i][0], PATH[i][1]);
    i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
  ctx.strokeStyle = 'rgba(255,255,255,.55)';
  ctx.lineWidth = Math.max(3, HALF_W * 2 * sc);
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.strokeStyle = 'rgba(120,200,255,.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const g0 = map(PATH[0][0], PATH[0][1]);
  ctx.fillStyle = '#4ee39b';
  ctx.beginPath(); ctx.arc(g0[0], g0[1], 3.5, 0, TAU); ctx.fill();

  // 自车：小箭头指出车头朝向（小地图固定北朝上，方便对照整条赛道）
  const c = map(car.x, car.y);
  const hx = Math.cos(car.angle), hy = Math.sin(car.angle);
  ctx.fillStyle = '#ff5f6d';
  ctx.beginPath();
  ctx.moveTo(c[0] + hx * 8, c[1] + hy * 8);
  ctx.lineTo(c[0] - hx * 4 - hy * 5, c[1] - hy * 4 + hx * 5);
  ctx.lineTo(c[0] - hx * 4 + hy * 5, c[1] - hy * 4 - hx * 5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.restore();
}

/* ----------------------------------------------------------------- 主循环 */
let last = 0;
function frame(now) {
  const dt = Math.min((now - last) / 1000 || 0, 0.05);
  last = now;
  readInput(dt);
  if (race.mode === 'race') update(dt);
  else {
    Sound.update(0, 0, false);
    updateHUD(Math.hypot(car.vx, car.vy));
  }
  render();
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------- 启动 */
/* 调试 / 自动化测试钩子（浏览器控制台里也能用，例如 __racer.race.laps） */
window.__racer = { car, race, input, keys, PATH, S, GATES, HALF_W, startRace, resetCar, togglePause };

(resetCar(true), cam.x = car.x, cam.y = car.y);
updatePadUI();
requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });

})();
