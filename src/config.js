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
 */
export function parseArgs(argv = process.argv.slice(2)) {
  const args = { username: null, mock: false, raw: null, logLevel: null, wait: null, duration: null };

  for (const arg of argv) {
    if (arg === '--mock') args.mock = true;
    else if (arg === '--raw') args.raw = true;
    else if (arg.startsWith('--log-level=')) args.logLevel = arg.slice('--log-level='.length);
    else if (arg.startsWith('--wait=')) args.wait = parseIntOr(arg.slice('--wait='.length), null);
    else if (arg.startsWith('--duration=')) args.duration = parseIntOr(arg.slice('--duration='.length), null);
    else if (arg.startsWith('--user=')) args.username = arg.slice('--user='.length);
    else if (!arg.startsWith('-')) args.username = arg;
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

  const username = (args.username ?? process.env.TIKTOK_USERNAME ?? '').trim().replace(/^@/, '');

  return {
    mock: args.mock,
    username,
    signApiKey: process.env.SIGN_API_KEY?.trim() || undefined,
    waitUntilLiveSeconds: args.wait ?? parseIntOr(process.env.WAIT_UNTIL_LIVE_SECONDS, 0),
    logLevel,
    dumpRaw: args.raw ?? parseBool(process.env.DUMP_RAW, false),
    // 0 より大きいとその秒数で自動終了する (動作確認用)
    durationSeconds: args.duration ?? parseIntOr(process.env.DURATION_SECONDS, 0),
  };
}
