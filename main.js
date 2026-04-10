// migiwa — yosui
// ─────────────────────────────────────────────────────────────

// ─── Canvas setup ────────────────────────────────────────────
const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');

// Offscreen canvas at 1/4 resolution for performance
const off  = document.createElement('canvas');
const octx = off.getContext('2d');

let imgData = null;

function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  off.width  = Math.ceil(canvas.width  / 4);
  off.height = Math.ceil(canvas.height / 4);
  imgData = null; // reset on resize
}
resize();
window.addEventListener('resize', resize);

// ─── Fluid noise (sum of sines) ───────────────────────────────
// x, y in screen pixels; t in seconds
function fluidNoise(x, y, t) {
  // 2. 不均一さ: 位置ごとに速さのムラを出す低周波マスク（0.7〜1.3）
  const localSpeed = 1.0 + Math.sin(x * 0.0015 + y * 0.001) * 0.3;
  const tl = t * localSpeed;

  // 1. 規則性を崩す: 各項の周波数をわずかにずらした素数的な係数にする
  return Math.sin(x * 0.00613 + tl * 0.503)
       + Math.sin(y * 0.00791 + tl * 0.397)
       + Math.sin(x * 0.01193 + y * 0.00973 + tl * 0.709) * 0.60
       + Math.sin((x - y)     * 0.00511     + tl * 0.298) * 0.80
       + Math.sin(x * 0.01973 + y * 0.01511 + tl * 1.097) * 0.30;
}
const NOISE_RANGE = 3.7; // approximate max absolute value

// ─── HSL → RGB ────────────────────────────────────────────────
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [f(0) * 255 | 0, f(8) * 255 | 0, f(4) * 255 | 0];
}

// ─── Turbulence state ─────────────────────────────────────────
let turb       = 1.0;
let turbTarget = 1.0;
let turbTimer  = 18000; // first disturbance after 18s of calm

function updateTurb(dt) {
  turbTimer -= dt;
  if (turbTimer <= 0) {
    if (turbTarget <= 1.0) {
      // spike: flow gets faster and more turbid
      turbTarget = 1.8 + Math.random() * 1.4;
      turbTimer  = 4000 + Math.random() * 5000;
    } else {
      // return to calm
      turbTarget = 1.0;
      turbTimer  = 12000 + Math.random() * 20000;
    }
  }
  turb += (turbTarget - turb) * 0.0015; // slow lerp
}

// ─── Ripples ──────────────────────────────────────────────────
const ripples = [];

function addRipple(x, y) {
  ripples.push({ x, y, r: 2, alpha: 0.55 });
}

