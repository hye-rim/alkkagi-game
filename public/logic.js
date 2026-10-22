'use strict';

// 알까기: 규칙·물리·컴퓨터 상대만 모아 둔 파일 (그리기·입력·소리 없음). 브라우저와 테스트(Node)가 같이 쓴다.
//
// - 바둑판 위에 흑·백이 6개씩. 흑이 먼저, 차례대로 자기 알 하나를 튕긴다(뒤로 끌었다 놓기, 많이 끌수록 세게)
// - 알은 미끄러지다 마찰로 멈추고, 알끼리는 당구공처럼 부딪힌다. 판 밖으로 나간 알은 떨어진다(내 알도)
// - 상대 알을 모두 떨어뜨리면 승리. 한 번에 둘 다 마지막 알이 떨어지면 튕긴 쪽이 진다
// - 컴퓨터는 여러 방향·세기를 미리 쳐 보고(같은 물리로 끝까지 굴려 보고) 가장 좋은 수를 고른다. 쉬울수록 덜 보고 손이 떨린다
const LOGIC_ALKKAGI = (() => {
const B = 360;                     // 판 한 변 (논리 px). 이 정사각형 밖으로 중심이 나가면 떨어진다
const R = 13;                      // 알 반지름
const PER_SIDE = 6;
const FRICTION = 260;              // 미끄러질 때 줄어드는 속도 (px/s²)
const MAX_SPEED = 520;             // 가장 세게 튕긴 속도 (px/s): 혼자 미끄러지면 약 520px (판 한 변 반쯤 더)
const RESTITUTION = 0.92;          // 부딪힐 때 남는 힘
const STOP = 4;                    // 이보다 느리면 멈춘 것으로
const SUB = 4;                     // 한 번 진행할 때 잘게 나누는 수 (빠른 알이 서로 뚫고 지나가지 않게)
const BLACK = 0, WHITE = 1;

const LEVELS = {
  easy: { name: '쉬움', angles: 16, powers: [0.45, 0.7], aimNoise: 0.12, powerNoise: 0.18 },
  normal: { name: '보통', angles: 36, powers: [0.4, 0.6, 0.85], aimNoise: 0.045, powerNoise: 0.08 },
  hard: { name: '어려움', angles: 72, powers: [0.35, 0.5, 0.7, 0.9, 1], aimNoise: 0.012, powerNoise: 0.03 },
};

function rng(seed) {                                     // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 처음 배치: 흑은 아래쪽 두 줄, 백은 위쪽 두 줄 (3개씩, 줄마다 엇갈리게)
function setup() {
  const stones = [];
  const rows = [[B * 0.78, [B * 0.3, B * 0.5, B * 0.7]], [B * 0.9, [B * 0.4, B * 0.6, B * 0.2]]];
  let id = 0;
  for (const side of [BLACK, WHITE]) {
    for (const [y, xs] of rows) for (const x of xs) {
      stones.push({ id: id++, side, x, y: side === BLACK ? y : B - y, vx: 0, vy: 0, alive: true });
    }
  }
  return stones;
}

function newGame(opts = {}) {
  return {
    mode: opts.mode || 'cpu', level: opts.level || 'normal', stones: setup(), turn: BLACK, phase: 'aim',
    winner: null, shots: 0, lastShooter: null, events: [],
  };
}

const alive = (st, side) => st.stones.filter((s) => s.alive && (side === undefined || s.side === side));
const moving = (st) => st.stones.some((s) => s.alive && (s.vx || s.vy));
const offBoard = (s) => s.x < 0 || s.x > B || s.y < 0 || s.y > B;

// 튕긴다: 내 차례의 살아 있는 알을 (vx, vy) 로. 너무 센 힘은 MAX_SPEED 로 줄인다
function shoot(st, id, vx, vy) {
  const s = st.stones.find((x) => x.id === id);
  if (st.phase !== 'aim' || !s || !s.alive || s.side !== st.turn) return false;
  const sp = Math.hypot(vx, vy);
  if (sp < 1) return false;
  const k = sp > MAX_SPEED ? MAX_SPEED / sp : 1;
  s.vx = vx * k; s.vy = vy * k;
  st.phase = 'moving'; st.shots++; st.lastShooter = st.turn;
  st.events.push({ type: 'shoot', id });
  return true;
}

function collide(st, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy, min = 2 * R;
  if (d2 >= min * min || d2 === 0) return;
  const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
  // 겹친 만큼 반씩 밀어낸다
  const push = (min - d) / 2;
  a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
  const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rv >= 0) return;                                  // 이미 멀어지는 중
  const j = -(1 + RESTITUTION) * rv / 2;                // 같은 무게
  a.vx -= j * nx; a.vy -= j * ny; b.vx += j * nx; b.vy += j * ny;
  st.events.push({ type: 'clack', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, power: -rv });
}

// 진행. 모든 알이 멈추면 판정하고 차례를 넘긴다
function step(st, dt) {
  if (st.phase !== 'moving') return;
  const h = dt / SUB;
  for (let k = 0; k < SUB; k++) {
    const live = st.stones.filter((s) => s.alive);
    for (const s of live) {
      const sp = Math.hypot(s.vx, s.vy);
      if (!sp) continue;
      const ns = sp - FRICTION * h;
      if (ns <= STOP) { s.vx = 0; s.vy = 0; continue; }
      s.vx *= ns / sp; s.vy *= ns / sp;
      s.x += s.vx * h; s.y += s.vy * h;
    }
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) collide(st, live[i], live[j]);
    for (const s of live) if (offBoard(s)) { s.alive = false; st.events.push({ type: 'fall', id: s.id, side: s.side, x: s.x, y: s.y }); }
  }
  if (!moving(st)) settle(st);
}

function settle(st) {
  const b = alive(st, BLACK).length, w = alive(st, WHITE).length;
  if (!b || !w) {
    st.phase = 'over';
    st.winner = b && !w ? BLACK : w && !b ? WHITE : 1 - st.lastShooter;   // 둘 다 없으면 튕긴 쪽이 진다
    st.events.push({ type: 'over', winner: st.winner });
    return;
  }
  st.turn = 1 - st.turn;
  st.phase = 'aim';
  st.events.push({ type: 'turn', turn: st.turn });
}

// 멈출 때까지 굴린다 (컴퓨터가 수를 읽을 때, 온라인 서버, 시험). 굴린 시간(초)을 돌려준다
function runToRest(st, dt = 1 / 60, maxT = 20) {
  let t = 0;
  for (; t < maxT && st.phase === 'moving'; t += dt) step(st, dt);
  return t;
}

const clone = (st) => ({ ...st, stones: st.stones.map((s) => ({ ...s })), events: [] });

// 판 위치 점수: 가장자리에 가까운 알은 떨어지기 쉽다
const safety = (s) => Math.min(s.x, s.y, B - s.x, B - s.y);
function evaluate(st, side) {
  if (st.phase === 'over') return st.winner === side ? 1e6 : -1e6;
  let v = 0;
  for (const s of st.stones) {
    if (!s.alive) continue;
    const w = 100 + Math.min(safety(s), 80) * 0.4;
    v += s.side === side ? w : -w;
  }
  return v;
}

// 한 수를 미리 쳐 보고 결과 점수
function tryShot(st, id, vx, vy) {
  const c = clone(st);
  if (!shoot(c, id, vx, vy)) return -Infinity;
  runToRest(c);
  return evaluate(c, st.turn);
}

// 컴퓨터가 고른 수 { id, vx, vy }. 여러 방향·세기를 다 쳐 보고 가장 좋은 것을 고른 뒤, 수준만큼 손을 떤다
function aiChoose(st, level = 'normal', rand = Math.random) {
  const lv = LEVELS[level] || LEVELS.normal;
  const mine = alive(st, st.turn), theirs = alive(st, 1 - st.turn);
  let best = null, bestV = -Infinity;
  for (const s of mine) {
    // 상대 알을 겨눈 방향은 꼭 넣는다 (정면으로 맞히기)
    const aims = theirs.map((t) => Math.atan2(t.y - s.y, t.x - s.x));
    for (let i = 0; i < lv.angles; i++) aims.push((i / lv.angles) * Math.PI * 2);
    for (const a of aims) for (const p of lv.powers) {
      const vx = Math.cos(a) * p * MAX_SPEED, vy = Math.sin(a) * p * MAX_SPEED;
      const v = tryShot(st, s.id, vx, vy) + rand() * 0.01;
      if (v > bestV) { bestV = v; best = { id: s.id, a, p }; }
    }
  }
  if (!best) return null;
  const a = best.a + (rand() * 2 - 1) * lv.aimNoise;
  const p = Math.max(0.15, Math.min(1, best.p * (1 + (rand() * 2 - 1) * lv.powerNoise)));
  return { id: best.id, vx: Math.cos(a) * p * MAX_SPEED, vy: Math.sin(a) * p * MAX_SPEED };
}

// 끌기 → 튕길 속도: 알에서 손가락까지 끈 반대쪽으로, 끈 거리에 비례 (maxDrag 이상은 최대)
function dragToVelocity(dx, dy, maxDrag = 120) {
  const d = Math.hypot(dx, dy);
  if (d < 6) return null;
  const p = Math.min(1, d / maxDrag);
  return { vx: (-dx / d) * p * MAX_SPEED, vy: (-dy / d) * p * MAX_SPEED, p };
}

return { B, R, PER_SIDE, FRICTION, MAX_SPEED, RESTITUTION, BLACK, WHITE, LEVELS, rng, setup, newGame, alive, moving, offBoard, shoot, collide, step, settle, runToRest, clone, safety, evaluate, tryShot, aiChoose, dragToVelocity };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_ALKKAGI;
