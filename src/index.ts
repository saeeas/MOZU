import "dotenv/config";
import { App, LogLevel } from "@slack/bolt";
import { QuoteHandler } from "./handlers/quote";

/**
 * MOZU - 見積もりアシスタントBot
 *
 * 使い方:
 * 1. BotにDMでテキストを送る
 * 2. チャンネルでBotをメンションしてテキストを送る
 * 3. PDFファイルを添付して送る
 * → 金額・納期・在庫を調査して返信
 */

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.INFO,
});

const handler = new QuoteHandler();

/**
 * ファイル（PDF）をダウンロードしてBufferを返す
 */
async function downloadFile(
  client: any,
  fileId: string
): Promise<Buffer> {
  const info = await client.files.info({ file: fileId });
  const fileUrl =
    (info.file as any)?.url_private_download ||
    (info.file as any)?.url_private;

  const res = await fetch(fileUrl, {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  });
  return Buffer.from(await res.arrayBuffer());
}

/**
 * メッセージを処理して結果を返す共通ロジック
 */
async function processMessage(
  client: any,
  text: string,
  files: any[] | undefined
): Promise<{ text: string; blocks: any[] }> {
  if (files && files.length > 0) {
    const file = files[0];
    if (file.mimetype === "application/pdf") {
      const buffer = await downloadFile(client, file.id);
      return handler.handlePdf(buffer, text);
    }
  }

  if (text) {
    return handler.handleText(text);
  }

  return {
    text: "見積もり依頼のテキストか、PDFファイルを送ってください。",
    blocks: [],
  };
}

// --- DM でメッセージを受け取る ---
app.event("message", async ({ event, client, say }) => {
  // bot自身のメッセージは無視
  if ("bot_id" in event && (event as any).bot_id) return;
  if (!("channel_type" in event)) return;

  // DMのみ反応（チャンネルはメンション経由）
  if ((event as any).channel_type !== "im") return;

  const text = "text" in event ? (event as any).text || "" : "";
  const files = "files" in event ? (event as any).files : undefined;
  const threadTs = "thread_ts" in event ? (event as any).thread_ts : event.ts;

  try {
    await client.reactions.add({
      channel: event.channel,
      timestamp: event.ts,
      name: "hourglass_flowing_sand",
    });

    const response = await processMessage(client, text, files);

    await say({ text: response.text, blocks: response.blocks, thread_ts: threadTs });

    await client.reactions.remove({
      channel: event.channel,
      timestamp: event.ts,
      name: "hourglass_flowing_sand",
    });
    await client.reactions.add({
      channel: event.channel,
      timestamp: event.ts,
      name: "white_check_mark",
    });
  } catch (error) {
    console.error("処理エラー:", error);
    await client.reactions.add({
      channel: event.channel,
      timestamp: event.ts,
      name: "x",
    });
    await say({
      text: `エラー: ${error instanceof Error ? error.message : "不明"}`,
      thread_ts: threadTs,
    });
  }
});

// --- チャンネルでメンション ---
app.event("app_mention", async ({ event, client, say }) => {
  const text = event.text?.replace(/<@[^>]+>/g, "").trim() || "";
  const files = (event as any).files;
  const threadTs = event.thread_ts || event.ts;

  try {
    await client.reactions.add({
      channel: event.channel,
      timestamp: event.ts,
      name: "hourglass_flowing_sand",
    });

    const response = await processMessage(client, text, files);

    await say({ text: response.text, blocks: response.blocks, thread_ts: threadTs });

    await client.reactions.remove({
      channel: event.channel,
      timestamp: event.ts,
      name: "hourglass_flowing_sand",
    });
    await client.reactions.add({
      channel: event.channel,
      timestamp: event.ts,
      name: "white_check_mark",
    });
  } catch (error) {
    console.error("処理エラー:", error);
    await client.reactions.add({
      channel: event.channel,
      timestamp: event.ts,
      name: "x",
    });
    await say({
      text: `エラー: ${error instanceof Error ? error.message : "不明"}`,
      thread_ts: threadTs,
    });
  }
});

// --- 起動 ---
(async () => {
  await app.start();
  console.log("MOZU 見積もりアシスタント 起動");
  console.log("  DM or メンションで依頼を受け付けます");
})();