function drawRipples() {
  for (let i = ripples.length - 1; i >= 0; i--) {
    const rip = ripples[i];
    rip.r    += 2.2;
    rip.alpha -= 0.006;
    if (rip.alpha <= 0) { ripples.splice(i, 1); continue; }

    // 3. 歪んだ波紋: 角度ごとに半径をわずかにノイズで揺らす
    const drawDistortedRing = (baseR, alpha, lineWidth) => {
      const steps = 48;
      ctx.beginPath();
      for (let s = 0; s <= steps; s++) {
        const angle = (s / steps) * Math.PI * 2;
        const wobble = Math.sin(angle * 3 + rip.r * 0.05) * (baseR * 0.03)
                     + Math.sin(angle * 5 + rip.r * 0.08) * (baseR * 0.015);
        const r = baseR + wobble;
        const px = rip.x + Math.cos(angle) * r;
        const py = rip.y + Math.sin(angle) * r;
        s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(170, 220, 255, ${alpha})`;
      ctx.lineWidth   = lineWidth;
      ctx.stroke();
    };

    drawDistortedRing(rip.r, rip.alpha, 1.5);
    if (rip.r > 18) drawDistortedRing(rip.r * 0.52, rip.alpha * 0.35, 1);
  }
}

// ─── Draw fluid background ────────────────────────────────────
function drawFluid(t) {
  const w  = off.width;
  const h  = off.height;

  if (!imgData || imgData.width !== w || imgData.height !== h) {
    imgData = octx.createImageData(w, h);
  }

  const d  = imgData.data;
  const breath = 1.0 + Math.sin(t * 0.12) * 0.018; // 呼吸: 約52秒周期、±1.8%
  const ts = t * turb * 0.22 * breath;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Use screen-equivalent coords for consistent spatial frequency
      const sx = x * 4;
      const sy = y * 4;

      const raw = fluidNoise(sx, sy, ts);
      const v   = (raw / NOISE_RANGE + 1) * 0.5; // 0..1

      // 1. 減衰（深さ感）: 下に行くほど暗く・青が深くなる
      const depth = y / h; // 0（上）→ 1（下）

      // Blue palette; turbulence adds slight green warmth and brightness
      const excess = turb - 1.0;
      const hue = 208 - v * 10 + excess * 8  - depth * 8;  // 2. コントラスト: 14→10
      const sat = 60  + v * 16  + excess * 12 + depth * 6;  // 2. コントラスト: 22→16、深いほど彩度増
      const lit = 12  + v * 16  + excess * 6  - depth * 5;  // 1+4. 最大lit低下(22→16)、下へ暗く

      // 4. 微細ランダムノイズで"汚す"（±4の揺らぎ）
      const grain = (Math.random() - 0.5) * 8;
      const [r, g, b] = hslToRgb(hue, sat, lit);
      const i = (y * w + x) * 4;
      d[i]     = Math.max(0, Math.min(255, r + grain));
      d[i + 1] = Math.max(0, Math.min(255, g + grain));
      d[i + 2] = Math.max(0, Math.min(255, b + grain));
      d[i + 3] = 255;
    }
  }

  octx.putImageData(imgData, 0, 0);

  // 2. 濁り: blur フィルターで軽くぼかしてから描画
  ctx.filter = 'blur(2px)';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  ctx.filter = 'none';
}

// ─── 他者の気配（ghost ripples）────────────────────────────────
let ghostTimer = 8000 + Math.random() * 7000; // 初回: 8〜15秒後

function updateGhost(dt) {
  ghostTimer -= dt;
  if (ghostTimer > 0) return;

  const x = Math.random() * canvas.width;
  const y = Math.random() * canvas.height;
  addRipple(x, y);

  ghostTimer = 5000 + Math.random() * 10000; // 次回: 5〜15秒後
}

// ─── Main loop ────────────────────────────────────────────────
let prevTime = 0;

function loop(ts) {
  const dt = ts - prevTime;
  prevTime = ts;

  updateTurb(dt);
  updateGhost(dt);
  drawFluid(ts * 0.001);
  drawRipples();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// ─── 初回タップ要素 ───────────────────────────────────────────
// 小さな円を中央に表示し、明確なユーザー操作を受け取る
const tapDot = document.createElement('div');
tapDot.style.cssText = [
  'position:fixed',
  'top:50%', 'left:50%',
  'transform:translate(-50%,-50%)',
  'width:48px', 'height:48px',
  'border-radius:50%',
  'background:rgba(160,210,240,0.18)',
  'border:1px solid rgba(160,210,240,0.5)',
  'box-shadow:0 0 18px rgba(140,200,240,0.25)',
  'z-index:9999',
  'cursor:pointer',
  'animation:pulse 3s ease-in-out infinite',
  'transition:opacity 0.8s ease',
].join(';');
document.body.appendChild(tapDot);

// pulse アニメーション
const style = document.createElement('style');
style.textContent = '@keyframes pulse{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:0.7}50%{transform:translate(-50%,-50%) scale(1.25);opacity:1}}';
document.head.appendChild(style);

let tapDone = false;

function onTapDot(e) {
  if (tapDone) return;
  tapDone = true;

  startAudio();

  const src = e.changedTouches ? e.changedTouches[0] : e;
  addRipple(src.clientX, src.clientY);

  // フェードアウトして削除
  tapDot.style.opacity = '0';
  setTimeout(() => tapDot.remove(), 800);
}

tapDot.addEventListener('touchstart',  onTapDot, { passive: true });
tapDot.addEventListener('pointerdown', onTapDot, { passive: true });

// ─── Input（オーバーレイ消去後の通常操作）────────────────────────
canvas.addEventListener('pointerdown', e => {
  addRipple(e.clientX, e.clientY);
});

canvas.addEventListener('touchstart', e => {
  for (const t of e.changedTouches) addRipple(t.clientX, t.clientY);
}, { passive: true });

// ─── Audio ────────────────────────────────────────────────────
let audioStarted = false;

function startAudio() {
  if (audioStarted) return;
  audioStarted = true;

  // ユーザー操作の中で同期的に AudioContext を作成する（重要）
  // await を一切使わない → Chrome のジェスチャー判定から外れないようにする
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  ac.resume(); // fire-and-forget（awaitしない）

  // 同期的にほぼ無音の短いトーンを鳴らす
  // → Chrome に「ユーザー操作の瞬間に発音した」と認識させる
  const unlock = ac.createOscillator();
  const gUnlock = ac.createGain();
  gUnlock.gain.value = 0.001;
  unlock.connect(gUnlock);
  gUnlock.connect(ac.destination);
  unlock.start();
  unlock.stop(ac.currentTime + 0.01);

  // ドローン・ノイズも同期的に開始する
  // — Drone 1: fundamental ~42 Hz
  const osc1 = ac.createOscillator();
  const g1   = ac.createGain();
  osc1.type = 'sine'; osc1.frequency.value = 42; g1.gain.value = 0.055;
  osc1.connect(g1); g1.connect(ac.destination); osc1.start();

  // — Drone 2: perfect fifth (63 Hz)
  const osc2 = ac.createOscillator();
  const g2   = ac.createGain();
  osc2.type = 'sine'; osc2.frequency.value = 63; g2.gain.value = 0.028;
  osc2.connect(g2); g2.connect(ac.destination); osc2.start();

  // — Drone 3: octave (84 Hz)
  const osc3 = ac.createOscillator();
  const g3   = ac.createGain();
  osc3.type = 'sine'; osc3.frequency.value = 84; g3.gain.value = 0.012;
  osc3.connect(g3); g3.connect(ac.destination); osc3.start();

  // — White noise → lowpass (water rumble)
  const sr   = ac.sampleRate;
  const buf  = ac.createBuffer(1, sr * 5, sr);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const noiseSrc = ac.createBufferSource();
  noiseSrc.buffer = buf; noiseSrc.loop = true;

  const lpf = ac.createBiquadFilter();
  lpf.type = 'lowpass'; lpf.frequency.value = 380; lpf.Q.value = 0.7;

  const gNoise = ac.createGain();
  gNoise.gain.value = 0.016;

  noiseSrc.connect(lpf); lpf.connect(gNoise); gNoise.connect(ac.destination);
  noiseSrc.start();
}
