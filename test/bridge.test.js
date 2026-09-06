import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createBridge, findGameDirs, readGameInfo, toGameList } from '../src/bridge.js';

/** ゲームらしいフォルダを作る (index.html と js/game.js があること)。 */
function makeGame(root, name, { title = null, pkgName = null } = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'),
    `<!doctype html><title>${title ?? name}</title><link rel="stylesheet" href="css/style.css">`);
  fs.writeFileSync(path.join(dir, 'js', 'game.js'), '// game');
  fs.mkdirSync(path.join(dir, 'css'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'css', 'style.css'), 'body{}');
  if (pkgName) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: pkgName }));
  return dir;
}

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tikhub-test-'));
  const here = path.join(root, 'tikhub');
  fs.mkdirSync(here, { recursive: true });
  return { root, here, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/** 空きポートで立ち上げて base URL を返す。 */
async function serve(games) {
  const bridge = createBridge({ port: 0, host: '127.0.0.1', games, logger: null });
  const { port } = await bridge.start();
  return { bridge, base: `http://127.0.0.1:${port}`, close: () => bridge.close() };
}

test('近くにあるゲームのフォルダを全部見つける', () => {
  const ws = workspace();
  try {
    makeGame(ws.root, 'kawaiivsbeautiful', { pkgName: 'kawaiivsbeautiful' });
    makeGame(ws.root, 'circlebattle', { pkgName: 'circlebattle' });
    fs.mkdirSync(path.join(ws.root, 'not-a-game'), { recursive: true });

    const found = findGameDirs(ws.here).map((dir) => path.basename(dir)).sort();
    assert.deepEqual(found, ['circlebattle', 'kawaiivsbeautiful']);
  } finally {
    ws.cleanup();
  }
});

test('id は package.json の name から作る (フォルダ名を変えても同じ URL)', () => {
  const ws = workspace();
  try {
    const dir = makeGame(ws.root, 'circlebattle-main', { title: 'CIRCLE BATTLE', pkgName: 'circlebattle' });
    const info = readGameInfo(dir);
    assert.equal(info.id, 'circlebattle');
    assert.equal(info.title, 'CIRCLE BATTLE');
  } finally {
    ws.cleanup();
  }
});

test('package.json が無ければフォルダ名を使う', () => {
  const ws = workspace();
  try {
    const info = readGameInfo(makeGame(ws.root, 'My Game 2024', { title: 'MY GAME' }));
    assert.equal(info.id, 'my-game-2024');
    assert.equal(info.title, 'MY GAME');
  } finally {
    ws.cleanup();
  }
});

test('id が重なったら連番を付ける', () => {
  const ws = workspace();
  try {
    const a = makeGame(ws.root, 'copy-a', { pkgName: 'circlebattle' });
    const b = makeGame(ws.root, 'copy-b', { pkgName: 'circlebattle' });
    assert.deepEqual(toGameList([a, b]).map((g) => g.id), ['circlebattle', 'circlebattle-2']);
  } finally {
    ws.cleanup();
  }
});

test('ゲームが 1 つなら / でそのまま開ける (今までどおり)', async () => {
  const ws = workspace();
  const games = toGameList([makeGame(ws.root, 'circlebattle', { title: 'CIRCLE BATTLE', pkgName: 'circlebattle' })]);
  const server = await serve(games);
  try {
    const root = await fetch(`${server.base}/`);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /CIRCLE BATTLE/);

    // 相対パスの資材もそのまま取れる
    assert.equal((await fetch(`${server.base}/css/style.css`)).status, 200);
    // /<id>/ でも開ける
    assert.equal((await fetch(`${server.base}/circlebattle/`)).status, 200);
  } finally {
    await server.close();
    ws.cleanup();
  }
});

test('ゲームが複数なら / で選択画面、/<id>/ でそれぞれ開ける', async () => {
  const ws = workspace();
  const games = toGameList([
    makeGame(ws.root, 'kawaiivsbeautiful', { title: 'KAWAII vs BEAUTIFUL', pkgName: 'kawaiivsbeautiful' }),
    makeGame(ws.root, 'circlebattle', { title: 'CIRCLE BATTLE', pkgName: 'circlebattle' }),
  ]);
  const server = await serve(games);
  try {
    const chooser = await (await fetch(`${server.base}/`)).text();
    assert.match(chooser, /CIRCLE BATTLE/);
    assert.match(chooser, /KAWAII vs BEAUTIFUL/);
    assert.match(chooser, /href="\/circlebattle\/"/);

    const game = await fetch(`${server.base}/circlebattle/`);
    assert.match(await game.text(), /CIRCLE BATTLE/);

    const other = await fetch(`${server.base}/kawaiivsbeautiful/`);
    assert.match(await other.text(), /KAWAII vs BEAUTIFUL/);

    // 資材はゲームごとに分かれて配信される
    assert.equal((await fetch(`${server.base}/circlebattle/css/style.css`)).status, 200);
  } finally {
    await server.close();
    ws.cleanup();
  }
});

test('末尾の / が無い URL は付け直す (相対パスがずれないように)', async () => {
  const ws = workspace();
  const games = toGameList([
    makeGame(ws.root, 'kawaiivsbeautiful', { pkgName: 'kawaiivsbeautiful' }),
    makeGame(ws.root, 'circlebattle', { pkgName: 'circlebattle' }),
  ]);
  const server = await serve(games);
  try {
    const res = await fetch(`${server.base}/circlebattle`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/circlebattle/');
  } finally {
    await server.close();
    ws.cleanup();
  }
});

test('ゲームのフォルダの外は読ませない', async () => {
  const ws = workspace();
  fs.writeFileSync(path.join(ws.root, 'secret.txt'), 'secret');
  const games = toGameList([makeGame(ws.root, 'circlebattle', { pkgName: 'circlebattle' })]);
  const server = await serve(games);
  try {
    const res = await fetch(`${server.base}/circlebattle/../secret.txt`);
    assert.ok(res.status === 403 || res.status === 404, `status=${res.status}`);
  } finally {
    await server.close();
    ws.cleanup();
  }
});

test('/events と /health はゲームが何個でも同じ', async () => {
  const ws = workspace();
  const games = toGameList([
    makeGame(ws.root, 'kawaiivsbeautiful', { pkgName: 'kawaiivsbeautiful' }),
    makeGame(ws.root, 'circlebattle', { pkgName: 'circlebattle' }),
  ]);
  const server = await serve(games);
  try {
    const health = await (await fetch(`${server.base}/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.game, true);
    assert.deepEqual(health.games.map((g) => g.id), ['kawaiivsbeautiful', 'circlebattle']);

    // SSE は 1 本だけ。どちらのゲームから繋いでも同じイベントを受け取る。
    const controller = new AbortController();
    const events = await fetch(`${server.base}/events`, { signal: controller.signal });
    assert.equal(events.headers.get('content-type'), 'text/event-stream');
    controller.abort();
  } finally {
    await server.close();
    ws.cleanup();
  }
});
