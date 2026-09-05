import { existsSync } from 'node:fs';
import process from 'node:process';

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

/**
 * .env があれば読み込む (依存パッケージ不要 / Node 20.12+ の組み込み機能)。
 */
export function loadDotEnv(path = '.env') {
  if (typeof process.loadEnvFile !== 'function') return false;
  if (!existsSync(path)) return false;
  process.loadEnvFile(path);
  return true;
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseIntOr(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * コマンドライン引数をパースする。
 *
 *   node src/index.js @username --mock --raw --log-level=debug --wait=300
 *   node src/index.js https://vt.tiktok.com/XXXXXXXX/
 */
export function parseArgs(argv = process.argv.slice(2)) {
  const args = { target: null, mock: false, raw: null, logLevel: null, wait: null, duration: null, timestamps: false, extendedGiftInfo: false, serve: null, gameDir: null };

  for (const arg of argv) {
    if (arg === '--mock') args.mock = true;
    else if (arg === '--raw') args.raw = true;
    else if (arg === '--timestamps') args.timestamps = true;
    else if (arg === '--extended-gift-info') args.extendedGiftInfo = true;
    else if (arg.startsWith('--log-level=')) args.logLevel = arg.slice('--log-level='.length);
    else if (arg.startsWith('--wait=')) args.wait = parseIntOr(arg.slice('--wait='.length), null);
    else if (arg.startsWith('--duration=')) args.duration = parseIntOr(arg.slice('--duration='.length), null);
    else if (arg === '--serve') args.serve = 8787;
    else if (arg === '--no-serve') args.serve = 0;
    else if (arg.startsWith('--serve=')) args.serve = parseIntOr(arg.slice('--serve='.length), 8787);
    else if (arg.startsWith('--game=')) args.gameDir = arg.slice('--game='.length);
    else if (arg.startsWith('--user=')) args.target = arg.slice('--user='.length);
    else if (!arg.startsWith('-')) args.target = arg;
  }

  return args;
}

/**
 * 環境変数 + コマンドライン引数から最終的な設定を組み立てる。
 * コマンドライン引数のほうが優先される。
 */
export function buildConfig(argv) {
  const args = parseArgs(argv);

  const logLevel = (args.logLevel ?? process.env.LOG_LEVEL ?? 'info').toLowerCase();
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new Error(`LOG_LEVEL は ${LOG_LEVELS.join(' | ')} のいずれかにしてください (指定値: ${logLevel})`);
  }

  // 接続先はユーザー名でも URL でもよい。解決は src/target.js が行う。
  const target = (args.target ?? process.env.TIKTOK_TARGET ?? process.env.TIKTOK_USERNAME ?? '').trim();

  return {
    mock: args.mock,
    target,
    signApiKey: process.env.SIGN_API_KEY?.trim() || undefined,
    // tiktok-live-connector が実際に叩く署名サーバー。既定値はライブラリ側と同じ。
    signApiUrl: process.env.SIGN_API_URL?.trim() || 'https://api.eulerstream.com',
    waitUntilLiveSeconds: args.wait ?? parseIntOr(process.env.WAIT_UNTIL_LIVE_SECONDS, 0),
    // ギフト一覧の取得は署名 API (Euler Stream の有料プラン限定) を使うため既定では無効
    extendedGiftInfo: args.extendedGiftInfo || parseBool(process.env.EXTENDED_GIFT_INFO, false),
    logLevel,
    dumpRaw: args.raw ?? parseBool(process.env.DUMP_RAW, false),
    timestamps: args.timestamps || parseBool(process.env.TIMESTAMPS, false),
    // 0 より大きいとその秒数で自動終了する (動作確認用)
    durationSeconds: args.duration ?? parseIntOr(process.env.DURATION_SECONDS, 0),
    // ゲーム画面への中継サーバー。既定で立ち上がる (0 か --no-serve で無効)。
    // 起動に必要なのは接続先の URL だけ、という状態を保つための既定値。
    servePort: args.serve ?? parseIntOr(process.env.BRIDGE_PORT, 8787),
    serveHost: process.env.BRIDGE_HOST?.trim() || '127.0.0.1',
    // ゲームのフォルダ。未指定なら自動で探す。
    gameDir: args.gameDir ?? (process.env.GAME_DIR?.trim() || null),
  };
}
