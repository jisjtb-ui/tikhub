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

async function checkHttp(name, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'manual' });
    // 4xx/5xx は到達できていないのと同じ扱い (社内プロキシや地域ブロックで弾かれている場合がある)
    record(name, res.status < 400, `HTTP ${res.status}`);
  } catch (err) {
    record(name, false, err.cause?.message ?? err.message);
  } finally {
    clearTimeout(timer);
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

  record('TIKTOK_USERNAME が設定済み', Boolean(config.username), config.username ? `@${config.username}` : '.env か実行時引数で指定してください');
  record('SIGN_API_KEY', true, config.signApiKey ? '設定あり' : '未設定 (無料枠で動作します)');

  // 署名サーバーと TikTok の両方に到達できないと接続できない
  await checkHttp('TikTok に到達できる', 'https://www.tiktok.com/');
  await checkHttp('署名サーバー (Euler Stream) に到達できる', 'https://tiktok.eulerstream.com/');

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
