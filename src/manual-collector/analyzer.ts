import OpenAI from "openai";
import { ConversationThread, KnowledgeCandidate } from "./types";

/**
 * AIでSlackの会話を分析し、業務マニュアルに入れるべきか判定する
 */
export class ConversationAnalyzer {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  /**
   * 会話スレッドを分析して、マニュアル候補を抽出
   * マニュアルに入れる価値がないと判断した場合はnullを返す
   */
  async analyze(
    thread: ConversationThread
  ): Promise<KnowledgeCandidate | null> {
    const conversationText = thread.messages
      .map((m) => `[${m.user}] ${m.text}`)
      .join("\n");

    // 短すぎる会話はスキップ
    if (conversationText.length < 50) return null;

    const completion = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `あなたは業務改善の専門家です。
Slackの会話スレッドを読んで、業務マニュアルに取り入れるべき内容が含まれているか判定してください。

■ マニュアルに入れるべき会話の例:
- 業務手順の説明・確認（「〜はこうやる」「〜の手順は」）
- トラブル対応の知見（「〜の時は〜する」「〜でハマった」）
- ルールや判断基準の共有（「〜の場合は〜にする」）
- よくある質問への回答
- 取引先との対応方法
- ツールの使い方・設定方法

■ マニュアルに入れなくていい会話:
- 雑談・挨拶
- 単純な日程調整
- 個人的な話題
- 一度きりの特殊事例（汎用性がない）

■ 出力JSON:
{
  "shouldInclude": true/false,
  "category": "カテゴリ（例: 見積もり手順, トラブル対応, ツール操作, 取引先対応, 社内ルール）",
  "summary": "会話の要約（1-2文）",
  "manualText": "マニュアルに記載する形に整形したテキスト（手順形式・箇条書きなど読みやすく）",
  "reason": "マニュアルに入れるべき理由（1文）",
  "importance": "high/medium/low"
}

shouldInclude が false の場合、他のフィールドは空文字でOK。`,
        },
        {
          role: "user",
          content: `チャンネル: #${thread.channelName}\n\n${conversationText}`,
        },
      ],
    });

    const parsed = JSON.parse(
      completion.choices[0].message.content || "{}"
    );

    if (!parsed.shouldInclude) return null;

    return {
      channelName: thread.channelName,
      channelId: thread.channelId,
      messageTs: thread.threadTs,
      summary: parsed.summary || "",
      category: parsed.category || "未分類",
      manualText: parsed.manualText || "",
      reason: parsed.reason || "",
      importance: parsed.importance || "medium",
      originalMessages: conversationText,
      extractedAt: new Date(),
    };
  }

  /**
   * 複数スレッドを並行で分析（同時実行数を制限）
   */
  async analyzeAll(
    threads: ConversationThread[],
    concurrency: number = 3
  ): Promise<KnowledgeCandidate[]> {
    const results: KnowledgeCandidate[] = [];

    for (let i = 0; i < threads.length; i += concurrency) {
      const batch = threads.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map((t) => this.analyze(t))
      );
      results.push(
        ...batchResults.filter((r): r is KnowledgeCandidate => r !== null)
      );
    }

    return results;
  }
}
