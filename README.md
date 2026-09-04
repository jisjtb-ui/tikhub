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
- `tiktok.com` と `tiktok.eulerstream.com` に到達できるネットワーク
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
--wait=SECONDS      配信開始まで待機する秒数 (例: --wait=600)
--duration=SECONDS  指定秒数で自動終了する
--log-level=LEVEL   debug | info | warn | error
```

### `.env`

| 変数 | 説明 |
| --- | --- |
| `TIKTOK_TARGET` | 接続先 (ユーザー名 / プロフィール URL / 短縮 URL) |
| `SIGN_API_KEY` | 署名サーバー [Euler Stream](https://www.eulerstream.com) の API キー。**未設定でも無料枠で動作します** |
| `WAIT_UNTIL_LIVE_SECONDS` | まだ配信中でないとき、開始を待つ秒数 (0 = 待たない) |
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
| 接続先の解決 (ユーザー名 / URL / 短縮 URL) | ✅ 検証済み (`npm test` — 12 件のテスト) |
| エラー時の切り分けメッセージ | ✅ 検証済み |
| **実際の LIVE への接続** | ⚠️ **未検証** |

実接続が未検証なのは、開発に使用した環境が TikTok 系ドメインへの通信を
組織のポリシーで遮断しているためです (`vt.tiktok.com` / `www.tiktok.com` /
`webcast.tiktok.com` / `tiktok.eulerstream.com` すべて CONNECT が 403 で拒否)。
**手元の環境で上記の手順を実行して確認してください。**

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
  doctor.js         環境チェック
  resolve.js        接続先の解決のみを実行する
  sources/
    tiktok.js       tiktok-live-connector を使う本番のイベント源
    mock.js         TikTok に接続しない擬似イベント源
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
| `署名サーバー (Euler Stream) のレート制限に達しました` | しばらく待つか、`.env` に `SIGN_API_KEY` を設定してください |
| 接続はできるがイベントが出ない | 誰もアクションしていない可能性があります。自分でいいねを押して確認してください。`--log-level=debug --raw` で受信状況を確認できます |
| ユーザー名が不正と言われる | プロフィール URL の `@` の後ろの文字列を指定してください (表示名ではありません) |

---

## 今後の予定 (このリポジトリのスコープ外)

- ゲーム (KAWAII vs BEAUTIFUL) への接続。
  正規化済みイベントの出口は `src/index.js` の `source.emitter.on('event', ...)` に集約してあるため、
  ここから WebSocket などで外へ流す形で追加できます。

## ライセンス

MIT
