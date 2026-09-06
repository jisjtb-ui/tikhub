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

/** 画面に出すフォルダ名などをそのまま埋め込まないための最小限の処理。 */
function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** ゲームのフォルダか。名前ではなく中身で判断する (フォルダ名は自由に変えられるため)。 */
function looksLikeGame(dir) {
  try {
    return fs.statSync(path.join(dir, 'index.html')).isFile()
      && fs.statSync(path.join(dir, 'js', 'game.js')).isFile();
  } catch {
    return false;
  }
}

/** dir の中にあるフォルダを、ゲームらしい名前のものから順に返す。 */
function childDirs(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .map((e) => path.join(dir, e.name))
    .slice(0, 300);

  // 名前で当たりを付けるが、外れても中身で判定するので取りこぼさない
  const likely = (p) => /kawaii|game|vs/i.test(path.basename(p));
  return [...dirs.filter(likely), ...dirs.filter((p) => !likely(p))];
}

/**
 * ゲームのフォルダを**すべて**探す。
 *
 * 起動した場所から上へ 3 階層たどり、それぞれの中のフォルダを見ます。
 * ZIP を解凍すると `tikhub-main\tikhub-main\` のように同じ名前が二重になり、
 * その内側で起動すると「隣」に見えるはずのゲームが 2 階層上になるためです。
 *
 * 判定はフォルダ名ではなく中身 (index.html と js/game.js があるか) で行うので、
 * フォルダの名前を変えていても見つかります。
 *
 * 1 つに絞らないのは、ゲームを複数置いている人がいるためです。見つけた全部を
 * 配信して、どれを開くかはブラウザ側で選んでもらいます。
 *
 * @returns {string[]} 近い場所にあるものから順に。見つからなければ空配列
 */
export function findGameDirs(startDir = process.cwd(), limit = 8) {
  let dir = path.resolve(startDir);
  const found = [];

  const add = (candidate) => {
    if (!looksLikeGame(candidate)) return;
    const resolved = path.resolve(candidate);
    if (!found.includes(resolved)) found.push(resolved);
  };

  for (let level = 0; level < 4 && found.length < limit; level += 1) {
    for (const candidate of childDirs(dir)) {
      add(candidate);
      // ZIP の二重フォルダ (foo/foo/) にも 1 階層だけ潜る
      add(path.join(candidate, path.basename(candidate)));
    }
    const up = path.dirname(dir);
    if (up === dir) break;              // ドライブの一番上まで来た
    dir = up;
  }
  return found.slice(0, limit);
}

/**
 * ゲームのフォルダを 1 つ探す。複数あるときは最初の 1 つ。
 * @returns {string|null} 見つからなければ null (中継だけを行う)
 */
export function findGameDir(startDir = process.cwd()) {
  return findGameDirs(startDir, 1)[0] ?? null;
}

/** URL に使える名前へ均す。 */
function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

