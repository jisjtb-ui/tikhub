/**
 * bridge.js - ゲーム画面へイベントを中継し、ゲーム本体も配信するサーバー。
 *
 *   TikTok  ->  このサーバー  ->  (SSE)  ->  ゲーム画面
 *
 * ブラウザから TikTok へ直接つなぐことはできないので、ここが唯一の出口です。
 *
 * ゲームのフォルダが見つかれば、その HTML / CSS / JS もここから配信します。
 * すると視聴者側の準備は「ブラウザで 1 つの URL を開く」だけで済み、
 * file:// を開いたりコンソールにコマンドを打ったりする必要がなくなります。
 *
 *   http://127.0.0.1:8787/          ゲーム画面
 *   http://127.0.0.1:8787/events    イベントの流れ (SSE)
 *   http://127.0.0.1:8787/health    状態確認
 *
 * WebSocket ではなく SSE なのは、送るのがサーバー -> ブラウザの一方向だけで、
 * Node の http とブラウザの EventSource だけで完結するからです。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const KEEPALIVE_MS = 25_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** ゲームのフォルダらしいか (index.html があるか)。 */
function looksLikeGame(dir) {
  try {
    return fs.statSync(path.join(dir, 'index.html')).isFile();
  } catch {
    return false;
  }
}

/**
 * ゲームのフォルダを探す。
 *
 * tikhub と並べて置かれている前提で、親フォルダから名前に kawaii を含む
 * ものを探します。見つからなければ null (中継だけを行う)。
 */
export function findGameDir(startDir = process.cwd()) {
  const parent = path.resolve(startDir, '..');
  const candidates = [path.join(startDir, 'game'), path.join(parent, 'game')];

  try {
    for (const name of fs.readdirSync(parent)) {
      if (/kawaii/i.test(name)) candidates.push(path.join(parent, name));
    }
  } catch {
    // 親フォルダが読めなくても探索を続ける
  }

  for (const dir of candidates) {
    if (looksLikeGame(dir)) return dir;
    // ZIP を解凍すると同じ名前が二重になることがある
    const nested = path.join(dir, path.basename(dir));
    if (looksLikeGame(nested)) return nested;
  }
  return null;
}

function statusPage(port) {
  return `<!doctype html><meta charset="utf-8"><title>TikTok LIVE Event Server</title>
<style>body{font-family:system-ui,sans-serif;background:#12101a;color:#eee;padding:48px;line-height:1.9}
code{background:#000;padding:3px 8px;border-radius:5px}a{color:#7cc7ff}</style>
<h1>TikTok LIVE Event Server</h1>
<p>イベントの中継は動いています。ただし<b>ゲームのフォルダが見つかりませんでした</b>。</p>
<p>ゲーム画面を開いたうえで、次のどちらかをしてください。</p>
<ul>
  <li>ゲームのフォルダを tikhub と<b>同じ場所に並べて</b>置き、tikhub を起動し直す</li>
  <li>または起動時に <code>--game=ゲームのフォルダ</code> を付ける</li>
</ul>
<p>ゲーム画面を直接開いた場合は、自動で <code>http://127.0.0.1:${port}/events</code> に繋ぎにいきます。</p>
<p><a href="/health">/health</a> で状態を確認できます。</p>`;
}

/**
 * @param {object} options { port, host, gameDir, logger }
 */
