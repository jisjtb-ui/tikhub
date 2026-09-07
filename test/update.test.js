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

import { branchCandidates, archiveUrl, gameRepoFor, servedRef } from '../tools/update.js';

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
