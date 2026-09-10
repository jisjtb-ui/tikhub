/**
 * 更新コマンドのテスト。
 *
 * ここで一番大事なのは「**どこから入れたのかを取り違えない**」ことです。
 * 取り違えると、古いブランチで新しいファイルを黙って上書きしてしまいます。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { branchCandidates, archiveUrl, gameRepoFor, servedRef } from '../tools/update.js';
import { GAME_CONTAINERS } from '../src/bridge.js';

// ---------------------------------------------------------- ブランチの候補

test('指定が無ければ、既定ブランチ → main → master の順に試す', () => {
  assert.deepEqual(branchCandidates(null, 'claude/x'), ['claude/x', 'main', 'master']);
});

test('既定ブランチが分からなくても main / master は試す', () => {
  assert.deepEqual(branchCandidates(null, null), ['main', 'master']);
});

test('同じ名前は 1 回しか試さない', () => {
  assert.deepEqual(branchCandidates('main', 'main'), ['main', 'master']);
});

test('指定があれば先頭に来る', () => {
  assert.deepEqual(branchCandidates('dev', 'main'), ['dev', 'main', 'master']);
});

// ------------------------------------------------------------------ URL

test('ブランチ名に / が入っていても URL を作れる', () => {
  assert.equal(
    archiveUrl('circlebattle', 'claude/tiktok-live-battle-game-6tvo3w', 'tar'),
    'https://github.com/jisjtb-ui/circlebattle/archive/refs/heads/claude/tiktok-live-battle-game-6tvo3w.tar.gz'
  );
});

test('tar が使えないときは zip の URL', () => {
  assert.equal(archiveUrl('tikhub', 'main', 'zip'),
    'https://github.com/jisjtb-ui/tikhub/archive/refs/heads/main.zip');
});

// ------------------------------------------- 実際に返ってきたブランチを読む

test('展開されたフォルダ名から、入れたブランチが分かる', () => {
  assert.equal(servedRef('/tmp/x/tikhub-main', 'tikhub'), 'main');
  assert.equal(
    servedRef('/tmp/x/circlebattle-claude-tiktok-live-battle-game-6tvo3w', 'circlebattle'),
    'claude-tiktok-live-battle-game-6tvo3w'
  );
});

test('思っていない名前でも、そのまま出して隠さない', () => {
  // GitHub は master を既定ブランチへ黙って読み替えます。頼んだ名前をそのまま
  // 表示すると嘘になるので、返ってきた名前を出せることを確かめます。
  assert.equal(servedRef('/tmp/x/something-else', 'circlebattle'), 'something-else');
});

// --------------------------------------------------- どのゲームのフォルダか

test('package.json の name でゲームを見分ける', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'update-test-'));
  try {
    for (const name of ['circlebattle', 'kawaiivsbeautiful']) {
      const dir = path.join(root, 'folder-' + name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name }));
      assert.equal(gameRepoFor(dir), name, 'フォルダ名ではなく中身で判断していない');
    }

    // 判断できないときは既定へ (別のゲームで上書きするよりは安全)
    const unknown = path.join(root, 'nameless');
    fs.mkdirSync(unknown, { recursive: true });
    assert.equal(gameRepoFor(unknown), 'kawaiivsbeautiful');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('games/ は tikhub の更新で上書きされない', async () => {
  // ゲーム本体を入れる場所なので、tikhub 側の更新では触りません。
  // KEEP は外に出していないので、名前が一致していることだけ確かめます。
  const src = fs.readFileSync(new URL('../tools/update.js', import.meta.url), 'utf8');
  const keep = src.match(/const KEEP = new Set\(\[([^\]]*)\]/);
  assert.ok(keep, 'KEEP が見つからない');
  assert.ok(keep[1].includes('GAME_CONTAINERS'), 'games/ が守られていない');
  assert.ok(GAME_CONTAINERS.includes('games'));
});

// ------------------------------------------------ ダブルクリックの入口

/**
 * npm を経由しない入口を 2 つ置いてあります。
 *
 * Windows の PowerShell は既定でスクリプトの実行を止めるので、
 * `npm run update` が「このシステムではスクリプトの実行が無効になっている」
 * で止まることがあります。そのとき更新する手段が無くなるのを避けるためです。
 */
test('ダブルクリックの入口が更新スクリプトを指している', () => {
  for (const name of ['update.cmd', 'update.sh']) {
    const file = new URL('../' + name, import.meta.url);
    assert.ok(fs.existsSync(file), `${name} が無い`);

    const body = fs.readFileSync(file, 'utf8');
    assert.match(body, /tools[\\/]update\.js/, `${name} が更新スクリプトを呼んでいない`);
    // 引数をそのまま渡す (--branch= などが使えなくならないように)
    assert.ok(body.includes('%*') || body.includes('"$@"'), `${name} が引数を渡していない`);
  }
});

test('入口はどこから開いても tikhub のフォルダで動く', () => {
  // 更新スクリプトは process.cwd() を見るので、置いてある場所へ移動しないと
  // 「tikhub のフォルダで実行してください」で止まります。
  const cmd = fs.readFileSync(new URL('../update.cmd', import.meta.url), 'utf8');
  assert.match(cmd, /cd \/d "%~dp0"/, 'update.cmd がフォルダを移動していない');

  const sh = fs.readFileSync(new URL('../update.sh', import.meta.url), 'utf8');
  assert.match(sh, /cd "\$\(dirname "\$0"\)"/, 'update.sh がフォルダを移動していない');
});

// ------------------------------------------- 空白の入ったフォルダで動くか

/**
 * ダウンロードした ZIP を展開すると、フォルダ名はよく
 * `tikhub-main (4)` のように**空白と記号入り**になります。
 *
 * 直接実行の判定に URL の pathname をそのまま使っていた頃は、空白が
 * `%20` のまま残って argv と一致せず、**何も出力せずに終了**していました
 * (Windows ではさらに `/D:/...` とドライブレターの前に / が付きます)。
 * 無反応なので、動いていないことにも気づけません。
 */
test('空白や記号が入ったパスから実行しても動く', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tikhub-'));
  const dir = path.join(root, 'tikhub-main (4)');
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });

  const from = new URL('../', import.meta.url);
  fs.copyFileSync(new URL('tools/update.js', from), path.join(dir, 'tools', 'update.js'));
  fs.copyFileSync(new URL('src/bridge.js', from), path.join(dir, 'src', 'bridge.js'));

  // tikhub のフォルダ**以外**から呼びます。ネットワークへ出る前に
  // 「tikhub のフォルダで実行してください」で止まるので、これだけで
  // 「main() まで届いたか」が分かります。
  const result = spawnSync(process.execPath, [path.join(dir, 'tools', 'update.js')], {
    cwd: root, encoding: 'utf8'
  });

  const output = (result.stdout || '') + (result.stderr || '');
  assert.notEqual(output.trim(), '', '何も出力せずに終わっている (直接実行と判定されていない)');
  assert.match(output, /tikhub のフォルダで実行してください/);

  fs.rmSync(root, { recursive: true, force: true });
});
