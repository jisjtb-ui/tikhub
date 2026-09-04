import { inspect } from 'node:util';
import { color } from './logger.js';
import { EventType } from './events.js';

const LABELS = {
  [EventType.GIFT]: color.magenta('[GIFT  ]'),
  [EventType.FOLLOW]: color.green('[FOLLOW]'),
  [EventType.LIKE]: color.red('[LIKE  ]'),
  [EventType.CHAT]: color.cyan('[CHAT  ]'),
  [EventType.SHARE]: color.yellow('[SHARE ]'),
  [EventType.MEMBER]: color.dim('[JOIN  ]'),
  [EventType.VIEWER]: color.dim('[VIEWER]'),
};

const num = (n) => Number(n).toLocaleString('ja-JP');

function who(user) {
  if (!user) return '';
  const handle = color.bold(`@${user.uniqueId}`);
  return user.nickname && user.nickname !== user.uniqueId ? `${handle} (${user.nickname})` : handle;
}

function describe(event) {
  switch (event.type) {
    case EventType.GIFT: {
      const streak = event.streakable && !event.finished ? color.dim(' …連打中') : '';
      return `${who(event.user)} が ${color.bold(event.giftName)} x${event.repeatCount}`
        + ` (${num(event.totalDiamonds)} diamonds)${streak}`;
    }
    case EventType.FOLLOW: {
      const total = event.totalFollowers != null ? color.dim(` [配信者フォロワー ${num(event.totalFollowers)}]`) : '';
      return `${who(event.user)} がフォローしました${total}`;
    }
    case EventType.LIKE: {
      const total = event.totalLikes != null ? color.dim(` [ルーム累計 ${num(event.totalLikes)}]`) : '';
      return `${who(event.user)} が いいね x${num(event.count)}${total}`;
    }
    case EventType.CHAT:
      return `${who(event.user)}: ${event.comment}`;
    case EventType.SHARE:
      return `${who(event.user)} がシェアしました`;
    case EventType.MEMBER:
      return `${who(event.user)} が入室しました`;
    case EventType.VIEWER:
      return `視聴者数 ${num(event.viewerCount)}`;
    default:
      return inspect(event, { depth: 3, colors: false });
  }
}

/**
 * 正規化済みイベントをコンソールへ出力し、あわせて集計を取る。
 */
export function createPrinter({ logger, dumpRaw = false }) {
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
    const label = LABELS[event.type] ?? color.dim(`[${event.type}]`);

    if (isInterimGift) {
      logger.debug(`${label} ${describe(event)}`);
    } else {
      logger.event(label, describe(event));
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
    const lines = [
      '',
      color.bold('===== セッション集計 ====='),
      `接続時間      : ${seconds} 秒`,
      `ギフト        : ${num(stats.counts[EventType.GIFT])} 件 / ${num(stats.diamonds)} diamonds`,
      `フォロー      : ${num(stats.counts[EventType.FOLLOW])} 件 (ユニーク ${num(stats.followers.size)} 人)`,
      `いいね        : ${num(stats.counts[EventType.LIKE])} 回 / ${num(stats.likes)} 個`,
      `コメント      : ${num(stats.counts[EventType.CHAT])} 件`,
      `シェア        : ${num(stats.counts[EventType.SHARE])} 件`,
      `入室          : ${num(stats.counts[EventType.MEMBER])} 件`,
      `最大視聴者数  : ${num(stats.peakViewers)}`,
      color.bold('=========================='),
    ];
    return lines.join('\n');
  }

  return { handle, summary, stats };
}
