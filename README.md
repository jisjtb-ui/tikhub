# TikTok LIVE Event Server

TikTok LIVE からリアルタイムイベントを受信し、**コンソールに表示するだけ**の検証用サーバーです。

- KAWAII vs BEAUTIFUL のゲーム本体とは**独立した別プロジェクト**です。
- 現時点の目的は **ギフト / いいね / フォロー / コメント が取得できるかの検証**のみ。
- **ゲームへの接続は実装していません。**

> ### ⚠️ 非公式ライブラリを使用しています
>
> TikTok には LIVE のリアルタイムイベントを取得する**公式 API がありません**。
> 本プロジェクトは非公式 OSS の [`tiktok-live-connector`](https://github.com/zerodytrash/TikTok-Live-Connector)
> (リバースエンジニアリングされた webcast プロトコル実装) を使用しています。
> TikTok 側の仕様変更で動かなくなる可能性があり、利用規約上もグレーです。
> 調査の詳細・他の選択肢・リスクは [`docs/RESEARCH.md`](docs/RESEARCH.md) を参照してください。

---

## 必要なもの

- Node.js 20.12 以上 (推奨 22)
- `tiktok.com` と署名サーバー `api.eulerstream.com` に到達できるネットワーク
- **配信中の** TikTok LIVE

TikTok のログインもアプリ登録も不要です。

---

## セットアップ

```bash
npm install
cp .env.example .env    # 任意。接続先は実行時引数でも指定できます
```

---

## 使い方

### いちばん簡単な使い方

**接続先を指定せずに起動できます。**

```bash
npm start
```

出てきた URL をブラウザで開くと、画面に貼り付け欄が出ます。
そこへ LIVE の URL を貼って「接続」を押せば繋がります。
コマンドに URL を書く必要がありません。

```
  ブラウザでこの URL を開いてください
      http://127.0.0.1:8787/
```

配信を変えたいときも、同じ欄に別の URL を貼るだけです。tikhub を止める必要はありません。

> 接続先の変更を受け付けるのは **tikhub を動かしている PC からのアクセスだけ**です。
> `BRIDGE_HOST=0.0.0.0` で LAN に公開しても、他の端末から配信先を変えることはできません。

### コマンドで接続先を渡す

接続先は**ユーザー名でも URL でも**指定できます。共有用の短縮 URL (`vt.tiktok.com/...`) は
自動でリダイレクトを辿って `@ユーザー名` に展開します。

```bash
npm start -- @username
npm start -- https://www.tiktok.com/@username/live
npm start -- https://vt.tiktok.com/XXXXXXXX/
```

### 検証の手順 (推奨)

段階を分けると、うまくいかないときの切り分けが楽になります。

```bash
# 1. 環境チェック (Node のバージョン / ライブラリ / TikTok と署名サーバーへの到達性)
npm run doctor

# 2. 表示経路の確認 (TikTok には接続しません)
npm run mock

# 3. 接続先の解決だけを確認 (短縮 URL が @ユーザー名 に展開できるか)
npm run resolve -- https://vt.tiktok.com/XXXXXXXX/

# 4. 実際の LIVE に接続 (配信中に実行してください)
npm start -- https://vt.tiktok.com/XXXXXXXX/
```

`接続しました (roomId: ...)` が出れば接続成功です。終了は `Ctrl+C`
(終了時にセッション集計を表示します)。

### オプション

```
--mock              モックモード (ネットワーク接続なし)
--raw               生ペイロードも出力する (--log-level=debug と併用)
--timestamps        各行の先頭に時刻を付ける
--extended-gift-info  ギフト一覧も取得する (Euler Stream の有料プランが必要)
--wait=SECONDS      配信開始まで待機する秒数 (例: --wait=600)
--duration=SECONDS  指定秒数で自動終了する
--serve=PORT        中継サーバーのポートを変える (既定 8787)
--no-serve          中継サーバーを立てない (コンソール表示だけ)
--game=DIR          ゲームのフォルダを指定する (未指定なら自動で探す)
--log-level=LEVEL   debug | info | warn | error
```

### `.env`

| 変数 | 説明 |
| --- | --- |
| `TIKTOK_TARGET` | 接続先 (ユーザー名 / プロフィール URL / 短縮 URL) |
| `SIGN_API_KEY` | 署名サーバー [Euler Stream](https://www.eulerstream.com) の API キー。**未設定でも無料枠で動作します** |
| `SIGN_API_URL` | 署名サーバーのベース URL。未設定なら `https://api.eulerstream.com` |
| `WAIT_UNTIL_LIVE_SECONDS` | まだ配信中でないとき、開始を待つ秒数 (0 = 待たない) |
| `BRIDGE_PORT` | 中継サーバーのポート (既定 8787。`0` で無効) |
| `GAME_DIR` | ゲームのフォルダ (未設定なら自動で探す) |
| `BRIDGE_HOST` | 中継サーバーの待ち受けアドレス。既定 `127.0.0.1` |
| `EXTENDED_GIFT_INFO` | `true` でギフト一覧も取得する。**Euler Stream の有料プランが必要**。既定は `false` |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` |
| `TIMESTAMPS` | `true` で各行に時刻を付ける |
| `DUMP_RAW` | `true` で生ペイロードも出力 |

---

## 出力形式

1 行 1 イベントの `key=value` 形式です。目視でも `grep` でも読めます。

```
[GIFT] user=xxx gift=Rose count=5 diamonds=5
[LIKE] user=xxx count=10 total=48120
[FOLLOW] user=xxx
[COMMENT] user=xxx text=かわいい！
```

参考として次も表示します。

```
[SHARE] user=xxx
[JOIN] user=xxx
[VIEWER] count=1204
```

実行例:

```
TikTok LIVE Event Server
  ギフト / いいね / フォロー / コメント をリアルタイムでコンソールに表示します
  対象: @example_user  モード: live
  短縮 URL の展開先: https://www.tiktok.com/@example_user/live
  署名 API キー: 未設定 (無料枠)

21:03:11 [info ] 接続しました (roomId: 7412345678901234567)
21:03:11 [info ] イベント待機中… 終了するには Ctrl+C
[VIEWER] count=1204
[FOLLOW] user=kawaii_fan
[LIKE] user=lurker99 count=12 total=48120
[COMMENT] user=beauty_fan text=かわいい！
[GIFT] user=beauty_fan gift=Rose count=5 diamonds=5
```

**連打ギフトについて:** バラなどの連打可能なギフトは、連打中に何度もイベントが飛んできます。
本サーバーは**連打が確定したときの 1 行だけ**を表示し、途中経過は `--log-level=debug` のときのみ表示します。
集計も確定分のみを数えるため、二重計上されません。

---

## 成功条件と検証状況

> 実際の TikTok LIVE 中にイベントが発生したとき、サーバーのコンソールにイベント情報が表示されること。

確認手順:

1. 対象の LIVE が配信中であることを確認する
2. `npm start -- <LIVE の URL>` を実行し、`接続しました (roomId: ...)` が出ることを確認する
3. 別端末 / 別アカウントからその LIVE に対して次を実行する
   - **いいね** をタップ → `[LIKE]` が出る
   - **コメント** を投稿 → `[COMMENT]` が出る
   - **フォロー** する → `[FOLLOW]` が出る
   - **ギフト** (バラ 1 個など) を送る → `[GIFT]` が出る
4. 4 種類すべてが表示されれば成功

### 現時点の検証状況

| 項目 | 状況 |
| --- | --- |
| 出力形式・イベント正規化・連打ギフトの重複排除 | ✅ 検証済み (`npm run mock`) |
| 接続先の解決 (ユーザー名 / URL / 短縮 URL) — オフライン | ✅ 検証済み (`npm test` — 12 件のテスト) |
| エラー時の切り分けメッセージ | ✅ 検証済み |
| TikTok / 署名サーバーへの到達性 | ✅ 検証済み (`npm run doctor` が全項目 OK) |
| 短縮 URL の実展開 (`vt.tiktok.com/...` → `@ユーザー名`) | ✅ 検証済み (実ネットワーク) |
| **配信中の LIVE への接続 (roomId 取得 → WebSocket)** | ✅ **検証済み (実配信)** |
| **`[GIFT]` / `[LIKE]` / `[FOLLOW]` / `[COMMENT]` の受信** | ✅ **検証済み (実配信)** |

実際の配信 (視聴者 約 8,000 人) に接続して 301 秒間受信した結果:

```
===== セッション集計 =====
接続時間      : 301 秒
ギフト        : 9 件 / 117 diamonds
いいね        : 255 回 / 3,609 個
フォロー      : 1 件 (ユニーク 1 人)
コメント      : 55 件
シェア        : 1 件
入室          : 116 件
最大視聴者数  : 8,287
==========================
```

成功条件である 4 種類 (`[GIFT]` / `[LIKE]` / `[FOLLOW]` / `[COMMENT]`) がすべて表示されることを確認しました。
`[FOLLOW]` と `[COMMENT]` は、別端末から実際に操作して該当行が出ることまで確認しています。

```
5:19:46 [FOLLOW]  user=<検証用アカウント>
5:20:51 [COMMENT] user=<検証用アカウント> text=bomdia
```

301 秒間、切断・再接続なしで受信し続けました。

---

## 最新版に更新する

**ZIP を落とし直す必要はありません。**

```bash
npm run update
```

tikhub とゲームの両方を、その場で最新版に書き換えます。git も不要です。

```
最新版に更新します

  tikhub  6 ファイルを更新
      src/bridge.js
      src/index.js
      src/live.js
      …
  ゲーム   8 ファイルを更新
      js/config.js
      js/renderer.js
      …

更新しました。tikhub を起動し直してください (Ctrl+C → npm start)。
ゲーム画面はブラウザの再読み込み (F5) で反映されます。
```

- **あなたが置いたファイルは消しません。** `.env`、`bgm/` の mp3、`node_modules`、
  自分で作ったファイルはそのまま残ります。上書きするのは配布物のうち
  中身が変わったファイルだけです。
- 何度実行しても安全です。変化がなければ「すべて最新です」と出るだけです。
- ゲームのフォルダは自動で探します。見つからないときは
  `npm run update -- --game="ゲームのフォルダ"` で指定してください。

### リポジトリが非公開の場合

読み取り用のトークンが要ります。

1. https://github.com/settings/tokens?type=beta を開く
2. **Generate new token** → 対象のリポジトリを選ぶ
3. **Repository permissions → Contents** を **Read-only** にする
4. tikhub のフォルダの `.env` に 1 行足す

```
GITHUB_TOKEN=github_pat_xxxxxxxx
```

リポジトリを公開に変えれば、トークンなしで更新できます。

---

## ゲーム画面と繋ぐ

起動すると**自動でゲーム画面用のサーバーも立ち上がります**。オプションは要りません。

```bash
npm start                                   # ブラウザで貼り付けて接続
npm start -- https://vt.tiktok.com/XXXXXXXX/  # 最初から接続先を指定
```

```
  ゲーム画面はこの URL をブラウザで開いてください
      http://127.0.0.1:8787/
      (ゲーム: D:\...\kawaiivsbeautiful)
```

**ブラウザでその URL を開くだけで終わりです。** コンソールにコマンドを打つ必要はありません。

### ゲームのフォルダの置き方

tikhub と**並べて**置いてください。名前に `kawaii` が含まれていれば自動で見つけます。

```
D:\Downloads\
  ├── tikhub-.../              ← ここで npm start
  └── kawaiivsbeautiful-.../   ← 自動で見つかる
```

見つからないときは起動時のメッセージがそう伝えます。`--game=フォルダ` で直接指定もできます。
指定しなくても、`index.html` を直接開けば自動で `127.0.0.1:8787` に繋ぎにいきます。

### 仕組みと補足

- 中継は **SSE (Server-Sent Events)** です。サーバー → ブラウザの一方向で足りるため、
  追加の依存パッケージなしで動き、切断時の再接続はブラウザ側が自前で行います。
  **tikhub をあとから起動しても、ゲーム画面は放っておけば繋がります。**
- 流すのは `printer` が表示するのと同じ正規化済みイベントです。
  連打ギフトは**確定した 1 件だけ**を送るので、ゲーム側で二重に加算されません。
- 既定では `127.0.0.1` にだけ待ち受けます。別端末から見たい場合は
  `BRIDGE_HOST=0.0.0.0` を指定してください (同一 LAN に公開されます)。
- ポートが埋まっていたら `--serve=8788` のように変えられます。
  中継自体が不要なら `--no-serve` で止められます。

疎通確認:

```bash
curl http://127.0.0.1:8787/health
# {"ok":true,"clients":1,"game":true}
```

---

## 構成

```
src/
  index.js          エントリポイント。設定読み込み → 接続先解決 → 接続 → 表示の配線
  config.js         .env とコマンドライン引数から設定を組み立てる
  target.js         ユーザー名 / URL / 短縮 URL を @ユーザー名 に解決する
  logger.js         ログ出力
  events.js         受信ペイロードを共通の形へ正規化する
  printer.js        1 行 1 イベントの整形表示とセッション集計
  bridge.js         イベントの中継 + ゲーム本体の配信 + 接続先の受付
  live.js           TikTok LIVE への接続 (あとから張り替えられる)
  doctor.js         環境チェック
  resolve.js        接続先の解決のみを実行する
  sources/
    tiktok.js       tiktok-live-connector を使う本番のイベント源
    mock.js         TikTok に接続しない擬似イベント源
tools/
  update.js         その場で最新版に更新する (npm run update)
test/
  target.test.js    接続先解決のテスト (node --test)
docs/
  RESEARCH.md       接続方法の調査結果・他の選択肢・リスク
```

---

## トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| `この配信者は現在ライブ配信していません` | 配信中に実行してください。`--wait=600` で開始を待てます |
| `短縮 URL を展開できませんでした (HTTP 403)` | TikTok に到達できていません。`npm run doctor` を実行してください |
| `Failed to retrieve Room ID from all sources` | 同上。プロキシ / VPN / 地域制限を確認してください |
| `署名サーバー (Euler Stream) のレート制限に達しました` | `npm run doctor` で残りリクエスト数を確認できます。しばらく待つか、`.env` に `SIGN_API_KEY` を設定してください |
| 接続はできるがイベントが出ない | 誰もアクションしていない可能性があります。自分でいいねを押して確認してください。`--log-level=debug --raw` で受信状況を確認できます |
| `Failed to sign a request: This endpoint requires a Business plan` | ギフト一覧の取得 (`--extended-gift-info` / `EXTENDED_GIFT_INFO=true`) は有料プラン限定です。外してください。既定では無効で、外しても `[GIFT]` のダイヤ数は表示されます |
| ユーザー名が不正と言われる | プロフィール URL の `@` の後ろの文字列を指定してください (表示名ではありません) |

---

## 今後の予定 (このリポジトリのスコープ外)

- ゲーム (KAWAII vs BEAUTIFUL) への接続。
  正規化済みイベントの出口は `src/index.js` の `source.emitter.on('event', ...)` に集約してあるため、
  ここから WebSocket などで外へ流す形で追加できます。

## ライセンス

MIT
