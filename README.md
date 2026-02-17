# MOZU - Slack見積もり自動化Bot

Slackの特定チャンネルに投稿された見積もり依頼を検知し、掛け率・ルールを適用した見積もりドラフトを自動生成するBot。

## 処理フロー

```
Slack #見積もり依頼 に投稿
  ↓ Bot が検知（キーワード: 見積, 価格, 納期 など）
  ↓ ⏳ リアクションで処理中を通知
  ↓
  ├─ AI が依頼文を解析（商品名・数量・メーカーを抽出）
  ├─ Google Sheets から掛け率を取得
  ├─ Notion から見積もりルールを取得
  ├─ メーカーWebの検索ヒントを生成
  ↓
  見積もりドラフトをスレッドに投稿
  ↓ ✅ リアクションで完了を通知
  ↓
  あなたが確認 → 提出
```

## セットアップ

### 1. 必要なアカウント・APIキー

| サービス | 用途 | 取得方法 |
|---|---|---|
| Slack App | Bot本体 | [api.slack.com/apps](https://api.slack.com/apps) で作成 |
| OpenAI API | 依頼文の解析 | [platform.openai.com](https://platform.openai.com) |
| Google Cloud | スプシ読み取り | サービスアカウント作成 → Sheets API 有効化 |
| Notion Integration | ルール取得 | [notion.so/my-integrations](https://www.notion.so/my-integrations) |

### 2. Slack Appの設定

1. [api.slack.com/apps](https://api.slack.com/apps) で新しいAppを作成
2. **Socket Mode** を有効化 → App-Level Token (`xapp-`) を取得
3. **OAuth & Permissions** で以下のスコープを追加:
   - `channels:history` - チャンネルのメッセージを読む
   - `chat:write` - メッセージを投稿
   - `reactions:write` - リアクションを付ける
   - `reactions:read` - リアクションを読む
4. **Event Subscriptions** で `message.channels` を購読
5. ワークスペースにインストール → Bot Token (`xoxb-`) を取得
6. Botを見積もり依頼チャンネルに招待

### 3. Google Sheetsの設定

1. Google Cloud Console でサービスアカウントを作成
2. Sheets API を有効化
3. サービスアカウントのメールアドレスにスプレッドシートを共有（閲覧者）
4. スプレッドシートの形式:

| メーカー名 | カテゴリ | 掛け率 |
|---|---|---|
| TOTO | 水回り | 0.65 |
| LIXIL | 建材 | 0.60 |
| パナソニック | 電設 | 0.68 |

シート名を「掛け率」にしてください。

### 4. Notionの設定

1. [notion.so/my-integrations](https://www.notion.so/my-integrations) でIntegrationを作成
2. 見積もりルール用のデータベースを作成（以下のプロパティ）:

| プロパティ名 | 型 | 説明 |
|---|---|---|
| ルール名 | タイトル | ルールの名前 |
| 条件 | テキスト | いつ適用するか |
| アクション | テキスト | 何をするか |
| 優先度 | 数値 | 適用順序（小さい方が先） |

3. データベースにIntegrationを接続（共有 → コネクト追加）

### 5. 環境変数の設定

```bash
cp .env.example .env
```

`.env` を編集して各APIキーを設定。

### 6. 起動

```bash
npm install
npm run build
npm start

# 開発時
npm run dev
```

## 使い方

Slackの見積もり依頼チャンネルに、普通に見積もり依頼を投稿するだけ。

例:
```
ABC工業さんから見積もり依頼です
- TOTO ウォシュレット TCF6543 2台
- LIXIL シャワーヘッド BF-SC6 5個
納期は来月末希望
```

Botが自動的に:
1. 商品・数量・メーカーを解析
2. スプシから掛け率を引いて計算
3. Notionのルールを適用
4. ドラフトをスレッドに投稿

あなたは内容を確認して、必要なら修正して提出。

## ファイル構成

```
src/
├── index.ts              # エントリポイント（Slack Bot起動・メッセージ監視）
├── handlers/
│   └── quote.ts          # 見積もりメインハンドラー（全体の流れを制御）
├── services/
│   ├── parser.ts         # 依頼文のAI解析
│   ├── sheets.ts         # Google Sheets掛け率取得
│   ├── notion.ts         # Notion見積もりルール取得
│   ├── catalog.ts        # メーカーWeb商品検索（検索ヒント生成）
│   ├── calculator.ts     # 見積もり計算エンジン
│   └── formatter.ts      # Slack投稿フォーマッター
└── types/
    └── quote.ts          # 型定義
```
