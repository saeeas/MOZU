import { RequestParser } from "../services/parser";
import { SheetsService } from "../services/sheets";
import { NotionService } from "../services/notion";
import { CatalogService } from "../services/catalog";
import { QuoteCalculator } from "../services/calculator";
import { QuoteFormatter } from "../services/formatter";

/**
 * 見積もり依頼のメインハンドラー
 * Slackメッセージ → 解析 → 調査 → 計算 → 返信 の一連の流れを管理
 */
export class QuoteHandler {
  private parser: RequestParser;
  private sheets: SheetsService;
  private notion: NotionService;
  private catalog: CatalogService;
  private calculator: QuoteCalculator;
  private formatter: QuoteFormatter;

  constructor() {
    this.parser = new RequestParser();
    this.sheets = new SheetsService();
    this.notion = new NotionService();
    this.catalog = new CatalogService();
    this.calculator = new QuoteCalculator();
    this.formatter = new QuoteFormatter();
  }

  /**
   * Slackメッセージを処理して見積もりドラフトを生成
   */
  async handle(
    messageText: string,
    userId: string,
    channelId: string,
    messageTs: string,
    threadTs?: string
  ): Promise<{ text: string; blocks: any[] }> {
    // 1. 依頼内容を解析
    const request = await this.parser.parse(
      messageText,
      userId,
      channelId,
      messageTs,
      threadTs
    );

    // 2. 並行して情報を取得
    const [catalogResults, rates, rulesText] = await Promise.all([
      // カタログ検索（各商品を並行処理）
      Promise.all(
        request.items.map((item) =>
          this.catalog.lookup(
            item.productName,
            item.manufacturer,
            item.modelNumber
          )
        )
      ),
      // 掛け率テーブル取得
      this.sheets.getMarkupRates(),
      // 見積もりルール取得
      this.notion.getRulesAsText(),
    ]);

    // 3. ルールオブジェクト取得（テキスト版とは別にcalculatorに渡す用）
    const rules = await this.notion.getQuoteRules();

    // 4. 見積もり計算
    const draft = this.calculator.calculate(
      request,
      catalogResults,
      rates,
      rules
    );

    // 5. Slackメッセージに整形
    return this.formatter.formatForSlack(draft);
  }
}
