import { EventEmitter } from 'node:events';

import {
  normalizeChat,
  normalizeFollow,
  normalizeGift,
  normalizeLike,
  normalizeShare,
  normalizeViewer,
} from '../events.js';

/**
 * 実際の配信がなくても表示経路を検証するためのモック。
 *
 * 生ペイロードは本物と同じ形 (protobuf 由来のフィールド名) で作り、
 * 本番と同じ正規化関数を通す。つまりモックで動けば正規化と表示は正しい。
 */

const USERS = [
  { id: '1001', displayId: 'kawaii_fan', nickname: 'かわいい担当' },
  { id: '1002', displayId: 'beauty_fan', nickname: 'きれい担当' },
  { id: '1003', displayId: 'lurker99', nickname: 'ROM専' },
];

const GIFTS = [
  { id: '5655', name: 'Rose', diamondCount: 1, type: 1 },
  { id: '5827', name: 'Finger Heart', diamondCount: 5, type: 1 },
  { id: '6064', name: 'Galaxy', diamondCount: 1000, type: 2 },
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

export function createMockSource({ intervalMs = 1_500, logger } = {}) {
  const emitter = new EventEmitter();
  let timer = null;
  let totalLikes = 0;
  let stopping = false;

  function emitGift() {
    const gift = pick(GIFTS);
    const user = pick(USERS);
    const streakable = gift.type === 1;
    const repeatCount = streakable ? randInt(1, 10) : 1;

    // 連打ギフトは「途中経過 -> 確定」の 2 段階で飛んでくるので、その挙動も再現する
    const send = (count, repeatEnd) => {
      const raw = {
        user,
        gift,
        giftId: gift.id,
        repeatCount: count,
        repeatEnd,
        groupId: `mock-${Date.now()}`,
      };
      emitter.emit('event', normalizeGift(raw), raw);
    };

    if (streakable && repeatCount > 1) send(Math.max(1, repeatCount - 1), 0);
    send(repeatCount, 1);
  }

  function emitFollow() {
    const raw = { user: pick(USERS), followCount: String(randInt(1000, 9999)) };
    emitter.emit('event', normalizeFollow(raw), raw);
  }

  function emitLike() {
    const count = randInt(1, 15);
    totalLikes += count;
    const raw = { user: pick(USERS), count, total: String(totalLikes) };
    emitter.emit('event', normalizeLike(raw), raw);
  }

  function emitChat() {
    const raw = { user: pick(USERS), comment: pick(['かわいい！', 'beautiful!', 'がんばれー', '888']) };
    emitter.emit('event', normalizeChat(raw), raw);
  }

  function emitShare() {
    const raw = { user: pick(USERS) };
    emitter.emit('event', normalizeShare(raw), raw);
  }

  function emitViewer() {
    const raw = { totalUser: String(randInt(50, 500)) };
    emitter.emit('event', normalizeViewer(raw), raw);
  }

  // ギフト / フォロー / いいね を厚めに、その他も混ぜる
  const GENERATORS = [emitGift, emitGift, emitFollow, emitLike, emitLike, emitChat, emitShare, emitViewer];

  async function connect() {
    logger?.warn('モックモードで起動しました。TikTok には接続していません。');
    emitter.emit('connected', { roomId: 'mock-room' });
    timer = setInterval(() => {
      if (stopping) return;
      pick(GENERATORS)();
    }, intervalMs);
    return { roomId: 'mock-room' };
  }

  async function disconnect() {
    stopping = true;
    if (timer) clearInterval(timer);
    timer = null;
    emitter.emit('disconnected');
  }

  return { emitter, connect, disconnect, username: 'mock' };
}
