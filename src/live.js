/**
 * live.js - TikTok LIVE への接続を「あとから張り替えられる」形で持つ。
 *
 * 起動時に接続先が決まっていなくてもよく、あとからブラウザ側で URL を
 * 貼り付けて接続できるようにするための層です。
 *
 *   起動 -> (接続先なし) -> ブラウザで URL 貼り付け -> connect() -> 受信開始
 *
 * 接続先を差し替えるときは、前の接続を確実に切ってから張り直します。
 */
import { resolveTarget, TargetResolutionError } from './target.js';
import { createTikTokSource } from './sources/tiktok.js';
import { createMockSource } from './sources/mock.js';

/** 例外の種類から、視聴者にも分かる短い説明を作る。 */
export function explainError(err) {
  const hints = {
    UserOfflineError: 'この配信者は現在ライブ配信していません。',
    InvalidUniqueIdError: 'ユーザー名が正しくありません。',
    SignatureRateLimitError: '署名サーバーのレート制限に達しました。しばらく待ってください。',
    SignatureMissingTokensError: '署名サーバーがトークンを返しませんでした。',
    SignAPIError: '署名サーバーへのリクエストが失敗しました。',
    ConnectTimeoutError: '接続がタイムアウトしました。',
    PremiumFeatureError: 'この機能には Euler Stream の有料プランが必要です。',
    InvalidResponseCompositeError: 'TikTok に到達できませんでした。ネットワークを確認してください。',
  };
  return hints[err?.constructor?.name] ?? err?.message ?? '不明なエラー';
}

/**
 * @param {object} options { config, logger, onEvent }
 */
export function createLiveController({ config, logger, onEvent }) {
  let source = null;
  let state = { status: 'idle', target: null, username: null, roomId: null, message: null };
  const listeners = [];

  function setState(patch) {
    state = { ...state, ...patch };
    listeners.slice().forEach((fn) => fn(getState()));
  }

  function getState() {
    return { ...state };
  }

  /** 現在の接続を切る。接続していなければ何もしない。 */
  async function disconnect() {
    if (!source) return;
    const previous = source;
    source = null;
    try {
      await previous.disconnect();
    } catch {
      // 切断時のエラーは次の接続を妨げない
    }
    setState({ status: 'idle', username: null, roomId: null, message: null });
  }

  /**
   * 接続先を指定して繋ぐ。すでに繋がっていれば張り替える。
   *
   * @param {string} target ユーザー名 / プロフィール URL / 短縮 URL / '--mock'
   * @returns {Promise<object>} 結果の state
   */
  async function connect(target) {
    await disconnect();

    const wanted = String(target ?? '').trim();
    const mock = wanted === '--mock' || wanted === 'mock' || (!wanted && config.mock);
    setState({ status: 'connecting', target: mock ? 'mock' : wanted, message: null });

    let username = 'mock';
    let resolvedFrom = null;

    if (!mock) {
      try {
        ({ username, resolvedFrom } = await resolveTarget(wanted, { logger }));
      } catch (err) {
        const message = err instanceof TargetResolutionError
          ? err.message
          : `接続先を解決できませんでした: ${err.message}`;
        logger.error(message);
        setState({ status: 'error', message });
        return getState();
      }
    }

    const next = mock
      ? createMockSource({ logger })
      : createTikTokSource({
        username,
        signApiKey: config.signApiKey,
        waitUntilLiveSeconds: config.waitUntilLiveSeconds,
        extendedGiftInfo: config.extendedGiftInfo,
        logger,
      });

    next.emitter.on('event', (event, raw) => onEvent(event, raw));
    next.emitter.on('disconnected', () => logger.warn('切断されました'));
    next.emitter.on('end', (reason) => {
      logger.info(`配信が終了しました (${reason})`);
      setState({ status: 'ended', message: reason });
    });
    // connect() 中のエラーは下の catch でまとめて扱うので、ここでは記録だけ
    next.emitter.on('error', (err) => logger.debug(err.message));

    source = next;

    try {
      const result = await next.connect();
      logger.info(`接続しました (roomId: ${result.roomId})`);
      if (resolvedFrom) logger.debug(`短縮 URL の展開先: ${resolvedFrom}`);
      setState({
        status: 'connected',
        username,
        roomId: result.roomId ? String(result.roomId) : null,
        message: null,
      });
    } catch (err) {
      const message = explainError(err);
      logger.error(`接続に失敗しました: ${message}`);
      source = null;
      setState({ status: 'error', username, message });
    }
    return getState();
  }

  return {
    connect,
    disconnect,
    getState,
    onChange(fn) { listeners.push(fn); return this; },
    get isLive() { return state.status === 'connected'; },
  };
}
