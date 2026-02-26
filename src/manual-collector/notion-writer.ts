import { Client } from "@notionhq/client";
import { KnowledgeCandidate } from "./types";

/**
 * 抽出したナレッジをNotionの業務マニュアルDBに書き込む
 *
 * Notionデータベースの想定プロパティ:
 * - タイトル (title): 要約
 * - カテゴリ (select): 見積もり手順, トラブル対応, etc.
 * - 重要度 (select): high / medium / low
 * - ステータス (select): レビュー待ち / 承認済み / 却下
 * - 元チャンネル (rich_text): #channel-name
 * - 抽出理由 (rich_text): なぜマニュアルに入れるべきか
 * - 抽出日 (date): 日時
 */
export class NotionManualWriter {
  private client: Client;
  private databaseId: string;

  constructor() {
    this.client = new Client({ auth: process.env.NOTION_API_KEY });
    this.databaseId = process.env.NOTION_MANUAL_DATABASE_ID || "";
  }

  /**
   * ナレッジ候補をNotionに書き込む
   * ステータスは「レビュー待ち」で作成（あなたが確認して承認する）
   */
  async write(candidate: KnowledgeCandidate): Promise<string> {
    const response = await this.client.pages.create({
      parent: { database_id: this.databaseId },
      properties: {
        タイトル: {
          title: [{ text: { content: candidate.summary } }],
        },
        カテゴリ: {
          select: { name: candidate.category },
        },
        重要度: {
          select: { name: candidate.importance },
        },
        ステータス: {
          select: { name: "レビュー待ち" },
        },
        元チャンネル: {
          rich_text: [{ text: { content: `#${candidate.channelName}` } }],
        },
        抽出理由: {
          rich_text: [{ text: { content: candidate.reason } }],
        },
        抽出日: {
          date: { start: candidate.extractedAt.toISOString().split("T")[0] },
        },
      },
      // ページ本文にマニュアルテキストを記載
      children: [
        {
          object: "block" as const,
          type: "heading_2",
          heading_2: {
            rich_text: [{ type: "text" as const, text: { content: "マニュアル内容" } }],
          },
        },
        {
          object: "block" as const,
          type: "paragraph",
          paragraph: {
            rich_text: [
              { type: "text" as const, text: { content: candidate.manualText } },
            ],
          },
        },
        {
          object: "block" as const,
          type: "divider",
          divider: {},
        },
        {
          object: "block" as const,
          type: "heading_3",
          heading_3: {
            rich_text: [
              { type: "text" as const, text: { content: "元の会話（参考）" } },
            ],
          },
        },
        {
          object: "block" as const,
          type: "paragraph",
          paragraph: {
            rich_text: [
              {
                type: "text" as const,
                text: {
                  content: candidate.originalMessages.substring(0, 2000),
                },
              },
            ],
          },
        },
      ],
    });

    return response.id;
  }

  /**
   * 複数候補を書き込み
   */
  async writeAll(
    candidates: KnowledgeCandidate[]
  ): Promise<{ written: number; errors: string[] }> {
    let written = 0;
    const errors: string[] = [];

    for (const candidate of candidates) {
      try {
        await this.write(candidate);
        written++;
      } catch (error) {
        errors.push(
          `${candidate.summary}: ${error instanceof Error ? error.message : "不明"}`
        );
      }
    }

    return { written, errors };
  }
}
