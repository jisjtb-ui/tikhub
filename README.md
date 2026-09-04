# TikTok LIVE Event Server

TikTok LIVE からリアルタイムイベントを受信し、**コンソールに表示するだけ**の検証用サーバーです。

- KAWAII vs BEAUTIFUL のゲーム本体とは**独立した別プロジェクト**です。
- 現時点の目的は **ギフト / フォロー / いいね が正しく取れるかの検証**のみ。
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
- インターネット接続 (`tiktok.com` と `tiktok.eulerstream.com` に到達できること)
- **配信中の** TikTok アカウント名 (自分のアカウントでも、公開されている他人の LIVE でも可)

TikTok のログインもアプリ登録も不要です。

---

## セットアップ

```bash
npm install
cp .env.example .env
# .env を開いて TIKTOK_USERNAME を設定する
```

`.env` の主な項目:

| 変数 | 説明 |
| --- | --- |
| `TIKTOK_USERNAME` | 監視する配信者のユーザー名 (`@` あり/なしどちらでも可) |
| `SIGN_API_KEY` | 署名サーバー [Euler Stream](https://www.eulerstream.com) の API キー。**未設定でも無料枠で動作します** |
| `WAIT_UNTIL_LIVE_SECONDS` | まだ配信中でないとき、開始を待つ秒数 (0 = 待たない) |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` |
| `DUMP_RAW` | `true` にすると生ペイロードも出力 (`LOG_LEVEL=debug` と併用) |

---

## 使い方

### 1. まずモードで表示経路を確認する (TikTok に接続しません)

```bash
npm run mock
```

擬似的なギフト / フォロー / いいねが流れ、コンソール出力とイベント正規化が正しいことを確認できます。
10 秒で自動終了する版は `npm run verify` です。

### 2. 環境チェック

```bash
npm run doctor
```

Node のバージョン、ライブラリの導入状況、TikTok と署名サーバーへの到達性をまとめて確認します。
「イベントが出ない」ときは、まずこれで切り分けてください。

### 3. 実際の LIVE に接続する

**配信者がライブ配信している間に**実行します。

```bash
npm start                      # .env の TIKTOK_USERNAME に接続
npm start -- @username         # ユーザー名を直接指定
npm start -- @username --wait=600   # 配信開始まで最大 10 分待つ
```

その他のオプション:

```
--mock              モックモード (ネットワーク接続なし)
--raw               生ペイロードも出力する
--wait=SECONDS      配信開始まで待機する秒数
--duration=SECONDS  指定秒数で自動終了する
--log-level=LEVEL   debug | info | warn | error
```

終了は `Ctrl+C`。終了時にセッションの集計 (ギフト件数・ダイヤ数・フォロー数・いいね数など) を表示します。

---

## 出力例

```
TikTok LIVE Event Server
  ギフト / フォロー / いいね をリアルタイムでコンソールに表示します
  対象: @example_user  モード: live
  署名 API キー: 未設定 (無料枠)

21:03:11 [info ] 接続しました (roomId: 7412345678901234567)
21:03:11 [info ] イベント待機中… 終了するには Ctrl+C
21:03:18 [VIEWER] 視聴者数 1,204
21:03:22 [FOLLOW] @kawaii_fan (かわいい担当) がフォローしました
21:03:25 [LIKE  ] @lurker99 (ROM専) が いいね x12 [ルーム累計 48,120]
21:03:31 [GIFT  ] @beauty_fan (きれい担当) が Rose x5 (5 diamonds)
21:03:44 [GIFT  ] @kawaii_fan (かわいい担当) が Galaxy x1 (1,000 diamonds)
```

---

## 最初の成功条件

> 実際の TikTok LIVE 中にイベントが発生したとき、サーバーのコンソールにイベント情報が表示されること。

確認手順:

1. 対象アカウントで TikTok LIVE を開始する (または配信中のアカウントを対象にする)
2. `npm start -- @対象アカウント` を実行し、`接続しました (roomId: ...)` が出ることを確認する
3. 別の端末 / 別アカウントから、その LIVE に対して次を実行する
   - **いいね** をタップする → `[LIKE ]` の行が出る
   - **フォロー** する → `[FOLLOW]` の行が出る
   - **ギフト** (バラ 1 個など) を送る → `[GIFT ]` の行が出る
4. 3 種類すべてが表示されれば成功

### 現時点の検証状況

- ✅ **モックモードでの表示経路の検証は完了。** 正規化 → 表示 → 集計まで動作を確認済み
  (`npm run verify`)。
- ⚠️ **実際の LIVE に対する接続検証は未実施。** 開発に使用した環境は外部への通信が
  制限されており、`tiktok.com` と `tiktok.eulerstream.com` の両方に到達できませんでした
  (`npm run doctor` で `HTTP 403`)。
  **手元の環境で上記の手順を実行して確認してください。**

---

## イベントの扱いについて

| イベント | 表示ラベル | 備考 |
| --- | --- | --- |
| ギフト | `[GIFT  ]` | ギフト名・個数・ダイヤ数を表示 |
| フォロー | `[FOLLOW]` | |
| いいね | `[LIKE  ]` | 1 回のイベントに複数個まとまって届きます |
| コメント | `[CHAT  ]` | 参考用 |
| シェア | `[SHARE ]` | 参考用 |
| 入室 | `[JOIN  ]` | 参考用 |
| 視聴者数 | `[VIEWER]` | 参考用 |

**連打ギフトについて:** バラなどの連打可能なギフトは、連打中に何度もイベントが飛んできます。
本サーバーは**連打が確定したときの 1 行だけ**を通常表示し、途中経過は `--log-level=debug` のときのみ表示します。
集計も確定分のみを数えるため、二重計上されません。

---

## 構成

```
src/
  index.js          エントリポイント。設定読み込み → 接続 → 表示の配線
  config.js         .env とコマンドライン引数から設定を組み立てる
  logger.js         時刻付き・色付きのログ出力
  events.js         受信ペイロードを共通の形へ正規化する
  printer.js        正規化済みイベントの整形表示とセッション集計
  doctor.js         環境チェック
  sources/
    tiktok.js       tiktok-live-connector を使う本番のイベント源
    mock.js         TikTok に接続しない擬似イベント源
docs/
  RESEARCH.md       接続方法の調査結果・他の選択肢・リスク
```

---

## トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| `この配信者は現在ライブ配信していません` | 配信中に実行してください。`--wait=600` で開始を待てます |
| `署名サーバー (Euler Stream) のレート制限に達しました` | しばらく待つか、`.env` に `SIGN_API_KEY` を設定してください |
| `Failed to retrieve live status from all sources` | TikTok に到達できていません。`npm run doctor` で確認してください (プロキシ・VPN・地域制限) |
| 接続はできるがイベントが出ない | 誰もアクションしていない可能性があります。自分でいいねを押して確認してください。`--log-level=debug --raw` で受信状況を確認できます |
| ユーザー名が不正と言われる | プロフィール URL の `@` の後ろの文字列を指定してください (表示名ではありません) |

---

## 今後の予定 (このリポジトリのスコープ外)

- ゲーム (KAWAII vs BEAUTIFUL) への接続。
  正規化済みイベントの出口は `src/index.js` の `source.emitter.on('event', ...)` に集約してあるため、
  ここから WebSocket などで外へ流す形で追加できます。

## ライセンス

MIT
