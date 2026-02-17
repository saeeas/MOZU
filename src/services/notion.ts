import { Client } from "@notionhq/client";
import { QuoteRule } from "../types/quote";

/**
 * Notion から見積もりルールを取得する
 *
 * Notionデータベースの想定プロパティ:
 * - ルール名 (title)
 * - 条件 (rich_text): どういう時に適用するか
 * - アクション (rich_text): 何をするか（例: "送料を加算", "10%割引"）
 * - 優先度 (number): 適用順序
 */
export class NotionService {
  private client: Client;
  private rulesDatabaseId: string;

  constructor() {
    this.client = new Client({ auth: process.env.NOTION_API_KEY });
    this.rulesDatabaseId = process.env.NOTION_RULES_DATABASE_ID || "";
  }

  /**
   * 見積もりルールを全件取得（優先度順）
   */
  async getQuoteRules(): Promise<QuoteRule[]> {
    const response = await this.client.databases.query({
      database_id: this.rulesDatabaseId,
      sorts: [{ property: "優先度", direction: "ascending" }],
    });

    return response.results.map((page: any) => {
      const props = page.properties;
      return {
        name: this.extractTitle(props["ルール名"]),
        condition: this.extractRichText(props["条件"]),
        action: this.extractRichText(props["アクション"]),
        priority: props["優先度"]?.number || 0,
      };
    });
  }

  /**
   * ルールをテキストとしてまとめて返す（AIプロンプトに使う用）
   */
  async getRulesAsText(): Promise<string> {
    const rules = await this.getQuoteRules();
    if (rules.length === 0) {
      return "見積もりルールが登録されていません。";
    }

    return rules
      .map(
        (r, i) =>
          `${i + 1}. 【${r.name}】\n   条件: ${r.condition}\n   処理: ${r.action}`
      )
      .join("\n\n");
  }

  private extractTitle(prop: any): string {
    return prop?.title?.[0]?.plain_text || "";
  }

  private extractRichText(prop: any): string {
    return (
      prop?.rich_text?.map((t: any) => t.plain_text).join("") || ""
    );
  }
}
