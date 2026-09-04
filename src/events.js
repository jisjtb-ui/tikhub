/**
 * TikTok LIVE の生ペイロードを、このサーバー内で共通に扱う形へ正規化する。
 *
 * ここで一度形を揃えておくことで、あとで別のデータ源 (別ライブラリ / モック /
 * 将来のゲーム連携) に差し替えても下流のコードを変えずに済む。
 */

export const EventType = {
  GIFT: 'gift',
  FOLLOW: 'follow',
  LIKE: 'like',
  CHAT: 'chat',
  SHARE: 'share',
  MEMBER: 'member',
  VIEWER: 'viewer',
};

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * ライブラリが返す User は protobuf 由来なので、
 * バージョン差を吸収して最低限のフィールドだけ取り出す。
 */
export function normalizeUser(user) {
  if (!user) return { id: null, uniqueId: 'unknown', nickname: 'unknown' };
  const uniqueId = user.uniqueId ?? user.displayId ?? null;
  return {
    id: user.id ? String(user.id) : null,
    uniqueId: uniqueId ?? 'unknown',
    nickname: user.nickname ?? uniqueId ?? 'unknown',
  };
}

function baseEvent(type, user) {
  return { type, at: new Date().toISOString(), user: normalizeUser(user) };
}

export function normalizeGift(data) {
  const gift = data.gift ?? {};
  // gift.type === 1 は「連打 (ストリーク) 可能」なギフト。
  // 連打中は repeatEnd === 0 で何度も飛んでくるので、確定は repeatEnd === 1 のとき。
  const streakable = toNumber(gift.type) === 1;
  const repeatCount = toNumber(data.repeatCount, 1);
  const finished = !streakable || toNumber(data.repeatEnd) === 1;
  const diamondCount = toNumber(gift.diamondCount ?? data.extendedGiftInfo?.diamond_count);

  return {
    ...baseEvent(EventType.GIFT, data.user),
    giftId: data.giftId ? String(data.giftId) : null,
    giftName: gift.name ?? 'unknown gift',
    diamondCount,
    repeatCount,
    streakable,
    finished,
    // 連打が確定したときの合計ダイヤ数 (途中経過では暫定値)
    totalDiamonds: diamondCount * repeatCount,
    groupId: data.groupId ? String(data.groupId) : null,
  };
}

export function normalizeFollow(data) {
  return {
    ...baseEvent(EventType.FOLLOW, data.user),
    // 配信者の総フォロワー数。取得できないこともある。
    totalFollowers: data.followCount ? toNumber(data.followCount, null) : null,
  };
}

export function normalizeLike(data) {
  return {
    ...baseEvent(EventType.LIKE, data.user),
    // このイベントで送られた「いいね」の数 (まとめて飛んでくる)
    count: toNumber(data.count, 1),
    // ルーム全体の累計「いいね」数
    totalLikes: data.total ? toNumber(data.total, null) : null,
  };
}

export function normalizeChat(data) {
  return { ...baseEvent(EventType.CHAT, data.user), comment: data.comment ?? data.content ?? '' };
}

export function normalizeShare(data) {
  return { ...baseEvent(EventType.SHARE, data.user) };
}

export function normalizeMember(data) {
  return { ...baseEvent(EventType.MEMBER, data.user) };
}

export function normalizeViewer(data) {
  return {
    type: EventType.VIEWER,
    at: new Date().toISOString(),
    user: null,
    viewerCount: toNumber(data.totalUser ?? data.total ?? data.viewerCount, 0),
  };
}
