'use strict';

// 서버 시험: 보안·안정성 회귀 + 알까기 온라인 대국 흐름
// 실행: npm test  (Node 18 이상, 별도 설치 없이 node:test)
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { WebSocket } = require('ws');
const L = require('../public/logic.js');

// 운영체제가 지금 비어 있는 포트를 골라 준다. 예전엔 정해 둔 범위에서 무작위로 골라서, 다른 시험의 서버나
// 다른 프로그램이 쓰는 포트와 겹치면 시험이 엉뚱한 서버에 붙어 가끔 실패했다
const freePort = () => Number(require('child_process').execFileSync(process.execPath, ['-e', "const s = require('net').createServer().listen(0, '127.0.0.1', () => { console.log(s.address().port); s.close(); })"]));
const PORT = freePort();
const get = (p) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', reject); req.end();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), TURN_MS: '2500' }, stdio: 'ignore' });
child.unref();
process.on('exit', () => child.kill());
const ready = (async () => {
  for (let i = 0; i < 80; i++) { try { await get('/'); return; } catch { await sleep(100); } }
  throw new Error('server did not start');
})();

const open = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  const c = { ws, msgs: [], room: null, queued: false, errors: [], closed: null };
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d); } catch { return; }
    c.msgs.push(m);
    if (m.t === 'room') c.room = m;
    if (m.t === 'queued') c.queued = true;
    if (m.t === 'error') c.errors.push(m.msg);
  });
  ws.on('close', (code) => { c.closed = code; });
  ws.on('error', () => {});
  ws.on('open', () => resolve(c));
  setTimeout(() => reject(new Error('websocket connect failed')), 3000);
});
const send = (c, t, p = {}) => c.ws.send(JSON.stringify({ t, ...p }));
const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(15); } return false; };

// 두 손님을 빠른 대전으로 맺어 준다
async function pair() {
  const a = await open(), b = await open();
  send(a, 'hello', { name: '가' }); send(b, 'hello', { name: '나' });
  send(a, 'quick'); await until(() => a.queued);
  send(b, 'quick');
  assert.ok(await until(() => a.room && b.room && a.room.state === 'playing' && b.room.state === 'playing'), 'both players enter a playing room');
  return [a, b];
}

const mine = (a, b) => (a.room.turn === a.room.you ? a : b);
const aliveOf = (room, side) => room.stones.filter((s) => s.alive && s.side === side);
// 내 알 하나를 가운데 쪽으로 약하게 튕기고, 양쪽에 새 샷이 반영될 때까지 기다린다
async function flick(a, b, vx = 0, vy = 0) {
  const mover = mine(a, b), room = mover.room, seq = room.shot ? room.shot.seq : 0;
  const s = aliveOf(room, room.you)[0];
  const dir = room.you === L.BLACK ? -1 : 1;
  send(mover, 'shoot', { id: s.id, vx: vx || 0, vy: vy || 120 * dir });
  assert.ok(await until(() => a.room.shot && a.room.shot.seq > seq && b.room.shot && b.room.shot.seq > seq), 'shot reaches both players');
  return s;
}

test('malformed URLs get 400 and the server stays up', async () => {
  await ready;
  assert.strictEqual(await get('/%'), 400);
  assert.strictEqual(await get('/%00'), 400);
  assert.strictEqual(await get('/'), 200);
  assert.strictEqual(await get('/logic.js'), 200);
});

test('dotfiles and paths outside the public dir are not served', async () => {
  await ready;
  assert.strictEqual(await get('/.git/config'), 403);
  assert.ok([403, 404].includes(await get('/../server.js')));
});

test('oversized websocket message closes the connection (1009)', async () => {
  await ready;
  const c = await open();
  c.ws.send('x'.repeat(2 * 1024 * 1024));
  await sleep(500);
  assert.strictEqual(c.closed, 1009);
  assert.strictEqual(await get('/'), 200);
});

