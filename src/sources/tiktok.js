import { EventEmitter } from 'node:events';
import {
  TikTokLiveConnection,
  WebcastEvent,
  ControlEvent,
} from 'tiktok-live-connector';

import {
  normalizeChat,
  normalizeFollow,
  normalizeGift,
  normalizeLike,
  normalizeMember,
  normalizeShare,
  normalizeViewer,
} from '../events.js';

/**
 * ライブラリのイベント名 -> 正規化関数の対応表。
 * ここに 1 行足すだけで購読イベントを増やせる。
 */
const HANDLERS = [
  [WebcastEvent.GIFT, normalizeGift],
  [WebcastEvent.FOLLOW, normalizeFollow],
  [WebcastEvent.LIKE, normalizeLike],
  [WebcastEvent.CHAT, normalizeChat],
  [WebcastEvent.SHARE, normalizeShare],
  [WebcastEvent.MEMBER, normalizeMember],
  [WebcastEvent.ROOM_USER, normalizeViewer],
];

const RECONNECT_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000];

/**
 * 非公式ライブラリ tiktok-live-connector を使って TikTok LIVE に接続するイベント源。
 *
 * 発行するイベント:
 *   'event'        (normalizedEvent, rawPayload)
 *   'connected'    ({ roomId })
 *   'disconnected' ()
 *   'end'          (reason)  再接続しない終了
 *   'error'        (Error)
 */
export function createTikTokSource({ username, signApiKey, waitUntilLiveSeconds = 0, logger }) {
  if (!username) {
    throw new Error('TikTok のユーザー名が指定されていません (.env の TIKTOK_USERNAME か、実行時引数で指定してください)');
  }

  const emitter = new EventEmitter();
  let stopping = false;
  let reconnectAttempt = 0;

  const connection = new TikTokLiveConnection(username, {
    signApiKey,
    // ギフトのダイヤ数など、追加情報を取得する
    enableExtendedGiftInfo: true,
    // 接続時にルーム情報を取得し、オフラインなら UserOfflineError を投げる
    fetchRoomInfoOnConnect: true,
    // 接続直後にまとめて送られてくる「過去のイベント」は流さない。
    // コンソールに出るのは接続後にリアルタイムで起きたイベントだけになる。
    processInitialData: false,
  });

  for (const [eventName, normalize] of HANDLERS) {
    connection.on(eventName, (data) => {
      try {
        emitter.emit('event', normalize(data), data);
      } catch (err) {
        logger.error(`イベント (${eventName}) の処理に失敗しました:`, err);
      }
    });
  }

  connection.on(ControlEvent.ERROR, (err) => {
    emitter.emit('error', err instanceof Error ? err : new Error(String(err)));
  });

  connection.on(WebcastEvent.STREAM_END, () => {
    stopping = true;
    emitter.emit('end', '配信が終了しました');
  });

  connection.on(ControlEvent.DISCONNECTED, () => {
    emitter.emit('disconnected');
    if (!stopping) void reconnect();
  });

  async function reconnect() {
    const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    reconnectAttempt += 1;
    logger.warn(`接続が切れました。${delay / 1000} 秒後に再接続します (${reconnectAttempt} 回目)`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (stopping) return;
    try {
      await connect();
    } catch (err) {
      if (!stopping) void reconnect();
      logger.error('再接続に失敗しました:', err.message);
    }
  }

  async function connect() {
    if (waitUntilLiveSeconds > 0) {
      const live = await connection.fetchIsLive();
      if (!live) {
        logger.info(`@${username} はまだ配信していません。最大 ${waitUntilLiveSeconds} 秒待機します…`);
        await connection.waitUntilLive(waitUntilLiveSeconds);
      }
    }

    const state = await connection.connect();
    reconnectAttempt = 0;
    emitter.emit('connected', { roomId: state.roomId });
    return state;
  }

  async function disconnect() {
    stopping = true;
    await connection.disconnect();
  }

  return { emitter, connect, disconnect, connection, username };
}
