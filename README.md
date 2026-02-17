# MOZU - 見積もりアシスタントBot

BotにDMやメンションで依頼内容（テキスト or PDF）を送ると、**金額・納期・在庫**を調査してスレッドで返してくれるSlack Bot。

## 処理フロー

```
あなたが Bot に DM or メンション
  テキスト: 「TOTO TCF6543 2台、LIXIL BF-SC6 5個」
  or PDF添付: 見積依頼書.pdf
  ↓
  ⏳ 処理中...
  ├─ AI が内容を解析（商品名・数量・メーカーを抽出）
  ├─ Google Sheets から掛け率を取得
  ├─ Notion から見積もりルールを取得
  ├─ AI が各商品の定価・納期・在庫を調査
  ↓
  ✅ スレッドに調査結果を返信
  ↓
  あなたが確認 → 見積書作成 → 提出
```

## セットアップ

### 1. 必要なアカウント・APIキー

| サービス | 用途 | 取得方法 |
|---|---|---|
| Slack App | Bot本体 | api.slack.com/apps で作成 |
| OpenAI API | 依頼解析 + 商品調査 | platform.openai.com |
| Google Cloud | スプシ読み取り | サービスアカウント作成 → Sheets API有効化 |
| Notion | ルール取得 | notion.so/my-integrations |

### 2. Slack Appの設定

1. api.slack.com/apps で新しいAppを作成
2. **Socket Mode** を有効化 → App-Level Token (`xapp-`) を取得
3. **OAuth & Permissions** で以下のスコープを追加:
   - `im:history` - DMを読む
   - `im:read` - DMチャンネル情報
   - `chat:write` - メッセージ投稿
   - `reactions:write` - リアクション操作
   - `files:read` - 添付ファイル読み取り
   - `app_mentions:read` - メンション受信
4. **Event Subscriptions** で購読:
   - `message.im` - DMメッセージ
   - `app_mention` - メンション
5. ワークスペースにインストール → Bot Token (`xoxb-`) を取得

### 3. Google Sheets（掛け率）

サービスアカウントにスプレッドシートを共有（閲覧者）。

シート名「掛け率」で以下の形式:

| メーカー名 | カテゴリ | 掛け率 |
|---|---|---|
| TOTO | 水回り | 0.65 |
| LIXIL | 建材 | 0.60 |
| パナソニック | 電設 | 0.68 |

### 4. Notion（見積もりルール）

データベースを作成:

| プロパティ名 | 型 | 例 |
|---|---|---|
| ルール名 | タイトル | 大口割引 |
| 条件 | テキスト | 合計50万円以上の場合 |
| アクション | テキスト | 5%追加割引 |
| 優先度 | 数値 | 1 |

### 5. 起動

```bash
cp .env.example .env
# .env を編集して各APIキーを設定

npm install
npm run build
npm start
```

## 使い方

### テキストで依頼（DM or メンション）

```
ABC工業さん向け
- TOTO ウォシュレット TCF6543 2台
- LIXIL シャワーヘッド BF-SC6 5個
来月末希望
```

### PDF添付で依頼

見積依頼書のPDFをBotにDMで送信。テキストを添えることもできる。

### 返ってくる情報

各商品について:
- **金額**: 定価 → 掛け率適用 → 見積単価 → 小計
- **納期**: 一般的な納期目安
- **在庫**: 通常在庫/受注生産/廃番 など
- **調査メモ**: 注意点・確認事項

## ファイル構成

```
src/
├── index.ts              # Slack Bot起動（DM + メンション受付）
├── handlers/
│   └── quote.ts          # メインハンドラー（テキスト/PDF両対応）
├── services/
│   ├── parser.ts         # 依頼文のAI解析
│   ├── sheets.ts         # Google Sheets掛け率取得
│   ├── notion.ts         # Notion見積もりルール取得
│   ├── catalog.ts        # AI商品調査（金額・納期・在庫）
│   ├── calculator.ts     # 見積もり計算エンジン
│   ├── formatter.ts      # Slack投稿フォーマッター
│   └── pdf-reader.ts     # PDFテキスト抽出
└── types/
    └── quote.ts          # 型定義
```
