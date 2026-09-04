import test from 'node:test';
import assert from 'node:assert/strict';

import { extractUsername, isShortLink, resolveTarget, TargetResolutionError } from '../src/target.js';

test('生のユーザー名を受け付ける', () => {
  assert.equal(extractUsername('kawaii_fan'), 'kawaii_fan');
  assert.equal(extractUsername('@kawaii_fan'), 'kawaii_fan');
  assert.equal(extractUsername('  @kawaii.fan  '), 'kawaii.fan');
});

test('プロフィール URL / LIVE URL からユーザー名を取り出す', () => {
  assert.equal(extractUsername('https://www.tiktok.com/@kawaii_fan'), 'kawaii_fan');
  assert.equal(extractUsername('https://www.tiktok.com/@kawaii_fan/live'), 'kawaii_fan');
  assert.equal(extractUsername('https://www.tiktok.com/@kawaii_fan/live?lang=ja'), 'kawaii_fan');
});

test('解釈できない入力は null', () => {
  assert.equal(extractUsername(''), null);
  assert.equal(extractUsername('https://example.com/@kawaii_fan'), null);
  assert.equal(extractUsername('https://www.tiktok.com/foryou'), null);
  assert.equal(extractUsername('スペース 入り'), null);
});

test('短縮 URL を判別する', () => {
  assert.equal(isShortLink('https://vt.tiktok.com/ZS9BwoUtNh7vE-dtaKy/'), true);
  assert.equal(isShortLink('https://vm.tiktok.com/ABCDEFG/'), true);
  assert.equal(isShortLink('https://www.tiktok.com/t/ABCDEFG/'), true);
  assert.equal(isShortLink('https://www.tiktok.com/@kawaii_fan/live'), false);
  assert.equal(isShortLink('@kawaii_fan'), false);
});

/** Location ヘッダを返すだけの fetch スタブ */
function stubFetch(redirects) {
  return async (url) => ({
    headers: { get: (name) => (name.toLowerCase() === 'location' ? (redirects[url] ?? null) : null) },
  });
}

test('短縮 URL のリダイレクトを辿ってユーザー名を解決する', async () => {
  const fetchImpl = stubFetch({
    'https://vt.tiktok.com/ZS9BwoUtNh7vE-dtaKy/': 'https://www.tiktok.com/@kawaii_fan/live?is_from_webapp=1',
  });
  const result = await resolveTarget('https://vt.tiktok.com/ZS9BwoUtNh7vE-dtaKy/', { fetchImpl });
  assert.equal(result.username, 'kawaii_fan');
  assert.equal(result.resolvedFrom, 'https://www.tiktok.com/@kawaii_fan/live?is_from_webapp=1');
});

test('相対 Location と多段リダイレクトを辿れる', async () => {
  const fetchImpl = stubFetch({
    'https://vt.tiktok.com/AAA/': 'https://www.tiktok.com/t/BBB/',
    'https://www.tiktok.com/t/BBB/': '/@beauty_fan/live',
  });
  const result = await resolveTarget('https://vt.tiktok.com/AAA/', { fetchImpl });
  assert.equal(result.username, 'beauty_fan');
});

test('ユーザー名を直接渡した場合はネットワークを使わない', async () => {
  const fetchImpl = () => assert.fail('fetch を呼んではいけない');
  const result = await resolveTarget('@kawaii_fan', { fetchImpl });
  assert.equal(result.username, 'kawaii_fan');
  assert.equal(result.resolvedFrom, null);
});

test('展開先がユーザーページでなければエラーになる', async () => {
  const fetchImpl = stubFetch({
    'https://vt.tiktok.com/AAA/': 'https://www.tiktok.com/foryou',
  });
  await assert.rejects(
    () => resolveTarget('https://vt.tiktok.com/AAA/', { fetchImpl }),
    TargetResolutionError,
  );
});

test('未指定・解釈不能はエラーになる', async () => {
  await assert.rejects(() => resolveTarget(''), TargetResolutionError);
  await assert.rejects(() => resolveTarget('https://example.com/foo'), TargetResolutionError);
});

test('短縮 URL がリダイレクトせず 4xx を返したら到達性の問題として報告する', async () => {
  const fetchImpl = async () => ({ status: 403, headers: { get: () => null } });
  await assert.rejects(
    () => resolveTarget('https://vt.tiktok.com/AAA/', { fetchImpl }),
    (err) => {
      assert.ok(err instanceof TargetResolutionError);
      assert.match(err.message, /HTTP 403/);
      assert.match(err.message, /npm run doctor/);
      assert.equal(err.showUsage, false);
      return true;
    },
  );
});

test('fetch 自体が失敗した場合もネットワーク起因として報告する', async () => {
  const fetchImpl = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(
    () => resolveTarget('https://vt.tiktok.com/AAA/', { fetchImpl }),
    (err) => {
      assert.ok(err instanceof TargetResolutionError);
      assert.match(err.message, /fetch failed/);
      return true;
    },
  );
});

test('入力の書き方が原因のエラーだけ showUsage が立つ', async () => {
  await assert.rejects(() => resolveTarget(''), (err) => err.showUsage === true);
  await assert.rejects(() => resolveTarget('https://example.com/foo'), (err) => err.showUsage === true);
});
