import "dotenv/config";
import { App, LogLevel } from "@slack/bolt";
import { QuoteHandler } from "./handlers/quote";

/**
 * MOZU - Slack見積もり自動化Bot
 *
 * 処理フロー:
 * 1. 特定チャンネルに見積もり依頼が投稿される
 * 2. AIが依頼内容を解析（商品名・数量・メーカーなど抽出）
 * 3. Google Sheetsから掛け率を取得
 * 4. Notionから見積もりルールを取得
 * 5. メーカーWebの検索ヒントを生成
 * 6. 見積もりドラフトをスレッドに投稿
 * 7. ユーザーが確認・修正して提出
 */

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.INFO,
});

const quoteHandler = new QuoteHandler();
const QUOTE_CHANNEL = process.env.SLACK_QUOTE_CHANNEL_ID;

// --- メッセージ監視 ---
app.message(async ({ message, say, client }) => {
  // botのメッセージは無視
  if (message.subtype === "bot_message" || !("text" in message)) return;

  // 指定チャンネル以外は無視
  if (QUOTE_CHANNEL && message.channel !== QUOTE_CHANNEL) return;

  const text = message.text || "";

  // 見積もり依頼っぽいメッセージかどうかの簡易判定
  // （「見積」「見積もり」「価格」「単価」「いくら」などを含む）
  const quoteKeywords = [
    "見積",
    "見積もり",
    "価格",
    "単価",
    "いくら",
    "金額",
    "納期",
    "見積り",
  ];
  const isQuoteRequest = quoteKeywords.some((kw) => text.includes(kw));

  if (!isQuoteRequest) return;

  try {
    // 処理中のリアクションを付ける
    await client.reactions.add({
      channel: message.channel,
      timestamp: message.ts,
      name: "hourglass_flowing_sand",
    });

    // 見積もりドラフトを生成
    const response = await quoteHandler.handle(
      text,
      "user" in message ? message.user || "" : "",
      message.channel,
      message.ts,
      "thread_ts" in message ? message.thread_ts : undefined
    );

    // スレッドに見積もりドラフトを投稿
    await say({
      text: response.text,
      blocks: response.blocks,
      thread_ts: message.ts,
    });

    // 完了リアクション
    await client.reactions.remove({
      channel: message.channel,
      timestamp: message.ts,
      name: "hourglass_flowing_sand",
    });
    await client.reactions.add({
      channel: message.channel,
      timestamp: message.ts,
      name: "white_check_mark",
    });
  } catch (error) {
    console.error("見積もり処理エラー:", error);

    // エラーリアクション
    await client.reactions.add({
      channel: message.channel,
      timestamp: message.ts,
      name: "x",
    });

    await say({
      text: `見積もり処理中にエラーが発生しました。手動で確認してください。\nエラー: ${error instanceof Error ? error.message : "不明"}`,
      thread_ts: message.ts,
    });
  }
});

// --- ボタンアクション ---
app.action("edit_prices", async ({ ack, body, client }) => {
  await ack();
  // 価格手動入力のモーダルを表示（将来実装）
  if (body.type === "block_actions" && body.trigger_id) {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        title: { type: "plain_text", text: "価格入力" },
        submit: { type: "plain_text", text: "更新" },
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "カタログで確認した定価を入力してください（今後実装予定）",
            },
          },
        ],
      },
    });
  }
});

app.action("generate_pdf", async ({ ack, say }) => {
  await ack();
  // PDF生成（将来実装）
  await say("PDF生成機能は今後実装予定です。");
});

// --- 起動 ---
(async () => {
  await app.start();
  console.log("⚡ MOZU 見積もりBot が起動しました");
  console.log(`   監視チャンネル: ${QUOTE_CHANNEL || "全チャンネル"}`);
})();
