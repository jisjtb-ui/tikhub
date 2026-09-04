/**
 * 「接続先の指定」を解決する。
 *
 * 受け付ける形式:
 *   username
 *   @username
 *   https://www.tiktok.com/@username
 *   https://www.tiktok.com/@username/live
 *   https://vt.tiktok.com/XXXXXXXX/     (共有用の短縮 URL)
 *   https://vm.tiktok.com/XXXXXXXX/     (同上)
 *   https://www.tiktok.com/t/XXXXXXXX/  (同上)
 *
 * 短縮 URL はリダイレクト先を辿らないとユーザー名が分からないため、
 * ネットワークアクセスが必要になる。それ以外は完全にオフラインで解決できる。
 */

const SHORT_LINK_HOSTS = new Set(['vt.tiktok.com', 'vm.tiktok.com']);
const MAX_REDIRECTS = 5;

// TikTok のユーザー名に使える文字: 英数字 . _
const USERNAME_RE = /^[A-Za-z0-9._]{1,24}$/;

export class TargetResolutionError extends Error {
  /** @param {boolean} showUsage 入力の書き方が原因なら true (呼び出し側が usage を出す) */
  constructor(message, { showUsage = false } = {}) {
    super(message);
    this.name = 'TargetResolutionError';
    this.showUsage = showUsage;
  }
}

function parseUrl(input) {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

/** 短縮 URL かどうか (リダイレクトを辿る必要があるか) */
export function isShortLink(input) {
  const url = parseUrl(input);
  if (!url) return false;
  if (SHORT_LINK_HOSTS.has(url.hostname)) return true;
  // https://www.tiktok.com/t/XXXX/ も短縮 URL
  return url.hostname.endsWith('tiktok.com') && url.pathname.startsWith('/t/');
}

/**
 * URL または生の文字列からユーザー名を取り出す。
 * 取り出せない場合は null (短縮 URL は必ず null になる)。
 */
export function extractUsername(input) {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) return null;

  const url = parseUrl(trimmed);
  if (url) {
    if (!url.hostname.endsWith('tiktok.com')) return null;
    // パスの最初のセグメントが @username
    const segment = url.pathname.split('/').filter(Boolean)[0] ?? '';
    if (!segment.startsWith('@')) return null;
    const name = segment.slice(1);
    return USERNAME_RE.test(name) ? name : null;
  }

  const name = trimmed.replace(/^@/, '');
  return USERNAME_RE.test(name) ? name : null;
}

/**
 * 短縮 URL のリダイレクトを辿って最終 URL を得る。
 * @param {(url: string, init: object) => Promise<Response>} fetchImpl テスト用に差し替え可能
 */
export async function followRedirects(input, { fetchImpl = fetch, maxRedirects = MAX_REDIRECTS } = {}) {
  let current = input;

  for (let hop = 0; hop < maxRedirects; hop += 1) {
    const res = await fetchImpl(current, {
      redirect: 'manual',
      // 短縮 URL はユーザーエージェントによって返す先が変わることがある
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; tiktok-live-event-server/0.1)' },
    });

    const location = res.headers?.get?.('location');
    if (location) {
      current = new URL(location, current).toString();
      continue;
    }

    // リダイレクトされなかった。4xx/5xx なら短縮 URL が展開されていないので、
    // 「ユーザー名が取れない」ではなく到達性の問題として報告する。
    if (typeof res.status === 'number' && res.status >= 400) {
      throw new TargetResolutionError(
        `短縮 URL を展開できませんでした (HTTP ${res.status}): ${current}\n`
        + '  TikTok に到達できていない可能性があります。npm run doctor でネットワークを確認するか、\n'
        + '  ブラウザでこの URL を開いて @ユーザー名 を直接指定してください。',
      );
    }

    return current;
  }

  throw new TargetResolutionError(`リダイレクトが ${maxRedirects} 回を超えました: ${input}`);
}

/**
 * 接続先の指定を最終的なユーザー名へ解決する。
 * @returns {Promise<{ username: string, resolvedFrom: string|null }>}
 */
export async function resolveTarget(input, { fetchImpl = fetch, logger } = {}) {
  const raw = String(input ?? '').trim();
  if (!raw) {
    throw new TargetResolutionError(
      '接続先が指定されていません (.env の TIKTOK_TARGET か、実行時引数で指定してください)',
      { showUsage: true },
    );
  }

  const direct = extractUsername(raw);
  if (direct) return { username: direct, resolvedFrom: null };

  if (!isShortLink(raw)) {
    throw new TargetResolutionError(
      `接続先を解釈できませんでした: ${raw}\n`
      + '  ユーザー名 (@xxx)、プロフィール URL、共有用の短縮 URL のいずれかを指定してください。',
      { showUsage: true },
    );
  }

  logger?.info(`短縮 URL を解決しています: ${raw}`);

  let finalUrl;
  try {
    finalUrl = await followRedirects(raw, { fetchImpl });
  } catch (err) {
    if (err instanceof TargetResolutionError) throw err;
    // fetch 自体が失敗した (DNS / プロキシ / TLS など)
    throw new TargetResolutionError(
      `短縮 URL の展開に失敗しました: ${err.message}\n`
      + '  TikTok への通信が必要です。npm run doctor でネットワークを確認するか、\n'
      + '  ブラウザでこの URL を開いて @ユーザー名 を直接指定してください。',
    );
  }
  const username = extractUsername(finalUrl);

  if (!username) {
    throw new TargetResolutionError(
      `短縮 URL からユーザー名を取り出せませんでした。\n`
      + `  展開先: ${finalUrl}\n`
      + '  ブラウザでこの URL を開き、プロフィールの @ユーザー名 を直接指定してください。',
    );
  }

  return { username, resolvedFrom: finalUrl };
}
