#!/usr/bin/env node
/**
 * 接続前の環境チェック。
 * 「イベントが出ない」ときに、どこで詰まっているかを切り分けるために使う。
 *
 *   npm run doctor
 *   npm run doctor -- @username
 */
import process from 'node:process';
import { createRequire } from 'node:module';

import { loadDotEnv, buildConfig } from './config.js';
import { color } from './logger.js';

const require = createRequire(import.meta.url);

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  const mark = ok ? color.green('OK  ') : color.red('NG  ');
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function fetchWithTimeout(url, ms = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'manual' });
  } finally {
    clearTimeout(timer);
  }
}

async function checkHttp(name, url) {
  try {
    const res = await fetchWithTimeout(url);
    // 4xx/5xx は到達できていないのと同じ扱い (社内プロキシや地域ブロックで弾かれている場合がある)
    record(name, res.status < 400, `HTTP ${res.status}`);
  } catch (err) {
    record(name, false, err.cause?.message ?? err.message);
  }
}

/**
 * 署名サーバーの到達性チェック。
 *
 * ルートパス (`/`) は「そんなルートは無い」という 404 を返すだけで、到達性の判定には使えない。
 * 無認証で叩ける `/accounts/me/rate_limits` を使うと、到達性と同時に無料枠の残量も分かる。
 */
async function checkSignServer(baseUrl) {
  const name = '署名サーバー (Euler Stream) に到達できる';
  const url = new URL('/accounts/me/rate_limits', baseUrl).toString();
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      record(name, false, `HTTP ${res.status} (${baseUrl})`);
      return;
    }
    const body = await res.json();
    const quota = ['minute', 'hour', 'day']
      .filter((span) => body?.[span])
      .map((span) => `${span} ${body[span].remaining}/${body[span].max}`)
      .join(', ');
    record(name, true, quota ? `HTTP 200 — 残りリクエスト数: ${quota}` : 'HTTP 200');
  } catch (err) {
    record(name, false, err.cause?.message ?? err.message);
  }
}

async function main() {
  loadDotEnv();
  const config = buildConfig();

  console.log(color.bold('TikTok LIVE Event Server — 環境チェック\n'));

  const [major, minor] = process.versions.node.split('.').map(Number);
  record('Node.js >= 20.12', major > 20 || (major === 20 && minor >= 12), `v${process.versions.node}`);

  try {
    const version = require('tiktok-live-connector/package.json').version;
    record('tiktok-live-connector がインストール済み', true, `v${version}`);
  } catch {
    record('tiktok-live-connector がインストール済み', false, 'npm install を実行してください');
  }

  // 接続先はブラウザの画面から指定できるので、未指定でも問題ではない。
  // ここを失敗にすると、正常な状態で「1 件の問題があります」と出てしまう。
  record('接続先', true, config.target || '未指定 (起動後にブラウザの画面で指定できます)');
  record('SIGN_API_KEY', true, config.signApiKey ? '設定あり' : '未設定 (無料枠で動作します)');

  // 署名サーバーと TikTok の両方に到達できないと接続できない
  await checkHttp('TikTok に到達できる', 'https://www.tiktok.com/');
  await checkSignServer(config.signApiUrl);

  const failed = results.filter((r) => !r.ok);
  console.log('');
  if (failed.length === 0) {
    console.log(color.green('すべてのチェックを通過しました。npm start で接続できます。'));
    return;
  }
  console.log(color.yellow(`${failed.length} 件の問題があります: ${failed.map((r) => r.name).join(', ')}`));
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
