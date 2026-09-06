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
 * プロフィール画像の URL を 1 つ選ぶ。
 *
 * protobuf の User は avatarThumb / avatarMedium / avatarLarge を持ち、
 * それぞれ複数サイズの URL が並んだ urlList を持つ。ゲーム側は円の中に
 * 小さく描くだけなので、100x100 の webp があればそれを優先する。
 * 取れなければ null。表示側が既定のアイコンに切り替える。
 */
export function pickProfileImage(user) {
  if (!user) return null;
  // すでに簡易化された User (ライブラリの legacy 経路) はこの 1 行で済む
  if (typeof user.profilePictureUrl === 'string' && user.profilePictureUrl) return user.profilePictureUrl;

  for (const image of [user.avatarThumb, user.avatarMedium, user.avatarLarge]) {
    const urls = image?.urlList;
    if (!Array.isArray(urls) || urls.length === 0) continue;
    return urls.find((url) => url.includes('100x100') && url.endsWith('.webp'))
      ?? urls.find((url) => url.includes('100x100'))
      ?? urls[0];
  }
  return null;
}

/**
 * ライブラリが返す User は protobuf 由来なので、
 * バージョン差を吸収して最低限のフィールドだけ取り出す。
 */
export function normalizeUser(user) {
  if (!user) return { id: null, uniqueId: 'unknown', nickname: 'unknown', profileImageUrl: null };
  const uniqueId = user.uniqueId ?? user.displayId ?? null;
  return {
    id: user.id ? String(user.id) : null,
    uniqueId: uniqueId ?? 'unknown',
    nickname: user.nickname ?? uniqueId ?? 'unknown',
    // ゲーム側で視聴者の円の中に表示する。取れないことも多いので null を許す。
    profileImageUrl: pickProfileImage(user),
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
