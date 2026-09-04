# 調査: TikTok LIVE のリアルタイムイベントを取得する方法 (2026-09 時点)

## 結論

**TikTok には、LIVE 配信中のギフト / フォロー / いいねをリアルタイムに取得できる公式 API は存在しない。**
したがって本プロジェクトでは **非公式ライブラリ `tiktok-live-connector` を採用する**。

---

## 1. 公式 API で可能なこと / 不可能なこと

TikTok for Developers が公開している API は次のとおりで、いずれも LIVE のイベントストリームを提供していない。

| 公式プロダクト | 用途 | LIVE イベント取得 |
| --- | --- | --- |
| Login Kit | OAuth ログイン | ✗ |
| Display API | 投稿済み動画のメタデータ取得 | ✗ |
| Content Posting API | 動画/画像の投稿 | ✗ |
| Business API / Marketing API | 広告・アカウント分析 | ✗ |
| Research API | 研究者向けの公開データ検索 | ✗ |

TikTok LIVE 向けの機能 (LIVE Studio の連携、サブスク関連の仕組みなど) は
一部パートナーへのクローズド提供にとどまり、一般の開発者が申請して使える公開 API にはなっていない。

**→ 公式ルートだけでは今回の要件 (ギフト / フォロー / いいねのリアルタイム受信) は実現できない。**

---

## 2. 実現手段の比較

| 手段 | 言語 | 種別 | 評価 |
| --- | --- | --- | --- |
| **`tiktok-live-connector`** | Node.js | 非公式 OSS (MIT) | **採用。** ゲーム本体 (JavaScript) と同じ言語で書ける。イベント種別が豊富でメンテナンスも活発 |
| `TikTokLive` (isaackogan) | Python | 非公式 OSS | 機能はほぼ同等。別言語のプロセスを増やすことになるため今回は見送り |
| Euler Stream / tik.tools などのホスト型サービス | 任意 | 商用 (無料枠あり) | 自前で署名処理を持たなくてよい。将来スケールする際の選択肢。有料かつ外部依存が増える |
| ブラウザ拡張 / OBS 経由でのスクレイピング | - | 非公式 | 壊れやすく運用に耐えない。不採用 |

---

## 3. 採用した方法の仕組み

`tiktok-live-connector` は、TikTok の Web 版 LIVE が内部で使っている **webcast エンドポイント**を利用する。

```
1. ユーザー名 (@xxx) から roomId を引く          [TikTok webcast HTTP API]
2. WebSocket 接続用の署名付き URL を取得する      [Euler Stream の署名サーバー]
3. WebSocket に接続する                          [TikTok webcast WebSocket]
4. protobuf のフレームを受信してデコードし、
   gift / follow / like などのイベントとして発行する
```

ポイント:

- **署名 (signature) の生成は Euler Stream という外部サービスに委譲されている。**
  無料の共有レート制限で動作するため、API キーなしでも接続できる。
  接続頻度が高い場合や複数ルームを見る場合は、API キー (`SIGN_API_KEY`) を設定してレート制限を緩和する。
- ログイン / アプリ登録 / 配信者本人の許可は不要。公開されている LIVE を視聴者として見るのと同じ扱い。
- `follow` と `share` は、内部的には `WebcastSocialMessage` という 1 種類のメッセージを
  表示テキストのキーで振り分けたもの。ライブラリ側が振り分け済みのイベントを発行してくれる。

---

## 4. 非公式であることによるリスク (重要)

このプロジェクトは**非公式・リバースエンジニアリングされた実装**に依存している。以下を了承したうえで使うこと。

1. **TikTok 側の仕様変更でいつでも壊れる。** protobuf スキーマやエンドポイントが変わると受信できなくなる。
   その場合はライブラリのバージョンアップで追随する必要がある。
2. **TikTok の利用規約上グレーである。** 公式に認められた利用方法ではない。
   商用利用や大規模運用の前には、規約とリスクを自分で評価すること。
3. **署名サーバー (Euler Stream) という外部依存がある。** 無料枠にはレート制限があり、
   混雑時や連続再接続時に `SignatureRateLimitError` が出ることがある。
4. **イベントの完全性は保証されない。** 高負荷なルームでは取りこぼしや遅延が起こりうる。
   ゲームのスコアなど、厳密性が要る用途では「多少落ちてもよい設計」にしておくこと。

---

## 5. このプロジェクトでの設計判断

- 受信したペイロードは `src/events.js` で**共通の形に正規化**してから扱う。
  ライブラリを差し替えても、表示側 (と将来のゲーム連携側) を書き換えずに済むようにするため。
- 接続直後にまとめて送られてくる過去分のイベント (`processInitialData`) は**流さない**。
  「配信中にイベントが起きたらコンソールに出る」という成功条件を、目視で確実に確認できるようにするため。
- **ゲーム本体への接続は実装しない** (今回のスコープ外)。
  正規化済みイベントを外へ出す口は `src/index.js` の `source.emitter.on('event', ...)` 一箇所に集約してある。

---

## 参考

- TikTok-Live-Connector — https://github.com/zerodytrash/TikTok-Live-Connector
- TikTokLive (Python) — https://github.com/isaackogan/TikTokLive
- Euler Stream (署名サーバー) — https://www.eulerstream.com
- TikTok for Developers — https://developers.tiktok.com
