'use strict';

// 알까기: 화면·입력·소리. 규칙·물리·컴퓨터 상대는 logic.js (LOGIC_ALKKAGI)
(() => {
const L = LOGIC_ALKKAGI;
const { B, R, BLACK, WHITE } = L;
const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const M = 20;                                   // 판 바깥 여백 (떨어지는 알이 보이게)
const VIEW = B + M * 2;                         // 화면 논리 크기 400
const K = canvas.width / VIEW;                  // 논리 → 캔버스 배율
const INK = '#2b1d52';
const MAX_DRAG = 120;                           // 이만큼(논리 px) 끌면 가장 세게

// ---------- 저장소 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
const WIN_KEYS = { easy: 'alkkagiWinsEasy', normal: 'alkkagiWinsNormal', hard: 'alkkagiWinsHard' };
const wins = { easy: Number(store.get(WIN_KEYS.easy)) || 0, normal: Number(store.get(WIN_KEYS.normal)) || 0, hard: Number(store.get(WIN_KEYS.hard)) || 0 };
const totalWins = () => wins.easy + wins.normal + wins.hard;

// ---------- 소리 ----------
let audio = null;
let muted = store.get('alkkagiMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.09, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type = 'triangle', vol = 0.09) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.0009, type, vol), i * step));
let lastClack = 0;
const sfx = {
  shoot: () => tone(300, 0.08, 'triangle', 0.08, 200),
  clack: (power) => { const now = performance.now(); if (now - lastClack < 40) return; lastClack = now; tone(1300 + Math.random() * 300, 0.05, 'square', Math.min(0.12, 0.03 + power / 3000)); },
  fall: () => tone(500, 0.35, 'sine', 0.08, -380),
  win: () => seq([523, 659, 784, 1047], 110, 'triangle', 0.1),
  lose: () => seq([392, 330, 262, 196], 150, 'sawtooth', 0.06),
};
function toggleMute() { muted = !muted; store.set('alkkagiMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 상태 ----------
let st = L.newGame();
let ui = 'title';                 // title · play · over
let mode = 'cpu', level = 'normal';
let drag = null;                  // { id, x, y } 끄는 중인 내 알과 손가락 위치(판 좌표)
let cpuAt = 0;                    // 컴퓨터가 칠 시각
let rings = [], splashes = [];
const cpuTurn = () => mode === 'cpu' && st.turn === WHITE;
const sideName = (s) => (s === BLACK ? '흑' : '백');

// ---------- 그리기 ----------
const X = (bx) => (bx + M) * K, Y = (by) => (by + M) * K;
function drawBoard() {
  ctx.fillStyle = '#5a7bd6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const g = ctx.createLinearGradient(0, Y(0), 0, Y(B));
  g.addColorStop(0, '#f2c57c'); g.addColorStop(1, '#dca35a');
  ctx.fillStyle = g;
  ctx.fillRect(X(0), Y(0), B * K, B * K);
  // 나뭇결
  ctx.strokeStyle = 'rgba(140,80,20,.12)'; ctx.lineWidth = 2;
  for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.moveTo(X(0), Y(20 + i * 40)); ctx.bezierCurveTo(X(120), Y(10 + i * 40), X(240), Y(35 + i * 40), X(B), Y(18 + i * 40)); ctx.stroke(); }
  // 바둑판 줄 (13줄)
  ctx.strokeStyle = 'rgba(60,35,10,.55)'; ctx.lineWidth = 1.6;
  const n = 13, gap = B / (n + 1);
  for (let i = 1; i <= n; i++) {
    ctx.beginPath(); ctx.moveTo(X(gap), Y(i * gap)); ctx.lineTo(X(B - gap), Y(i * gap)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X(i * gap), Y(gap)); ctx.lineTo(X(i * gap), Y(B - gap)); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(60,35,10,.7)';
  for (const a of [4, 7, 10]) for (const b of [4, 7, 10]) { ctx.beginPath(); ctx.arc(X(a * gap), Y(b * gap), 3.2 * K / 2, 0, Math.PI * 2); ctx.fill(); }
  ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.strokeRect(X(0), Y(0), B * K, B * K);
}
function drawStone(s, glow) {
  const x = X(s.x), y = Y(s.y), r = R * K;
  ctx.fillStyle = 'rgba(43,29,82,.35)';
  ctx.beginPath(); ctx.ellipse(x + 2 * K, y + 3 * K, r, r * 0.9, 0, 0, Math.PI * 2); ctx.fill();
  if (glow) { ctx.fillStyle = 'rgba(255,210,63,.55)'; ctx.beginPath(); ctx.arc(x, y, r + 5 * K, 0, Math.PI * 2); ctx.fill(); }
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  if (s.side === BLACK) { g.addColorStop(0, '#6b6b78'); g.addColorStop(1, '#111'); } else { g.addColorStop(0, '#fff'); g.addColorStop(1, '#cfcbd8'); }
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 2.2 * K / 2; ctx.strokeStyle = INK; ctx.stroke();
}
function drawAim() {
  if (!drag) return;
  const s = st.stones.find((x) => x.id === drag.id);
  const v = L.dragToVelocity(drag.x - s.x, drag.y - s.y, MAX_DRAG);
  // 끈 쪽(손가락)으로 고무줄
  ctx.strokeStyle = 'rgba(43,29,82,.5)'; ctx.lineWidth = 3 * K / 2; ctx.setLineDash([6 * K, 5 * K]);
  ctx.beginPath(); ctx.moveTo(X(s.x), Y(s.y)); ctx.lineTo(X(drag.x), Y(drag.y)); ctx.stroke();
  ctx.setLineDash([]);
  if (!v) return;
  // 날아갈 쪽 화살표: 세기만큼 길게, 세면 빨갛게
  const len = 30 + v.p * 110, ux = v.vx / Math.hypot(v.vx, v.vy), uy = v.vy / Math.hypot(v.vx, v.vy);
  const ex = s.x + ux * len, ey = s.y + uy * len;
  const col = v.p > 0.85 ? '#ff4d6d' : v.p > 0.5 ? '#ffb000' : '#4cd964';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK; ctx.lineWidth = 9 * K / 2;
  ctx.beginPath(); ctx.moveTo(X(s.x + ux * (R + 3)), Y(s.y + uy * (R + 3))); ctx.lineTo(X(ex), Y(ey)); ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = 5 * K / 2; ctx.stroke();
  const a = Math.atan2(uy, ux), h = 12;
  ctx.fillStyle = col; ctx.strokeStyle = INK; ctx.lineWidth = 2.5 * K / 2;
  ctx.beginPath();
  ctx.moveTo(X(ex + Math.cos(a) * h), Y(ey + Math.sin(a) * h));
  ctx.lineTo(X(ex + Math.cos(a + 2.4) * h), Y(ey + Math.sin(a + 2.4) * h));
  ctx.lineTo(X(ex + Math.cos(a - 2.4) * h), Y(ey + Math.sin(a - 2.4) * h));
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.lineCap = 'butt';
}
function draw(now) {
  drawBoard();
  for (const r of rings) { ctx.strokeStyle = `rgba(255,255,255,${1 - r.t / 0.3})`; ctx.lineWidth = 3 * K / 2; ctx.beginPath(); ctx.arc(X(r.x), Y(r.y), (R + r.t * 60) * K, 0, Math.PI * 2); ctx.stroke(); }
  const humanAim = ui === 'play' && st.phase === 'aim' && !cpuTurn();
  for (const s of st.stones) if (s.alive) drawStone(s, humanAim && s.side === st.turn && (!drag || drag.id === s.id) && Math.sin(now / 200) > -0.2);
  // 떨어지는 알: 판 밖으로 작아지며 사라진다
  for (const f of splashes) {
    const k = f.t / 0.6;
    ctx.globalAlpha = 1 - k;
    drawStone({ x: f.x + f.dx * k * 20, y: f.y + f.dy * k * 20, side: f.side }, false);
    ctx.globalAlpha = 1;
  }
  drawAim();
  if (ui === 'play' && cpuTurn() && st.phase === 'aim') {
    ctx.font = `${16 * K}px Jua, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 5 * K / 2; ctx.strokeStyle = INK; ctx.fillStyle = '#fff';
    ctx.strokeText('🤖 생각 중…', X(B / 2), Y(-8) + 4); ctx.fillText('🤖 생각 중…', X(B / 2), Y(-8) + 4);
  }
}

function updateHud() {
  $('blackLeft').textContent = L.alive(st, BLACK).length;
  $('whiteLeft').textContent = L.alive(st, WHITE).length;
  const t = st.phase === 'over' ? `${sideName(st.winner)} 승리!` : mode === 'cpu' ? (st.turn === BLACK ? '⚫ 내 차례' : '⚪ 컴퓨터 차례') : `${st.turn === BLACK ? '⚫' : '⚪'} ${sideName(st.turn)} 차례`;
  $('turn').textContent = t;
  $('hint').textContent = ui !== 'play' ? '' : st.phase === 'aim' && !cpuTurn() ? '내 알을 뒤로 끌었다 놓으면 튕겨요 · 많이 끌수록 세게' : '';
}

// ---------- 진행 ----------
function handleEvents() {
  for (const e of st.events.splice(0)) {
    if (e.type === 'shoot') sfx.shoot();
    else if (e.type === 'clack') { sfx.clack(e.power); rings.push({ x: e.x, y: e.y, t: 0 }); }
    else if (e.type === 'fall') {
      sfx.fall();
      const d = Math.hypot(e.x - B / 2, e.y - B / 2) || 1;
      splashes.push({ x: e.x, y: e.y, dx: (e.x - B / 2) / d, dy: (e.y - B / 2) / d, side: e.side, t: 0 });
    } else if (e.type === 'turn') { if (cpuTurn()) cpuAt = performance.now() + 700; }
    else if (e.type === 'over') setTimeout(showOver, 700);
  }
  updateHud();
}
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  if (ui === 'play') {
    if (st.phase === 'moving') L.step(st, dt);
    else if (st.phase === 'aim' && cpuTurn() && now >= cpuAt) {
      const m = L.aiChoose(st, level);
      if (m) L.shoot(st, m.id, m.vx, m.vy);
    }
    if (st.events.length) handleEvents();
  }
  for (const r of rings) r.t += dt;
  rings = rings.filter((r) => r.t < 0.3);
  for (const f of splashes) f.t += dt;
  splashes = splashes.filter((f) => f.t < 0.6);
  draw(now);
  requestAnimationFrame(frame);
}

// ---------- 입력: 내 알을 잡아 뒤로 끌었다 놓기 ----------
function boardPt(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * VIEW - M, y: ((e.clientY - r.top) / r.height) * VIEW - M };
}
canvas.addEventListener('pointerdown', (e) => {
  if (ui !== 'play' || st.phase !== 'aim' || cpuTurn()) return;
  const p = boardPt(e);
  let pick = null, bd = (R + 12) ** 2;                  // 손가락이 알보다 조금 커도 잡히게
  for (const s of L.alive(st, st.turn)) { const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2; if (d < bd) { bd = d; pick = s; } }
  if (!pick) return;
  drag = { id: pick.id, x: p.x, y: p.y };
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
});
canvas.addEventListener('pointermove', (e) => { if (drag) { const p = boardPt(e); drag.x = p.x; drag.y = p.y; } });
function release() {
  if (!drag) return;
  const s = st.stones.find((x) => x.id === drag.id);
  const v = L.dragToVelocity(drag.x - s.x, drag.y - s.y, MAX_DRAG);
  const id = drag.id;
  drag = null;
  if (v && L.shoot(st, id, v.vx, v.vy)) handleEvents();
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', () => { drag = null; });

// ---------- 시작·끝 ----------
function start(m, lv) {
  mode = m; level = lv || level;
  st = L.newGame({ mode, level });
  ui = 'play'; drag = null; rings = []; splashes = [];
  $('overlay').classList.add('hidden');
  updateHud();
}
function showOver() {
  ui = 'over';
  const meWin = mode === 'cpu' && st.winner === BLACK;
  if (meWin) { wins[level]++; store.set(WIN_KEYS[level], String(wins[level])); store.set('alkkagiWins', String(totalWins())); }
  (mode === 'two' || meWin ? sfx.win : sfx.lose)();
  const title = mode === 'two' ? `${sideName(st.winner)} 승리! 🏆` : meWin ? '이겼어요! 🎉' : '졌어요 😵';
  $('overlay').innerHTML = `
    <h2>${title}</h2>
    <p>남은 알 ⚫ ${L.alive(st, BLACK).length} · ⚪ ${L.alive(st, WHITE).length} · ${st.shots}수</p>
    ${mode === 'cpu' ? `<span class="tag">${L.LEVELS[level].name} 상대 ${wins[level]}승</span>` : ''}
    <div class="col"><button id="againBtn">한 판 더</button><button id="homeBtn" class="sub">처음으로</button></div>`;
  $('overlay').classList.remove('hidden');
  $('againBtn').onclick = (e) => { e.currentTarget.blur(); start(mode, level); };
  $('homeBtn').onclick = (e) => { e.currentTarget.blur(); showTitle(); };
}
function showTitle() {
  ui = 'title';
  st = L.newGame();
  updateHud();
  const w = (lv) => (wins[lv] ? ` · ${wins[lv]}승` : '');
  $('overlay').innerHTML = `
    <h1>알까기</h1>
    <p>내 알을 <b>뒤로 끌었다 놓아</b> 튕겨요<br>상대 알을 판 밖으로 다 떨어뜨리면 이겨요!</p>
    <div class="col">
      <button id="easyBtn">🤖 컴퓨터랑 · 쉬움<small>나는 흑(먼저)${w('easy')}</small></button>
      <button id="normalBtn" class="sub">🤖 보통${w('normal')}</button>
      <button id="hardBtn" class="sub">🤖 어려움${w('hard')}</button>
      <button id="twoBtn" class="sub">👥 둘이서 (한 화면 번갈아)</button>
    </div>`;
  $('overlay').classList.remove('hidden');
  $('easyBtn').onclick = (e) => { e.currentTarget.blur(); start('cpu', 'easy'); };
  $('normalBtn').onclick = (e) => { e.currentTarget.blur(); start('cpu', 'normal'); };
  $('hardBtn').onclick = (e) => { e.currentTarget.blur(); start('cpu', 'hard'); };
  $('twoBtn').onclick = (e) => { e.currentTarget.blur(); start('two'); };
}
addEventListener('keydown', (e) => { if (e.code === 'KeyM') toggleMute(); });

showTitle();
requestAnimationFrame(frame);

/* @test-hooks:start */
window.__ak = { get st() { return st; }, get ui() { return ui; }, start, release, setDrag: (d) => { drag = d; } };
/* @test-hooks:end */
})();