test('quick match starts with six stones each and black to move', async () => {
  await ready;
  const [a, b] = await pair();
  assert.strictEqual(a.room.code, b.room.code);
  assert.notStrictEqual(a.room.you, b.room.you);
  assert.strictEqual(a.room.turn, L.BLACK);
  assert.strictEqual(aliveOf(a.room, L.BLACK).length, 6);
  assert.strictEqual(aliveOf(a.room, L.WHITE).length, 6);
  a.ws.close(); b.ws.close();
});

test('out-of-turn, foreign-stone and garbage shots are ignored', async () => {
  await ready;
  const [a, b] = await pair();
  const mover = mine(a, b), other = mover === a ? b : a;
  const own = aliveOf(mover.room, mover.room.you)[0], foe = aliveOf(mover.room, 1 - mover.room.you)[0];
  send(other, 'shoot', { id: aliveOf(other.room, other.room.you)[0].id, vx: 0, vy: 100 });   // 내 차례가 아님
  send(mover, 'shoot', { id: foe.id, vx: 0, vy: 100 });                                      // 남의 알
  for (const bad of [{}, { id: 'x', vx: 1, vy: 1 }, { id: own.id, vx: null, vy: 1 }, { id: own.id, vx: 'a', vy: 1 }, { id: own.id, vx: 0, vy: 0 }, { id: 1.5, vx: 1, vy: 1 }, { id: own.id, vx: 1e999, vy: 1 }]) send(mover, 'shoot', bad);
  await sleep(300);
  assert.strictEqual(mover.room.shots, 0, 'nothing was accepted');
  assert.ok(!mover.room.shot);
  a.ws.close(); b.ws.close();
});

test('a shot is simulated by the server and both players get the same result', async () => {
  await ready;
  const [a, b] = await pair();
  const mover = mine(a, b), side = mover.room.turn;
  const s = await flick(a, b);
  assert.strictEqual(a.room.shots, 1);
  assert.strictEqual(a.room.turn, 1 - side, 'the turn passes');
  assert.deepStrictEqual(a.room.stones, b.room.stones, 'same board for both');
  assert.strictEqual(a.room.shot.id, s.id);
  // 같은 출발 판에서 같은 속도로 굴리면 서버가 보낸 결과와 똑같다 (손님이 재생해도 어긋나지 않는다)
  const g = L.newGame({ mode: 'online' });
  g.stones = a.room.shot.from.map((x) => ({ ...x, vx: 0, vy: 0 }));
  g.turn = side;
  assert.ok(L.shoot(g, a.room.shot.id, a.room.shot.vx, a.room.shot.vy));
  L.runToRest(g);
  assert.deepStrictEqual(g.stones.map((x) => [x.id, x.alive, x.x, x.y]), a.room.stones.map((x) => [x.id, x.alive, x.x, x.y]));
  // 너무 센 힘은 줄여서 받는다
  const t = mine(a, b), own = aliveOf(t.room, t.room.you)[0];
  send(t, 'shoot', { id: own.id, vx: 0, vy: -99999 });
  assert.ok(await until(() => a.room.shots === 2));
  assert.ok(Math.hypot(a.room.shot.vx, a.room.shot.vy) <= L.MAX_SPEED + 1e-9);
  a.ws.close(); b.ws.close();
});

