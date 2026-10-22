'use strict';
// 알까기 규칙·물리·컴퓨터 상대 시험. 실행: node test/logic.test.js
const test = require('node:test');
const assert = require('node:assert');
const L = require('../public/logic.js');

const { B, R, BLACK, WHITE } = L;
// 원하는 알만 남긴 판
function board(list, turn = BLACK) {
  const st = L.newGame();
  st.stones = list.map(([side, x, y], id) => ({ id, side, x, y, vx: 0, vy: 0, alive: true }));
  st.turn = turn;
  return st;
}

test('the starting setup: six stones each, black near the bottom, nobody overlapping or off the board', () => {
  const st = L.newGame();
  assert.strictEqual(L.alive(st, BLACK).length, L.PER_SIDE);
  assert.strictEqual(L.alive(st, WHITE).length, L.PER_SIDE);
  for (const s of st.stones) {
    assert.ok(!L.offBoard(s) && L.safety(s) > R);
    assert.ok(s.side === BLACK ? s.y > B / 2 : s.y < B / 2);
    for (const t of st.stones) if (t !== s) assert.ok(Math.hypot(s.x - t.x, s.y - t.y) > 2 * R);
  }
  assert.strictEqual(st.turn, BLACK);
});

test('a stone slides, slows down with friction and stops where physics says', () => {
  const st = board([[BLACK, 180, 300], [WHITE, 20, 20]]);
  assert.ok(L.shoot(st, 0, 0, -300));
  L.runToRest(st);
  const want = 300 * 300 / (2 * L.FRICTION);                     // v² / 2a
  assert.ok(Math.abs((300 - st.stones[0].y) - want) < 6, `slid ${(300 - st.stones[0].y).toFixed(1)} vs ${want.toFixed(1)}`);
  assert.strictEqual(st.phase, 'aim');
  assert.strictEqual(st.turn, WHITE, 'the turn passes');
});

test('only your own living stone can be flicked, only while aiming, never harder than the max', () => {
  const st = board([[BLACK, 180, 300], [WHITE, 180, 60]]);
  assert.ok(!L.shoot(st, 1, 0, 100), 'not your stone');
  assert.ok(!L.shoot(st, 0, 0, 0), 'no push at all');
  assert.ok(L.shoot(st, 0, 0, -5000));
  assert.ok(Math.abs(Math.hypot(st.stones[0].vx, st.stones[0].vy) - L.MAX_SPEED) < 1e-9);
  assert.ok(!L.shoot(st, 0, 0, -100), 'not while stones are moving');
});

test('a head-on hit passes the speed on (like billiard balls) and knocks the target off the board', () => {
  const st = board([[BLACK, 180, 200], [WHITE, 180, 140], [WHITE, 20, 300]]);
  L.shoot(st, 0, 0, -L.MAX_SPEED);
  L.runToRest(st);
  assert.ok(!st.stones[1].alive, 'the white stone flew off the top');
  assert.ok(st.stones[0].alive, 'the black stone stayed nearly where it hit');
  assert.ok(st.stones[0].y > 100);
  assert.ok(st.events.some((e) => e.type === 'clack') && st.events.some((e) => e.type === 'fall' && e.id === 1));
});

test('your own stone can fall too; knocking out the last enemy wins', () => {
  const st = board([[BLACK, 180, 40], [BLACK, 100, 300], [WHITE, 300, 300]]);
  L.shoot(st, 0, 0, -L.MAX_SPEED);                               // 위로 떨어진다
  L.runToRest(st);
  assert.ok(!st.stones[0].alive);
  assert.strictEqual(st.phase, 'aim');
  const w = board([[BLACK, 180, 120], [WHITE, 180, 60]]);
  L.shoot(w, 0, 0, -L.MAX_SPEED);
  L.runToRest(w);
  assert.strictEqual(w.phase, 'over');
  assert.strictEqual(w.winner, BLACK);
});

test('if both last stones fall on the same shot, the shooter loses', () => {
  // (정면으로 맞히면 힘이 거의 다 넘어가 친 알은 멈추니, 판정만 따로 본다)
  const st = board([[BLACK, 180, 40], [WHITE, 180, 14]]);
  st.lastShooter = BLACK; st.phase = 'moving';
  st.stones.forEach((x) => { x.alive = false; });
  L.settle(st);
  assert.strictEqual(st.phase, 'over');
  assert.strictEqual(st.winner, WHITE);
});

test('stones never pass through each other, even at full speed', () => {
  for (let k = 0; k < 40; k++) {
    const st = L.newGame();
    const s = L.alive(st, BLACK)[k % 6];
    const a = (k / 40) * Math.PI * 2;
    L.shoot(st, s.id, Math.cos(a) * L.MAX_SPEED, Math.sin(a) * L.MAX_SPEED);
    for (let t = 0; t < 20 && st.phase === 'moving'; t += 1 / 60) {
      L.step(st, 1 / 60);
      const live = L.alive(st);
      for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
        assert.ok(Math.hypot(live[i].x - live[j].x, live[i].y - live[j].y) > 2 * R - 1.5, 'overlap');
      }
    }
    assert.notStrictEqual(st.phase, 'moving', 'everything stops');
  }
});

test('dragging back shoots forward, harder the further you pull', () => {
  const v = L.dragToVelocity(0, 60, 120);                        // 아래로 끌면 위로 날아간다
  assert.ok(v.vy < 0 && Math.abs(v.vx) < 1e-9);
  assert.ok(Math.abs(v.p - 0.5) < 1e-9);
  assert.strictEqual(L.dragToVelocity(0, 500, 120).p, 1);
  assert.strictEqual(L.dragToVelocity(2, 2), null, 'a tiny drag is not a shot');
});

test('the computer takes an easy knock-out when it sees one', () => {
  const st = board([[WHITE, 180, 260], [BLACK, 180, 320], [BLACK, 30, 30]], WHITE);
  const m = L.aiChoose(st, 'hard', L.rng(1));
  L.shoot(st, m.id, m.vx, m.vy);
  L.runToRest(st);
  assert.ok(!st.stones[1].alive, 'pushed the black stone off the bottom');
  assert.ok(st.stones[0].alive, 'and kept its own stone');
});

test('harder computers beat easier ones; games last a sensible number of shots', () => {
  const match = (black, white, seed) => {
    const g = L.newGame(), r = L.rng(seed);
    let n = 0;
    while (g.phase !== 'over' && n < 150) { const m = L.aiChoose(g, g.turn === BLACK ? black : white, r); L.shoot(g, m.id, m.vx, m.vy); L.runToRest(g); n++; }
    return { winner: g.winner, n };
  };
  let hardWins = 0, normalWins = 0, shots = 0;
  for (let s = 1; s <= 4; s++) {
    if (match('hard', 'easy', s).winner === BLACK) hardWins++;
    if (match('easy', 'hard', s).winner === WHITE) hardWins++;
    const r = match('normal', 'easy', s); if (r.winner === BLACK) normalWins++;
    shots += match('easy', 'easy', s).n;
  }
  assert.ok(hardWins >= 7, 'hard beats easy: ' + hardWins + '/8');
  assert.ok(normalWins >= 3, 'normal beats easy: ' + normalWins + '/4');
  assert.ok(shots / 4 > 8 && shots / 4 < 60, 'easy vs easy takes ' + (shots / 4).toFixed(1) + ' shots');
});
