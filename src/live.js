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
  // 接続要求が重なっても順番に処理する。並行して走ると、切ったつもりの
  // 前の配信が繋がったまま残ることがある。
  let queue = Promise.resolve();
  // 配信開始を待っている間の再試行タイマー
  let waitTimer = null;
  const RETRY_MS = 15_000;

  function setState(patch) {
    state = { ...state, ...patch };
    listeners.slice().forEach((fn) => fn(getState()));
  }

  function getState() {
    return { ...state };
  }

  function cancelWait() {
    if (waitTimer) clearTimeout(waitTimer);
    waitTimer = null;
  }

  /** まだ配信していない、という失敗かどうか。 */
  function isOffline(err) {
    return err?.constructor?.name === 'UserOfflineError'
      || /isn't online|not online|オフライン/i.test(err?.message ?? '');
  }

  /**
   * 現在の接続を切る。配信の開始待ちも取り消す。
   *
   * 待機中は接続オブジェクトを持っていないので、「繋いでいないから何もしない」
   * で抜けてしまうと status が 'waiting' のまま残り、画面が待機表示から
   * 戻らなくなる。状態を戻すところまでが切断の仕事。
   */
  async function disconnect() {
    const wasWaiting = Boolean(waitTimer) || state.status === 'waiting';
    cancelWait();

    if (source) {
      const previous = source;
      source = null;
      try {
        await previous.disconnect();
      } catch {
        // 切断時のエラーは次の接続を妨げない
      }
    } else if (!wasWaiting && state.status === 'idle') {
      return;                       // もともと何もしていない
    }

    setState({ status: 'idle', username: null, roomId: null, message: null });
  }

  /**
   * 接続先を指定して繋ぐ。すでに繋がっていれば張り替える。
   *
   * @param {string} target ユーザー名 / プロフィール URL / 短縮 URL / '--mock'
   * @returns {Promise<object>} 結果の state
   */
  function connect(target) {
    queue = queue.then(() => connectNow(target), () => connectNow(target));
    return queue;
  }

  async function connectNow(target) {
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
      // 「今どこに繋がっているのか」はコンソールで一番知りたい情報なので、
      // roomId だけでなく接続先の名前も必ず出す。
      logger.info(`接続しました: @${username}  (${mock ? 'モック' : 'ライブ'} / roomId: ${result.roomId})`);
      if (resolvedFrom) logger.info(`  短縮 URL の展開先: ${resolvedFrom}`);
      setState({
        status: 'connected',
        username,
        roomId: result.roomId ? String(result.roomId) : null,
        message: null,
      });
    } catch (err) {
      source = null;

      // まだ配信が始まっていないだけなら、失敗にせず開始を待つ。
      // 配信を始める前に URL を入れておく、という使い方ができるようにするため。
      if (isOffline(err)) {
        logger.info(`@${username} はまだ配信していません。開始を待ちます (${RETRY_MS / 1000} 秒ごとに確認)`);
        setState({
          status: 'waiting',
          username,
          message: `@${username} の配信開始を待っています…`,
        });
        cancelWait();
        waitTimer = setTimeout(() => { void connect(target); }, RETRY_MS);
        waitTimer.unref?.();
        return getState();
      }

      const message = explainError(err);
      logger.error(`接続に失敗しました: ${message}`);
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