test('a full-power shot into the opponent can end the game by knock-out', async () => {
  await ready;
  for (let g = 0; g < 6; g++) {
    const [a, b] = await pair();
    for (let n = 0; n < 40 && a.room.state === 'playing'; n++) {
      const mover = mine(a, b), room = mover.room, seq = room.shot ? room.shot.seq : 0;
      const me = aliveOf(room, room.you), foe = aliveOf(room, 1 - room.you);
      let best = null;
      for (const s of me) for (const f of foe) { const d = Math.hypot(f.x - s.x, f.y - s.y); if (!best || d < best.d) best = { s, f, d }; }
      send(mover, 'shoot', { id: best.s.id, vx: (best.f.x - best.s.x) * 9, vy: (best.f.y - best.s.y) * 9 });
      await until(() => (a.room.shot && a.room.shot.seq > seq) || a.room.state === 'over');
      await sleep(20);
    }
    if (a.room.state === 'over') {
      assert.strictEqual(a.room.reason, 'knockout');
      const w = a.room.winner;
      assert.strictEqual(aliveOf(a.room, 1 - w).length === 0 || aliveOf(a.room, w).length === 0, true);
      a.ws.close(); b.ws.close();
      return;
    }
    a.ws.close(); b.ws.close();
  }
  assert.fail('no knock-out in 6 games of aimed full-power shots');
});

test('resigning ends the game and rematch swaps colors', async () => {
  await ready;
  const [a, b] = await pair();
  const colorA = a.room.you;
  send(a, 'resign');
  assert.ok(await until(() => b.room.state === 'over'));
  assert.strictEqual(b.room.reason, 'resign');
  assert.strictEqual(b.room.winner, b.room.you);
  send(a, 'rematch'); send(b, 'rematch');
  assert.ok(await until(() => a.room.state === 'playing' && a.room.shots === 0));
  assert.notStrictEqual(a.room.you, colorA, 'colors swap on a rematch');
  assert.strictEqual(a.room.turn, L.BLACK);
  assert.strictEqual(aliveOf(a.room, L.BLACK).length, 6, 'a fresh board');
  a.ws.close(); b.ws.close();
});

test('running out of time loses the game for the one on move', async () => {
  await ready;
  const [a, b] = await pair();
  assert.ok(await until(() => a.room.state === 'over', 5000), 'the timer fires');
  assert.strictEqual(a.room.reason, 'timeout');
  assert.strictEqual(a.room.winner, L.WHITE, 'black was on move, so white wins');
  a.ws.close(); b.ws.close();
});

test('private rooms: create, join by code, and a third player is turned away', async () => {
  await ready;
  const a = await open(), b = await open(), c = await open();
  send(a, 'create');
  assert.ok(await until(() => a.room && a.room.code));
  assert.strictEqual(a.room.state, 'waiting');
  send(b, 'join', { code: a.room.code.toLowerCase() });
  assert.ok(await until(() => a.room.state === 'playing' && b.room && b.room.state === 'playing'));
  send(c, 'join', { code: a.room.code });
  assert.ok(await until(() => c.errors.length > 0));
  assert.match(c.errors[0], /이미 두 사람/);
  a.ws.close(); b.ws.close(); c.ws.close();
});

test('a dropped player can resume the same seat with the token', async () => {
  await ready;
  const [a, b] = await pair();
  const token = a.room.token, code = a.room.code, you = a.room.you;
  a.ws.close();
  assert.ok(await until(() => b.room.players.some((p) => !p.online)), 'the other side sees the drop');
  const a2 = await open();
  send(a2, 'resume', { code, token });
  assert.ok(await until(() => a2.room && a2.room.you === you && a2.room.state === 'playing'));
  assert.ok(await until(() => b.room.players.every((p) => p.online)));
  a2.ws.close(); b.ws.close();
});

// 같은 주소에서 코드를 일부러 많이 틀리므로 이 시험은 맨 뒤에 둔다 (뒤의 시험이 막히지 않게)
test('repeated wrong room codes get temporarily blocked', async () => {
  await ready;
  const c = await open();
  for (let i = 0; i < 10; i++) c.ws.send(JSON.stringify({ t: 'join', code: 'ZZZ' + 'ABCDEFGH'[i] }));
  await sleep(500);
  assert.ok(c.errors.some((x) => /그런 방이 없어요/.test(x)), 'first attempts are answered with room-not-found');
  assert.ok(c.errors.some((x) => /너무 많이 틀렸어요/.test(x)), 'many wrong codes get blocked');
  c.ws.close();
});

test('shutdown', () => { child.kill(); });