/** ローカルからのアクセスか。接続先の変更はここからだけ受け付ける。 */
function isLoopback(req) {
  const addr = req.socket?.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function readJson(req, limit = 4096) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > limit) { req.destroy(); resolve(null); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

/**
 * @param {object} options
 *   port, host, gameDir, logger
 *   live … 接続先を差し替えるための操作口 (createLiveController)。
 *          渡すとブラウザから URL を貼り付けて接続できるようになる。
 */
export function createBridge({ port = 8787, host = '127.0.0.1', gameDir = null, live = null, logger }) {
  const clients = new Set();
  let keepalive = null;

  function liveState() {
    return live ? live.getState() : { status: 'unknown' };
  }

  function push(event, data) {
    const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(line);
  }

  // 接続先が変わったらブラウザへ知らせる (画面の表示を切り替えるため)
  live?.onChange((state) => push('status', state));

  function sendFile(res, filePath) {
    // gameDir の外へ出るリクエストは拒否する
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(gameDir) + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(resolved, (err, body) => {
      if (err) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(body);
    });
  }

  const server = http.createServer((req, res) => {
    // ゲーム画面は file:// から開かれることもある (Origin: null) ため全許可する。
    // 流すのは配信中の公開イベントだけで、受け付ける操作は無い。
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const reqPath = decodeURIComponent((req.url || '/').split('?')[0]);

    if (reqPath === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        clients: clients.size,
        game: Boolean(gameDir),
        control: Boolean(live),
        live: liveState(),
      }));
      return;
    }

    // ブラウザから接続先を貼り付けて繋ぐ / 切る。
    // 同じ PC からのアクセスだけを受け付ける (LAN に公開しても操作はされない)。
    if (reqPath === '/connect' || reqPath === '/disconnect') {
      if (!live) { res.writeHead(404).end(); return; }
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      if (!isLoopback(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: 'この操作は tikhub を動かしている PC からのみ行えます' }));
        return;
      }

      (async () => {
        if (reqPath === '/disconnect') {
          await live.disconnect();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, live: liveState() }));
          return;
        }

        const body = await readJson(req);
        const target = body && typeof body.target === 'string' ? body.target.trim() : '';
        if (!target) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: '接続先が空です' }));
          return;
        }

        logger?.info(`ブラウザから接続を要求されました: ${target}`);
        const state = await live.connect(target);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // 失敗の理由はそのまま返す。画面に「接続できませんでした」としか
        // 出ないと、配信していないのか URL が違うのか分からなくなる。
        res.end(JSON.stringify({
          ok: state.status === 'connected',
          message: state.message || null,
          live: state,
        }));
      })();
      return;
    }

    if (reqPath === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      // 最初の 1 行で、接続できたことと今の配信の状態を知らせる
      res.write(`event: ready\ndata: ${JSON.stringify({ control: Boolean(live), live: liveState() })}\n\n`);

      clients.add(res);
      logger?.info(`ゲーム画面が接続しました (現在 ${clients.size} 台)`);

      req.on('close', () => {
        clients.delete(res);
        logger?.info(`ゲーム画面が切断しました (現在 ${clients.size} 台)`);
      });
      return;
    }

    if (!gameDir) {
      res.writeHead(reqPath === '/' ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(reqPath === '/' ? statusPage(port) : '');
      return;
    }

    sendFile(res, path.join(gameDir, reqPath === '/' ? 'index.html' : reqPath));
  });

  return {
    get clientCount() {
      return clients.size;
    },
    gameDir,

    start() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.removeListener('error', reject);
          // プロキシや中間層が切らないよう、定期的にコメント行を送る
          keepalive = setInterval(() => {
            for (const res of clients) res.write(': ping\n\n');
          }, KEEPALIVE_MS);
          keepalive.unref();
          resolve({ port, host });
        });
      });
    },

    /**
     * 正規化済みイベントを接続中のブラウザ全部へ流す。
     *
     * 連打ギフトの途中経過は送りません。ゲーム側で二重に加算されてしまうためで、
     * 連打が確定したときの 1 件だけを送ります (コンソール表示と同じ扱い)。
     */
    broadcast(event) {
      if (!event) return false;
      if (event.type === 'gift' && event.finished === false) return false;
      if (clients.size === 0) return false;

      const line = `data: ${JSON.stringify(event)}\n\n`;
      for (const res of clients) res.write(line);
      return true;
    },

    close() {
      clearInterval(keepalive);
      for (const res of clients) res.end();
      clients.clear();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
