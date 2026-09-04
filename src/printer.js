import { inspect } from 'node:util';
import { color } from './logger.js';
import { EventType } from './events.js';

/**
 * 出力形式は 1 行 1 イベントの `key=value` 形式で固定する。
 *
 *   [GIFT] user=xxx gift=xxx count=1 diamonds=5
 *   [LIKE] user=xxx count=10 total=48120
 *   [FOLLOW] user=xxx
 *   [COMMENT] user=xxx text=xxx
 *
 * 目視でも grep でも読めるようにするため、色はタグ部分にしか付けない。
 */
const TAGS = {
  [EventType.GIFT]: ['GIFT', color.magenta],
  [EventType.FOLLOW]: ['FOLLOW', color.green],
  [EventType.LIKE]: ['LIKE', color.red],
  [EventType.CHAT]: ['COMMENT', color.cyan],
  [EventType.SHARE]: ['SHARE', color.yellow],
  [EventType.MEMBER]: ['JOIN', color.dim],
  [EventType.VIEWER]: ['VIEWER', color.dim],
};

const num = (n) => Number(n).toLocaleString('ja-JP');

/** 改行は 1 行 1 イベントを崩すので潰す */
const oneLine = (text) => String(text ?? '').replace(/\s*\n\s*/g, ' ');

/** value が null/undefined のフィールドは出力しない */
function fields(pairs) {
  return pairs
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
}

function body(event) {
  const user = event.user?.uniqueId ?? null;

  switch (event.type) {
    case EventType.GIFT:
      return fields([
        ['user', user],
        ['gift', event.giftName],
        ['count', event.repeatCount],
        ['diamonds', event.totalDiamonds],
      ]);
    case EventType.FOLLOW:
      return fields([['user', user]]);
    case EventType.LIKE:
      return fields([
        ['user', user],
        ['count', event.count],
        ['total', event.totalLikes],
      ]);
    case EventType.CHAT:
      return fields([
        ['user', user],
        ['text', oneLine(event.comment)],
      ]);
    case EventType.SHARE:
    case EventType.MEMBER:
      return fields([['user', user]]);
    case EventType.VIEWER:
      return fields([['count', event.viewerCount]]);
    default:
      return inspect(event, { depth: 3, colors: false });
  }
}

/** 1 イベント = 1 行の文字列を組み立てる (テストしやすいよう副作用なし) */
export function formatEvent(event) {
  const [name, paint] = TAGS[event.type] ?? [event.type.toUpperCase(), (t) => t];
  return `${paint(`[${name}]`)} ${body(event)}`;
}

/**
 * 正規化済みイベントをコンソールへ出力し、あわせて集計を取る。
 */
export function createPrinter({ logger, dumpRaw = false, timestamps = false }) {
  const stats = {
    startedAt: Date.now(),
    counts: Object.fromEntries(Object.values(EventType).map((t) => [t, 0])),
    diamonds: 0,
    likes: 0,
    followers: new Set(),
    peakViewers: 0,
  };

  function handle(event, raw) {
    // 連打ギフトの途中経過は debug のときだけ出す (通常は確定時の 1 行のみ)
    const isInterimGift = event.type === EventType.GIFT && !event.finished;
    const line = formatEvent(event);
    const prefix = timestamps ? `${color.dim(new Date().toLocaleTimeString('ja-JP', { hour12: false }))} ` : '';

    if (isInterimGift) {
      logger.debug(`${line} ${color.dim('(連打中)')}`);
    } else {
      logger.line(`${prefix}${line}`);
    }

    if (dumpRaw && raw !== undefined) {
      logger.debug(color.dim(inspect(raw, { depth: 4, colors: false, breakLength: 120 })));
    }

    // 集計 (連打ギフトは確定分のみカウントして二重計上を防ぐ)
    if (isInterimGift) return;
    stats.counts[event.type] = (stats.counts[event.type] ?? 0) + 1;
    if (event.type === EventType.GIFT) stats.diamonds += event.totalDiamonds;
    if (event.type === EventType.LIKE) stats.likes += event.count;
    if (event.type === EventType.FOLLOW && event.user?.uniqueId) stats.followers.add(event.user.uniqueId);
    if (event.type === EventType.VIEWER) stats.peakViewers = Math.max(stats.peakViewers, event.viewerCount);
  }

  function summary() {
    const seconds = Math.round((Date.now() - stats.startedAt) / 1000);
    return [
      '',
      color.bold('===== セッション集計 ====='),
      `接続時間      : ${seconds} 秒`,
      `ギフト        : ${num(stats.counts[EventType.GIFT])} 件 / ${num(stats.diamonds)} diamonds`,
      `いいね        : ${num(stats.counts[EventType.LIKE])} 回 / ${num(stats.likes)} 個`,
      `フォロー      : ${num(stats.counts[EventType.FOLLOW])} 件 (ユニーク ${num(stats.followers.size)} 人)`,
      `コメント      : ${num(stats.counts[EventType.CHAT])} 件`,
      `シェア        : ${num(stats.counts[EventType.SHARE])} 件`,
      `入室          : ${num(stats.counts[EventType.MEMBER])} 件`,
      `最大視聴者数  : ${num(stats.peakViewers)}`,
      color.bold('=========================='),
    ].join('\n');
  }

  return { handle, summary, stats };
}
