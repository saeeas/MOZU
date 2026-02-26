import "dotenv/config";
import { SlackReader } from "./slack-reader";
import { ConversationAnalyzer } from "./analyzer";
import { NotionManualWriter } from "./notion-writer";

/**
 * Slack会話 → 業務マニュアル抽出ジョブ
 *
 * 実行方法:
 *   npx ts-node src/manual-collector/index.ts [hours]
 *   例: npx ts-node src/manual-collector/index.ts 24    ← 過去24時間
 *       npx ts-node src/manual-collector/index.ts 168   ← 過去1週間
 *
 * cron で毎日実行する場合:
 *   0 9 * * * cd /path/to/mozu && npx ts-node src/manual-collector/index.ts 24
 */
async function main() {
  const hours = parseInt(process.argv[2] || "24", 10);

  console.log(`=== MOZU マニュアル収集 ===`);
  console.log(`対象: 過去${hours}時間の会話\n`);

  // 1. Slackから会話を収集
  console.log("1/3 Slackから会話を収集中...");
  const reader = new SlackReader(process.env.SLACK_BOT_TOKEN || "");
  const threads = await reader.collectRecentConversations(hours);
  console.log(`   ${threads.length}件のスレッドを取得\n`);

  if (threads.length === 0) {
    console.log("対象の会話がありませんでした。");
    return;
  }

  // 2. AIで精査
  console.log("2/3 AIで精査中...");
  const analyzer = new ConversationAnalyzer();
  const candidates = await analyzer.analyzeAll(threads);
  console.log(`   ${candidates.length}件がマニュアル候補として抽出\n`);

  if (candidates.length === 0) {
    console.log("マニュアルに入れるべき会話はありませんでした。");
    return;
  }

  // 抽出結果をコンソールに表示
  for (const c of candidates) {
    console.log(`  [${c.importance}] ${c.category}: ${c.summary}`);
    console.log(`    理由: ${c.reason}`);
    console.log(`    元: #${c.channelName}\n`);
  }

  // 3. Notionに書き込み
  console.log("3/3 Notionに書き込み中...");
  const writer = new NotionManualWriter();
  const result = await writer.writeAll(candidates);
  console.log(`   ${result.written}件を書き込み完了`);

  if (result.errors.length > 0) {
    console.log(`   ${result.errors.length}件でエラー:`);
    result.errors.forEach((e) => console.log(`     - ${e}`));
  }

  console.log("\n=== 完了 ===");
  console.log(
    "Notionの業務マニュアルDBで「レビュー待ち」のページを確認してください。"
  );
}

main().catch((err) => {
  console.error("エラー:", err);
  process.exit(1);
});
