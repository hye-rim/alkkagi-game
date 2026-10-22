'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (arcade/public/tutorial.js 가 듣는다. 튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 알까기: 화면·입력·소리·온라인. 규칙·물리·컴퓨터 상대는 logic.js (LOGIC_ALKKAGI), 방·매칭은 server.js
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
const ONLINE_KEY = 'alkkagiOnline', SESSION_KEY = 'alkkagiSession';
const loadJson = (k) => { try { return JSON.parse(store.get(k)) || {}; } catch (_) { return {}; } };
function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (_) { return null; } }
function saveSession(s) { try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch (_) {} }
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const myName = () => store.get('alkkagiName') || '';

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
  found: () => seq([523, 784], 90, 'triangle', 0.08),
  win: () => seq([523, 659, 784, 1047], 110, 'triangle', 0.1),
  lose: () => seq([392, 330, 262, 196], 150, 'sawtooth', 0.06),
};
function toggleMute() { muted = !muted; store.set('alkkagiMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 상태 ----------
let st = L.newGame();             // 화면에 그리는 판 (온라인에서는 서버가 보낸 판, 샷을 재생하는 동안은 재생 중인 판)
let ui = 'title';                 // title · play · over (온라인 메뉴·대기 화면도 title 처럼 판 위에 창을 띄운다)
let mode = 'cpu', level = 'normal';
let drag = null;                  // { id, x, y } 끄는 중인 내 알과 손가락 위치(판 좌표)
let cpuAt = 0;                    // 컴퓨터가 칠 시각
let rings = [], splashes = [];
// 온라인
let room = null;                  // 서버가 보낸 방
let replaying = false;            // 서버가 보낸 샷을 재생하는 중
let seenShot = 0;                 // 재생한 마지막 샷 번호
let pending = false;              // 내 샷을 보내고 서버 답을 기다리는 중
let turnEnd = 0, netDown = false, recorded = '';
const cpuTurn = () => mode === 'cpu' && st.turn === WHITE;
const sideName = (s) => (s === BLACK ? '흑' : '백');
const mySide = () => (mode === 'online' ? (room ? room.you : -1) : mode === 'cpu' ? BLACK : st.turn);
// 지금 내가 알을 잡아 튕길 수 있는가
function canShoot() {
  if (ui !== 'play' || st.phase !== 'aim') return false;
  if (mode === 'online') return !!room && room.state === 'playing' && room.turn === room.you && !pending && !replaying && !netDown;
  return !cpuTurn();
}

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
  if (!s) return;
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
function topLabel(text) {
  ctx.font = `${16 * K}px Jua, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 5 * K / 2; ctx.strokeStyle = INK; ctx.fillStyle = '#fff';
  ctx.strokeText(text, X(B / 2), Y(-8) + 4); ctx.fillText(text, X(B / 2), Y(-8) + 4);
}
function draw(now) {
  drawBoard();
  for (const r of rings) { ctx.strokeStyle = `rgba(255,255,255,${1 - r.t / 0.3})`; ctx.lineWidth = 3 * K / 2; ctx.beginPath(); ctx.arc(X(r.x), Y(r.y), (R + r.t * 60) * K, 0, Math.PI * 2); ctx.stroke(); }
  const myAim = canShoot();
  for (const s of st.stones) if (s.alive) drawStone(s, myAim && s.side === mySide() && (!drag || drag.id === s.id) && Math.sin(now / 200) > -0.2);
  // 떨어지는 알: 판 밖으로 작아지며 사라진다
  for (const f of splashes) {
    const k = f.t / 0.6;
    ctx.globalAlpha = 1 - k;
    drawStone({ x: f.x + f.dx * k * 20, y: f.y + f.dy * k * 20, side: f.side }, false);
    ctx.globalAlpha = 1;
  }
  drawAim();
  if (ui === 'play' && cpuTurn() && st.phase === 'aim') topLabel('🤖 생각 중…');
  if (mode === 'online' && ui === 'play' && room && room.state === 'playing' && !replaying && st.phase === 'aim') {
    if (netDown) topLabel('📡 다시 연결하는 중…');
    else if (room.turn !== room.you) topLabel('상대 차례…');
  }
}

const opponent = () => (room ? room.players.find((p) => p.color !== room.you) : null);
function updateHud() {
  $('blackLeft').textContent = L.alive(st, BLACK).length;
  $('whiteLeft').textContent = L.alive(st, WHITE).length;
  let t;
  if (mode === 'online' && room && room.state === 'playing') {
    const sec = Math.max(0, Math.ceil((turnEnd - performance.now()) / 1000));
    const me = room.turn === room.you;
    const opp = opponent();
    t = me ? `${room.you === BLACK ? '⚫' : '⚪'} 내 차례 · ${sec}초` : `${opp ? esc(opp.name) : '상대'} 차례 · ${sec}초${opp && !opp.online ? ' (끊김)' : ''}`;
  } else if (mode === 'online' && room && room.state === 'over') t = room.winner === room.you ? '승리!' : '패배';
  else if (st.phase === 'over') t = `${sideName(st.winner)} 승리!`;
  else if (mode === 'cpu') t = st.turn === BLACK ? '⚫ 내 차례' : '⚪ 컴퓨터 차례';
  else t = `${st.turn === BLACK ? '⚫' : '⚪'} ${sideName(st.turn)} 차례`;
  $('turn').innerHTML = t;
  $('resignBtn').style.display = mode === 'online' && room && room.state === 'playing' ? '' : 'none';
  $('hint').textContent = ui !== 'play' ? '' : canShoot() ? '내 알을 뒤로 끌었다 놓으면 튕겨요 · 많이 끌수록 세게' : '';
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
    } else if (mode === 'online') continue;                     // 차례·승패는 서버가 정한다
    else if (e.type === 'turn') { if (cpuTurn()) cpuAt = performance.now() + 700; }
    else if (e.type === 'over') setTimeout(showOver, 700);
  }
  updateHud();
}
let last = performance.now(), hudAt = 0, replayAcc = 0;
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  if (ui === 'play') {
    if (st.phase === 'moving' && replaying) {
      // 서버와 똑같이 1/60초씩 굴려야 끝 자리가 서버 결과와 딱 맞는다
      replayAcc += dt;
      while (replayAcc >= 1 / 60 && st.phase === 'moving') { L.step(st, 1 / 60); replayAcc -= 1 / 60; }
    } else if (st.phase === 'moving') L.step(st, dt);
    else if (st.phase === 'aim' && cpuTurn() && now >= cpuAt) {
      const m = L.aiChoose(st, level);
      if (m) L.shoot(st, m.id, m.vx, m.vy);
    }
    if (st.events.length) handleEvents();
    if (replaying && st.phase !== 'moving') finishReplay();
  }
  if (mode === 'online' && now - hudAt > 250) { hudAt = now; updateHud(); }
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
  // 판 보기 중에 누르면 결과창으로 돌아간다
  if (mode === 'online' && room && room.state === 'over' && !overlayOpen()) { showResult(); return; }
  if (!canShoot()) return;
  const p = boardPt(e);
  let pick = null, bd = (R + 12) ** 2;                  // 손가락이 알보다 조금 커도 잡히게
  for (const s of L.alive(st, mySide())) { const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2; if (d < bd) { bd = d; pick = s; } }
  if (!pick) return;
  drag = { id: pick.id, x: p.x, y: p.y };
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
});
canvas.addEventListener('pointermove', (e) => { if (drag) { const p = boardPt(e); drag.x = p.x; drag.y = p.y; } });
function release() {
  if (!drag) return;
  const s = st.stones.find((x) => x.id === drag.id);
  const v = s && L.dragToVelocity(drag.x - s.x, drag.y - s.y, MAX_DRAG);
  const id = drag.id;
  drag = null;
  if (!v || !canShoot()) return;
  if (mode === 'online') { pending = true; tutorialSignal('shoot'); net.send('shoot', { id, vx: v.vx, vy: v.vy }); updateHud(); return; }
  if (L.shoot(st, id, v.vx, v.vy)) { tutorialSignal('shoot'); handleEvents(); }
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', () => { drag = null; });

// ---------- 창 ----------
const overlayOpen = () => !$('overlay').classList.contains('hidden');
function showOverlay(html) { $('overlay').innerHTML = html; $('overlay').classList.remove('hidden'); }
function hideOverlay() { $('overlay').classList.add('hidden'); }

// ---------- 컴퓨터·둘이서 ----------
function start(m, lv) {
  leaveOnline();
  mode = m; level = lv || level;
  st = L.newGame({ mode, level });
  ui = 'play'; drag = null; rings = []; splashes = [];
  hideOverlay();
  updateHud();
}
function showOver() {
  ui = 'over';
  const meWin = mode === 'cpu' && st.winner === BLACK;
  if (meWin) { wins[level]++; store.set(WIN_KEYS[level], String(wins[level])); store.set('alkkagiWins', String(totalWins())); }
  (mode === 'two' || meWin ? sfx.win : sfx.lose)();
  const title = mode === 'two' ? `${sideName(st.winner)} 승리! 🏆` : meWin ? '이겼어요! 🎉' : '졌어요 😵';
  showOverlay(`
    <h2>${title}</h2>
    <p>남은 알 ⚫ ${L.alive(st, BLACK).length} · ⚪ ${L.alive(st, WHITE).length} · ${st.shots}수</p>
    ${mode === 'cpu' ? `<span class="tag">${L.LEVELS[level].name} 상대 ${wins[level]}승</span>` : ''}
    <div class="col"><button data-act="again">한 판 더</button><button class="sub" data-act="home">처음으로</button></div>`);
}
function showTitle() {
  leaveOnline();
  ui = 'title'; mode = 'cpu';
  st = L.newGame();
  updateHud();
  const w = (lv) => (wins[lv] ? ` · ${wins[lv]}승` : '');
  const on = loadJson(ONLINE_KEY);
  showOverlay(`
    <h1>알까기</h1>
    <p>내 알을 <b>뒤로 끌었다 놓아</b> 튕겨요<br>상대 알을 판 밖으로 다 떨어뜨리면 이겨요!</p>
    <div class="col">
      <button data-act="cpu" data-lv="easy">🤖 컴퓨터랑 · 쉬움<small>나는 흑(먼저)${w('easy')}</small></button>
      <div class="row"><button class="sub" data-act="cpu" data-lv="normal">🤖 보통${w('normal')}</button><button class="sub" data-act="cpu" data-lv="hard">🤖 어려움${w('hard')}</button></div>
      <button class="sub" data-act="online">🌐 온라인 대전${on.w || on.l ? ` · ${on.w || 0}승 ${on.l || 0}패` : ''}</button>
      <button class="sub" data-act="two">👥 둘이서 (한 화면 번갈아)</button>
    </div>`);
}

// ---------- 온라인: 연결 ----------
const net = {
  ws: null, pulse: null, outbox: [], retry: 0,
  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}${location.pathname}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.raw('hello', { name: myName() });
      const s = loadSession();
      if (s) this.raw('resume', s);
      for (const [t, p] of this.outbox.splice(0)) this.raw(t, p);
      clearInterval(this.pulse);
      // 프록시가 WebSocket ping 을 대신 받아버리는 환경이 있어 살아있다는 신호를 직접 보낸다
      this.pulse = setInterval(() => this.raw('pulse'), 10000);
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onNet(m); };
    ws.onclose = () => {
      clearInterval(this.pulse);
      if (this.ws !== ws) return;   // 일부러 닫은 연결
      this.ws = null;
      if (mode !== 'online') return;
      if (room || loadSession()) {
        // 대국 중이면 계속 다시 붙어본다. 서버는 30초 동안 자리를 비워둔다.
        netDown = true; pending = false; updateHud();
        setTimeout(() => { if (mode === 'online') this.connect(); }, Math.min(4000, 500 * 2 ** this.retry++));
      } else showOnline('서버와 연결이 끊겼어요. 다시 시도해 주세요.');
    };
  },
  send(t, p = {}) {
    if (this.ws && this.ws.readyState === 1) this.raw(t, p);
    else { this.outbox.push([t, p]); this.connect(); }
  },
  raw(t, p = {}) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t, ...p })); },
  close() {
    const ws = this.ws;
    this.ws = null; this.outbox = [];
    clearInterval(this.pulse);
    if (ws) ws.close();
  },
};

function onNet(m) {
  if (m.t === 'queued') showQueued();
  else if (m.t === 'room') applyRoom(m);
  else if (m.t === 'error') { room = null; saveSession(null); showOnline(m.msg); }
  else if (m.t === 'resumeFailed') {
    saveSession(null);
    if (room) { room = null; showOnline('대국이 끝나서 이어갈 수 없어요.'); }
    netDown = false; updateHud();
  }
}

function leaveOnline() {
  if (mode !== 'online') return;
  net.send('leave'); net.close();
  saveSession(null);
  room = null; netDown = false; pending = false; replaying = false;
}

// 서버가 보낸 알 위치로 판을 맞춘다
function boardFromRoom(r) {
  const g = L.newGame({ mode: 'online' });
  g.stones = r.stones.map((s) => ({ ...s, vx: 0, vy: 0 }));
  g.turn = r.turn;
  g.shots = r.shots;
  g.phase = r.state === 'playing' ? 'aim' : 'over';
  g.winner = r.winner;
  return g;
}
function finishReplay() {
  replaying = false;
  st = boardFromRoom(room);                         // 재생이 끝나면 서버가 정한 자리로 정확히 맞춘다
  afterRoom();
}

// ---------- 온라인: 대국 ----------
function applyRoom(r) {
  const fresh = !room || room.code !== r.code;
  const newGame = r.state === 'playing' && (!room || room.state !== 'playing' || r.shots < room.shots);
  room = r;
  netDown = false; pending = false;
  saveSession({ code: r.code, token: r.token });
  turnEnd = performance.now() + r.remain;
  if (newGame || fresh) seenShot = r.shot ? r.shot.seq : 0;
  if (r.state === 'waiting') { ui = 'title'; st = boardFromRoom(r); showWaiting(); return; }
  ui = 'play';
  if (newGame) { sfx.found(); recorded = ''; rings = []; splashes = []; drag = null; }
  // 새 샷이 왔으면 샷 직전 판에서 같은 물리로 재생한다 (끝나면 finishReplay 가 서버 결과로 맞춘다)
  if (r.shot && r.shot.seq > seenShot && !fresh) {
    seenShot = r.shot.seq;
    const g = boardFromRoom(r);
    g.stones = r.shot.from.map((s) => ({ ...s, vx: 0, vy: 0 }));
    g.phase = 'aim';
    g.turn = (g.stones.find((s) => s.id === r.shot.id) || {}).side;
    if (L.shoot(g, r.shot.id, r.shot.vx, r.shot.vy)) { st = g; replaying = true; replayAcc = 0; drag = null; hideOverlay(); updateHud(); return; }
  }
  if (!replaying) { st = boardFromRoom(r); afterRoom(); }
}
// 재생이 없거나 끝난 뒤: 창·기록
function afterRoom() {
  const r = room;
  if (!r) return;
  if (r.state === 'playing') { if (!overlayOpen() || ui !== 'play' || $('overlay').dataset.screen !== 'confirm') hideOverlay(); }
  else if (r.state === 'over') {
    const key = `${r.code}:${r.shots}:${r.reason}:${r.winner}`;
    if (recorded !== key) {
      recorded = key;
      const rec = loadJson(ONLINE_KEY);
      if (r.winner === r.you) { rec.w = (rec.w || 0) + 1; sfx.win(); } else { rec.l = (rec.l || 0) + 1; sfx.lose(); }
      store.set(ONLINE_KEY, JSON.stringify(rec));
      setTimeout(() => { if (room && room.state === 'over') showResult(); }, 600);
    } else if (overlayOpen()) showResult();
  }
  updateHud();
}

function showResult() {
  const r = room, opp = opponent();
  const won = r.winner === r.you;
  const why = {
    knockout: won ? '상대 알을 다 떨어뜨렸어요!' : '내 알이 다 떨어졌어요',
    resign: won ? '상대가 기권했어요' : '기권했어요',
    timeout: won ? '상대가 시간을 넘겼어요' : '시간을 넘겼어요',
    left: won ? '상대가 나갔어요' : '연결이 끊겨 패배했어요',
  }[r.reason] || '';
  const rec = loadJson(ONLINE_KEY);
  const iVoted = r.rematch.includes(r.you), theyVoted = opp && r.rematch.includes(opp.color);
  let again;
  if (!opp) again = '<p>상대가 방을 나갔어요</p>';
  else if (iVoted) again = '<p>상대를 기다리는 중…</p>';
  else again = `${theyVoted ? '<p>상대가 한 판 더 하고 싶어해요!</p>' : ''}<button data-act="rematch">한 판 더</button>`;
  showOverlay(`
    <h2>${won ? '🎉 승리!' : '😵 패배'}</h2>
    ${why ? `<p>${why}</p>` : ''}
    <span class="tag">온라인 ${rec.w || 0}승 ${rec.l || 0}패</span>
    <div class="col">${again}
      <div class="row"><button class="sub" data-act="view">판 보기</button><button class="sub" data-act="leave">나가기</button></div>
    </div>`);
}

function showOnline(error = '') {
  leaveOnline();
  mode = 'online'; ui = 'title'; room = null;
  st = L.newGame(); updateHud();
  showOverlay(`
    <h2>🌐 온라인 대전</h2>
    <input id="nameInput" maxlength="10" placeholder="내 이름 (최대 10자)" value="${esc(myName())}" autocomplete="off">
    <div class="col">
      <button data-act="quick">⚡ 빠른 대전</button>
      <button class="sub" data-act="create">방 만들기</button>
      <div class="row join"><input id="codeInput" maxlength="4" placeholder="방 코드" autocomplete="off" autocapitalize="characters"><button class="sub" data-act="join">들어가기</button></div>
    </div>
    <span class="error">${esc(error)}</span>
    <button class="back" data-act="home">← 처음으로</button>
    <p style="font-size:12.5px">한 수에 30초 · 흑·백은 한 판마다 바뀌어요</p>`);
}
function showQueued() {
  showOverlay(`
    <h2>상대를 찾는 중…</h2>
    <div class="dots"><span></span><span></span><span></span></div>
    <p>누군가 빠른 대전을 누르면 바로 시작해요</p>
    <button class="sub" data-act="cancel">취소</button>`);
}
const inviteUrl = () => `${location.origin}${location.pathname}?room=${room.code}`;
function showWaiting() {
  showOverlay(`
    <h2>친구를 기다리는 중…</h2>
    <p>방 코드</p>
    <div class="code">${esc(room.code)}</div>
    <p>친구가 <b>온라인 대전 → 들어가기</b>에<br>이 코드를 넣으면 시작해요</p>
    <button data-act="copy">🔗 초대 링크 복사</button>
    <button class="sub" data-act="cancel">취소</button>`);
}
function saveName() {
  const input = $('nameInput');
  if (!input) return;
  const name = input.value.trim().slice(0, 10);
  store.set('alkkagiName', name);
  net.send('hello', { name });
}
function confirmResign() {
  showOverlay(`<h2>기권할까요?</h2><p>이번 판은 패배로 기록돼요</p>
    <div class="row"><button data-act="close">계속하기</button><button class="sub" data-act="resign">🏳 기권</button></div>`);
  $('overlay').dataset.screen = 'confirm';
}

$('overlay').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  btn.blur();
  $('overlay').dataset.screen = '';
  const act = btn.dataset.act;
  if (act === 'cpu') start('cpu', btn.dataset.lv);
  else if (act === 'two') start('two');
  else if (act === 'again') start(mode, level);
  else if (act === 'home') showTitle();
  else if (act === 'online') showOnline();
  else if (act === 'quick') { saveName(); net.send('quick'); }
  else if (act === 'create') { saveName(); net.send('create'); }
  else if (act === 'join') {
    const code = ($('codeInput').value || '').trim().toUpperCase();
    if (code.length !== 4) { $('overlay').querySelector('.error').textContent = '방 코드 4자리를 넣어 주세요.'; return; }
    saveName();
    net.send('join', { code });
  } else if (act === 'cancel') { net.send('cancel'); showOnline(); }
  else if (act === 'copy') {
    const url = inviteUrl();
    const done = () => { btn.textContent = '✅ 복사했어요'; setTimeout(() => { btn.textContent = '🔗 초대 링크 복사'; }, 1500); };
    if (navigator.share && matchMedia('(pointer: coarse)').matches) navigator.share({ title: '알까기 한 판 해요!', url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('링크를 복사하세요', url));
    else prompt('링크를 복사하세요', url);
  } else if (act === 'rematch') { net.send('rematch'); }
  else if (act === 'view') hideOverlay();
  else if (act === 'leave') showOnline();
  else if (act === 'resign') { net.send('resign'); hideOverlay(); }
  else if (act === 'close') hideOverlay();
});
$('overlay').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'codeInput') $('overlay').querySelector('[data-act="join"]').click();
  if (e.target.id === 'nameInput') $('overlay').querySelector('[data-act="quick"]').click();
  e.stopPropagation();
});
$('resignBtn').onclick = (e) => { e.currentTarget.blur(); if (mode === 'online' && room && room.state === 'playing') confirmResign(); };
addEventListener('keydown', (e) => { if (e.target.tagName !== 'INPUT' && e.code === 'KeyM') toggleMute(); });

// ---------- 시작 ----------
// 초대 링크(?room=CODE)로 들어왔거나, 새로고침 전에 하던 대국이 있으면 온라인으로 바로 간다
const invite = new URLSearchParams(location.search).get('room');
if (invite) { try { window.history.replaceState(null, '', location.pathname); } catch (_) {} }
function joinInvite(code) { showOnline(); net.send('join', { code: code.toUpperCase() }); }
if (loadSession()) {
  mode = 'online';
  showOverlay('<h2>대국으로 돌아가는 중…</h2>');
  net.connect();
  const until = setInterval(() => {
    if (room || !loadSession()) { clearInterval(until); if (!room) invite ? joinInvite(invite) : showOnline(); }
  }, 100);
} else if (invite) joinInvite(invite);
else showTitle();
updateHud();
requestAnimationFrame(frame);

/* @test-hooks:start */
window.__ak = { get st() { return st; }, get ui() { return ui; }, get room() { return room; }, get replaying() { return replaying; }, get mode() { return mode; }, start, release, canShoot, setDrag: (d) => { drag = d; } };
/* @test-hooks:end */
})();
