import process from 'node:process';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

// TTY のときだけ色を付ける (ファイルへリダイレクトしても読めるように)
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);

export const color = {
  dim: (t) => paint('2', t),
  bold: (t) => paint('1', t),
  red: (t) => paint('31', t),
  green: (t) => paint('32', t),
  yellow: (t) => paint('33', t),
  blue: (t) => paint('34', t),
  magenta: (t) => paint('35', t),
  cyan: (t) => paint('36', t),
};

function timestamp() {
  return new Date().toLocaleTimeString('ja-JP', { hour12: false });
}

export function createLogger(level = 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const emit = (levelName, label, args) => {
    if (LEVELS[levelName] < threshold) return;
    const stream = LEVELS[levelName] >= LEVELS.warn ? console.error : console.log;
    stream(`${color.dim(timestamp())} ${label}`, ...args);
  };

  return {
    level,
    debug: (...args) => emit('debug', color.dim('[debug]'), args),
    info: (...args) => emit('info', color.blue('[info ]'), args),
    warn: (...args) => emit('warn', color.yellow('[warn ]'), args),
    error: (...args) => emit('error', color.red('[error]'), args),
    /** イベント行はラベルを呼び出し側で組み立てる */
    event: (label, ...args) => emit('info', label, args),
    /** 罫線やバナーなど、装飾を付けずにそのまま出す */
    raw: (...args) => console.log(...args),
  };
}
