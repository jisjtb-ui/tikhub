/**
 * bridge.js - 受信したイベントをブラウザへ中継する。
 *
 *   TikTok  ->  このサーバー  ->  (SSE)  ->  ゲーム画面
 *
 * ブラウザから TikTok へ直接つなぐことはできないので、ここが唯一の出口です。
 *
 * WebSocket ではなく SSE (Server-Sent Events) を使っています。
 *   - 送るのはサーバー -> ブラウザの一方向だけで、双方向は要らない
 *   - Node の http とブラウザの EventSource だけで済み、依存が増えない
 *   - 切断時の再接続をブラウザが自前でやってくれる
 *
 * 起動しない限りポートは開きません (--serve を付けたときだけ)。
 */
import http from 'node:http';

const KEEPALIVE_MS = 25_000;

/**
 * @param {object} options { port, host, logger }
 */
export function createBridge({ port = 8787, host = '127.0.0.1', logger }) {
  const clients = new Set();
  let keepalive = null;

  const server = http.createServer((req, res) => {
    // ゲーム画面は file:// から開かれることもある (Origin: null) ため全許可する。
    // 流すのは配信中の公開イベントだけで、受け付ける操作は無い。
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const path = (req.url || '/').split('?')[0];

    if (path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, clients: clients.size }));
      return;
    }

    if (path !== '/events') {
      res.writeHead(404).end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // 最初の 1 行で接続が確立したことをブラウザ側に知らせる
    res.write('event: ready\ndata: {}\n\n');

    clients.add(res);
    logger?.info(`ゲーム画面が接続しました (現在 ${clients.size} 台)`);

    req.on('close', () => {
      clients.delete(res);
      logger?.info(`ゲーム画面が切断しました (現在 ${clients.size} 台)`);
    });
  });

  return {
    get clientCount() {
      return clients.size;
    },

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
