#!/usr/bin/env node
import process from 'node:process';

import { buildConfig, loadDotEnv } from './config.js';
import { createLogger, color } from './logger.js';
import { createPrinter } from './printer.js';
import { createTikTokSource } from './sources/tiktok.js';
import { createMockSource } from './sources/mock.js';

const USAGE = `
使い方:
  node src/index.js [ユーザー名] [オプション]

例:
  node src/index.js @tiktok            指定ユーザーの LIVE に接続
  node src/index.js --mock             TikTok に繋がず、擬似イベントで表示を確認
  node src/index.js @tiktok --raw      生ペイロードも出力 (要 --log-level=debug)
  node src/index.js @tiktok --wait=600 まだ配信中でなければ最大 600 秒待つ

オプション:
  --mock              モックモード (ネットワーク接続なし)
  --raw               生ペイロードも出力する
  --wait=SECONDS      配信開始まで待機する秒数
  --duration=SECONDS  指定秒数で自動終了する
  --log-level=LEVEL   debug | info | warn | error
`.trim();

/** よくあるエラーに日本語の対処法を添える。 */
function explainError(err) {
  const name = err?.constructor?.name ?? '';
  const hints = {
    UserOfflineError: 'この配信者は現在ライブ配信していません。配信中に実行するか --wait=600 を付けてください。',
    InvalidUniqueIdError: 'ユーザー名が不正です。@ 抜きのユーザー名 (プロフィール URL の @ の後ろ) を指定してください。',
    SignatureRateLimitError: '署名サーバー (Euler Stream) のレート制限に達しました。しばらく待つか、SIGN_API_KEY を設定してください。',
    SignatureMissingTokensError: '署名サーバーがトークンを返しませんでした。時間をおいて再試行してください。',
    SignAPIError: '署名サーバーへのリクエストが失敗しました。ネットワークと SIGN_API_KEY を確認してください。',
    ConnectTimeoutError: '接続がタイムアウトしました。ネットワークを確認して再試行してください。',
    PremiumFeatureError: 'この機能は Euler Stream の有料プランが必要です。',
  };
  return hints[name] ?? null;
}

async function main() {
  loadDotEnv();

  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(USAGE);
    return;
  }

  let config;
  try {
    config = buildConfig();
  } catch (err) {
    console.error(err.message);
    console.error(`\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  const logger = createLogger(config.logLevel);
  const printer = createPrinter({ logger, dumpRaw: config.dumpRaw });

  let source;
  try {
    source = config.mock
      ? createMockSource({ logger })
      : createTikTokSource({
          username: config.username,
          signApiKey: config.signApiKey,
          waitUntilLiveSeconds: config.waitUntilLiveSeconds,
          logger,
        });
  } catch (err) {
    logger.error(err.message);
    console.error(`\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  logger.raw(color.bold('TikTok LIVE Event Server'));
  logger.raw(color.dim('  ギフト / フォロー / いいね をリアルタイムでコンソールに表示します'));
  logger.raw(color.dim(`  対象: @${source.username}  モード: ${config.mock ? 'mock' : 'live'}`));
  logger.raw(color.dim(`  署名 API キー: ${config.signApiKey ? '設定あり' : '未設定 (無料枠)'}`));
  logger.raw('');

  source.emitter.on('event', (event, raw) => printer.handle(event, raw));

  source.emitter.on('connected', ({ roomId }) => {
    logger.info(color.green(`接続しました (roomId: ${roomId})`));
    logger.info(color.dim('イベント待機中… 終了するには Ctrl+C'));
  });

  source.emitter.on('disconnected', () => logger.warn('切断されました'));
  source.emitter.on('error', (err) => logger.error(err.message));

  let shuttingDown = false;
  const shutdown = async (reason) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`終了します (${reason})`);
    try {
      await source.disconnect();
    } catch {
      // 切断時のエラーは終了処理を妨げない
    }
    logger.raw(printer.summary());
    process.exit(0);
  };

  source.emitter.on('end', (reason) => void shutdown(reason));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  if (config.durationSeconds > 0) {
    logger.info(`${config.durationSeconds} 秒後に自動終了します`);
    setTimeout(() => void shutdown('duration に達しました'), config.durationSeconds * 1000).unref();
  }

  try {
    await source.connect();
  } catch (err) {
    logger.error(`接続に失敗しました: ${err.message}`);
    const hint = explainError(err);
    if (hint) logger.error(color.yellow(`ヒント: ${hint}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