/** index.html の <title> を読む。画面の名前をそのまま選択肢に出すため。 */
function readTitle(dir) {
  try {
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8').slice(0, 8192);
    const match = /<title>([^<]{1,80})<\/title>/i.exec(html);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * フォルダから、そのゲームの id と表示名を作る。
 *
 * id は URL の一部になります (http://127.0.0.1:8787/circlebattle/)。
 * package.json の name を使うのは、フォルダ名を変えていても
 * 同じ URL になるようにするためです。
 *
 * @returns {{dir:string, id:string, title:string}}
 */
export function readGameInfo(dir) {
  let name = null;
  try {
    name = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name || null;
  } catch {
    /* package.json が無くても構わない */
  }
  const id = slug(name || path.basename(dir)) || 'game';
  return { dir: path.resolve(dir), id, title: readTitle(dir) || name || path.basename(dir) };
}

/** 同じ id が重なったら後ろに連番を付ける (同じゲームを 2 つ置いている場合)。 */
export function toGameList(dirs) {
  const games = [];
  for (const dir of dirs) {
    const info = readGameInfo(dir);
    let id = info.id;
    for (let n = 2; games.some((g) => g.id === id); n += 1) id = `${info.id}-${n}`;
    games.push({ ...info, id });
  }
  return games;
}

function statusPage(port) {
  return `<!doctype html><meta charset="utf-8"><title>TikTok LIVE Event Server</title>
<style>body{font-family:system-ui,sans-serif;background:#12101a;color:#eee;padding:48px;line-height:1.9}
code{background:#000;padding:3px 8px;border-radius:5px}a{color:#7cc7ff}</style>
<h1>TikTok LIVE Event Server</h1>
<p>イベントの中継は動いています。ただし<b>ゲームのフォルダが見つかりませんでした</b>。</p>
<p>ゲームのフォルダとは <code>index.html</code> と <code>js/game.js</code> が入っているフォルダです。
次のどちらかをしてください。</p>
<ul>
  <li>tikhub と<b>同じ場所に並べて</b>置き、tikhub を起動し直す</li>
  <li>起動時に <code>npm start -- --game="ゲームのフォルダ"</code> で直接指定する</li>
  <li>あるいはゲームの <code>index.html</code> を直接開く（自動でここに繋ぎにきます）</li>
</ul>
<p>ゲーム画面を直接開いた場合は、自動で <code>http://127.0.0.1:${port}/events</code> に繋ぎにいきます。</p>
<p><a href="/health">/health</a> で状態を確認できます。</p>`;
}

/** ゲームが複数見つかったときに出す選択画面。 */
function chooserPage(games) {
  const items = games.map((game) => `
  <li><a href="/${game.id}/">
    <b>${escapeHtml(game.title)}</b>
    <span>/${escapeHtml(game.id)}/</span>
    <em>${escapeHtml(game.dir)}</em>
  </a></li>`).join('');

  return `<!doctype html><meta charset="utf-8"><title>TikTok LIVE Event Server</title>
<style>body{font-family:system-ui,sans-serif;background:#12101a;color:#eee;padding:48px;line-height:1.7}
h1{letter-spacing:.06em}p{color:#a9a5c0}ul{list-style:none;padding:0;max-width:640px}
li{margin:12px 0}a{display:block;padding:16px 20px;border:1px solid #33305a;border-radius:12px;
background:#1a1830;color:#eee;text-decoration:none}a:hover{background:#242145;border-color:#5b57a8}
b{font-size:20px;display:block}span{color:#7cc7ff;font-size:13px}em{display:block;color:#6f6b8d;font-size:12px;font-style:normal;margin-top:4px}
code{background:#000;padding:3px 8px;border-radius:5px}</style>
<h1>どのゲームを開きますか</h1>
<p>ゲームのフォルダが ${games.length} つ見つかりました。配信に使うほうを選んでください。</p>
<ul>${items}</ul>
<p>1 つだけにしたいときは <code>npm start -- --game="フォルダ"</code> で指定できます。
イベントの中継 (<code>/events</code>) はどちらのゲームからでも同じものを受け取れます。</p>`;
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
export function createBridge({ port = 8787, host = '127.0.0.1', gameDir = null, games = null, live = null, logger }) {
  const clients = new Set();
  let keepalive = null;

  // gameDir (1 つ) でも games (複数) でも受け付ける。
  // 複数見つかったときは、それぞれを /<id>/ で配信し、/ で選ばせる。
  const gameList = games && games.length ? games : (gameDir ? toGameList([gameDir]) : []);
  const byId = new Map(gameList.map((game) => [game.id, game]));

  function liveState() {
    return live ? live.getState() : { status: 'unknown' };
  }

  function push(event, data) {
    const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(line);
  }

  // 接続先が変わったらブラウザへ知らせる (画面の表示を切り替えるため)
  live?.onChange((state) => push('status', state));

  function sendFile(res, dir, filePath) {
    // ゲームのフォルダの外へ出るリクエストは拒否する
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
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

    // ブラウザが必ず取りに来る。無いと毎回 404 がコンソールに出て紛らわしい。
    if (reqPath === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }

    if (reqPath === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        clients: clients.size,
        game: gameList.length > 0,
        games: gameList.map((game) => ({ id: game.id, title: game.title, dir: game.dir })),
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
        // 「待機中」も受け付けた扱いにする。まだ配信していないだけで、
        // 始まれば自動で繋がるため、利用者から見れば失敗ではない。
        res.end(JSON.stringify({
          ok: state.status === 'connected' || state.status === 'waiting',
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

    if (gameList.length === 0) {
      res.writeHead(reqPath === '/' ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(reqPath === '/' ? statusPage(port) : '');
      return;
    }

    // /<id>/... はそのゲームのフォルダから配信する。
    // ゲームが 1 つでも複数でも同じ URL で開けるようにしてあります。
    const scoped = /^\/([^/]+)(\/.*)?$/.exec(reqPath);
    if (scoped && byId.has(scoped[1])) {
      const game = byId.get(scoped[1]);
      if (!scoped[2]) {
        // 末尾の / が無いと css/js の相対パスが 1 階層ずれるので付け直す
        res.writeHead(302, { Location: `/${game.id}/` }).end();
        return;
      }
      sendFile(res, game.dir, path.join(game.dir, scoped[2] === '/' ? 'index.html' : scoped[2]));
      return;
    }

    if (reqPath === '/') {
      // 1 つしか無いならそのまま開く (今までと同じ)。複数なら選ばせる。
      if (gameList.length === 1) {
        sendFile(res, gameList[0].dir, path.join(gameList[0].dir, 'index.html'));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(chooserPage(gameList));
      }
      return;
    }

    if (gameList.length === 1) {
      sendFile(res, gameList[0].dir, path.join(gameList[0].dir, reqPath));
      return;
    }

    // 複数あるときは、どのゲームのファイルか決められない
    res.writeHead(404).end();
  });

  return {
    get clientCount() {
      return clients.size;
    },
    gameDir: gameList.length ? gameList[0].dir : null,
    games: gameList,

    start() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.removeListener('error', reject);
          // port に 0 を渡すと OS が空きポートを選ぶので、実際の番号を返す
          const actual = server.address();
          if (actual && typeof actual === 'object') port = actual.port;
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
