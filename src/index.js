#!/usr/bin/env node
import process from 'node:process';

import { buildConfig, loadDotEnv } from './config.js';
import { createLogger, color } from './logger.js';
import { createPrinter } from './printer.js';
import { createBridge, findGameDir } from './bridge.js';
import { createLiveController } from './live.js';

const USAGE = `
使い方:
  node src/index.js [接続先] [オプション]

接続先は省略できます。省略するとブラウザの画面で LIVE の URL を
貼り付けて接続できます (コマンドに URL を書く必要がありません)。

接続先はユーザー名でも URL でもよい:
  @username
  https://www.tiktok.com/@username/live
  https://vt.tiktok.com/XXXXXXXX/        (共有用の短縮 URL。自動で展開します)

例:
  node src/index.js @tiktok
  node src/index.js https://vt.tiktok.com/XXXXXXXX/
  node src/index.js --mock                    TikTok に繋がず、擬似イベントで表示を確認
  node src/index.js @tiktok --wait=600         配信開始まで最大 600 秒待つ

オプション:
  --mock              モックモード (ネットワーク接続なし)
  --raw               生ペイロードも出力する (--log-level=debug と併用)
  --timestamps        各行の先頭に時刻を付ける
  --extended-gift-info  ギフト一覧も取得する (Euler Stream の有料プランが必要)
  --wait=SECONDS      配信開始まで待機する秒数
  --duration=SECONDS  指定秒数で自動終了する
  --serve=PORT        中継サーバーのポートを変える (既定 8787)
  --no-serve          中継サーバーを立てない (コンソール表示だけ)
  --game=DIR          ゲームのフォルダを指定する (未指定なら自動で探す)
  --log-level=LEVEL   debug | info | warn | error
`.trim();

/** よくあるエラーに日本語の対処法を添える。 */
function explainError(err) {
  const name = err?.constructor?.name ?? '';
  const hints = {
    UserOfflineError: 'この配信者は現在ライブ配信していません。配信中に実行するか --wait=600 を付けてください。',
    InvalidUniqueIdError: 'ユーザー名が不正です。@ 抜きのユーザー名 (プロフィール URL の @ の後ろ) を指定してください。',
    SignatureRateLimitError: '署名サーバー (Euler Stream) のレート制限に達しました。しばらく待つか、SIGN_API_KEY を設定してください。',
    SignatureMissingTokensError: '署名サーバーがトークンを返しませんでした。Business プランが必要と言われている場合は --extended-gift-info を外してください。',
    SignAPIError: '署名サーバーへのリクエストが失敗しました。ネットワークと SIGN_API_KEY を確認してください。',
    ConnectTimeoutError: '接続がタイムアウトしました。ネットワークを確認して再試行してください。',
    PremiumFeatureError: 'この機能は Euler Stream の有料プランが必要です。--extended-gift-info を外すと接続できます。',
    InvalidResponseCompositeError: 'TikTok に到達できていません。npm run doctor でネットワーク (プロキシ / VPN / 地域制限) を確認してください。',
  };
  return hints[name] ?? null;
}

function fail(logger, message, { showUsage = true } = {}) {
  (logger?.error ?? console.error)(message);
  if (showUsage) console.error(`\n${USAGE}`);
  process.exitCode = 1;
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
    fail(null, err.message);
    return;
  }

  const logger = createLogger(config.logLevel);
  const printer = createPrinter({ logger, dumpRaw: config.dumpRaw, timestamps: config.timestamps });

  let bridge = null;

  // 接続先はあとから差し替えられる。起動時に決まっていなくてもよい。
  const live = createLiveController({
    config,
    logger,
    onEvent: (event, raw) => {
      printer.handle(event, raw);
      bridge?.broadcast(event);
    },
  });

  logger.raw(color.bold('TikTok LIVE Event Server'));
  logger.raw(color.dim('  ギフト / いいね / フォロー / コメント をリアルタイムでコンソールに表示します'));
  logger.raw(color.dim(`  署名 API キー: ${config.signApiKey ? '設定あり' : '未設定 (無料枠)'}`));
  logger.raw('');

  // ゲーム画面への中継サーバー。既定で立ち上がる (--no-serve で無効)。
  // ゲームのフォルダが見つかれば、ゲーム本体もここから配信する。
  // そうすると準備は「1 つの URL を開く」だけになる。
  if (config.servePort) {
    const gameDir = config.gameDir || findGameDir(process.cwd());
    bridge = createBridge({
      port: config.servePort,
      host: config.serveHost,
      gameDir,
      live,
      logger,
    });
    try {
      await bridge.start();
      const base = `http://${config.serveHost}:${config.servePort}`;
      logger.raw(color.green('  ブラウザでこの URL を開いてください'));
      logger.raw(color.bold(`      ${base}/`));
      if (gameDir) {
        logger.raw(color.dim(`      (ゲーム: ${gameDir})`));
      } else {
        // 見つからないときは、何を探したかを見せる。「並べたのに出ない」で
        // 詰まったときに、どこを直せばいいかが分かるようにするため。
        logger.raw('');
        logger.raw(color.yellow('  ※ ゲームのフォルダが見つかりませんでした。'));
        logger.raw(color.dim(`     探した場所: ${process.cwd()} から上へ 3 階層`));
        logger.raw(color.dim('     ゲームのフォルダには index.html と js/game.js が必要です。'));
        logger.raw(color.dim('     見つからない場合は  npm start -- --game="ゲームのフォルダ"  で直接指定できます。'));
      }
      logger.raw('');
    } catch (err) {
      logger.error(`中継サーバーを開始できませんでした: ${err.message}`);
      logger.error(color.yellow(`ヒント: ポート ${config.servePort} が使用中かもしれません。--serve=8788 のように変えてください。`));
      bridge = null;
    }
  }

  // 起動時に接続先が分かっていれば繋ぐ。無ければブラウザからの指定を待つ。
  const initialTarget = config.mock ? '--mock' : config.target;
  if (initialTarget) {
    await live.connect(initialTarget);
  } else if (bridge) {
    logger.info('接続先の入力を待っています (ブラウザの画面に LIVE の URL を貼り付けてください)');
  } else {
    fail(logger, '接続先が指定されていません。');
    return;
  }

  if (config.durationSeconds > 0) {
    logger.info(`${config.durationSeconds} 秒後に自動終了します`);
    setTimeout(() => void shutdown('duration に達しました'), config.durationSeconds * 1000).unref();
  }

  let shuttingDown = false;
  async function shutdown(reason) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`終了します (${reason})`);
    await live.disconnect();
    await bridge?.close();
    logger.raw(printer.summary());
    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
