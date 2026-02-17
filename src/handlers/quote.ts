import { RequestParser } from "../services/parser";
import { SheetsService } from "../services/sheets";
import { NotionService } from "../services/notion";
import { CatalogService } from "../services/catalog";
import { QuoteCalculator } from "../services/calculator";
import { QuoteFormatter } from "../services/formatter";
import { extractTextFromPdf } from "../services/pdf-reader";

/**
 * 見積もり調査のメインハンドラー
 * テキスト or PDF → 解析 → 金額/納期/在庫調査 → 結果返信
 */
export class QuoteHandler {
  private parser = new RequestParser();
  private sheets = new SheetsService();
  private notion = new NotionService();
  private catalog = new CatalogService();
  private calculator = new QuoteCalculator();
  private formatter = new QuoteFormatter();

  /**
   * テキストメッセージから見積もり調査を実行
   */
  async handleText(text: string): Promise<{ text: string; blocks: any[] }> {
    return this.process(text);
  }

  /**
   * PDFファイルから見積もり調査を実行
   */
  async handlePdf(
    pdfBuffer: Buffer,
    additionalText?: string
  ): Promise<{ text: string; blocks: any[] }> {
    const pdfText = await extractTextFromPdf(pdfBuffer);
    const combined = additionalText
      ? `${additionalText}\n\n--- PDF内容 ---\n${pdfText}`
      : pdfText;
    return this.process(combined);
  }

  private async process(
    inputText: string
  ): Promise<{ text: string; blocks: any[] }> {
    // 1. 依頼内容を解析
    const request = await this.parser.parse(inputText);

    // 2. 掛け率 + ルールを取得
    const [rates, rulesText, rules] = await Promise.all([
      this.sheets.getMarkupRates(),
      this.notion.getRulesAsText(),
      this.notion.getQuoteRules(),
    ]);

    // 3. 各商品を並行で調査（金額・納期・在庫）
    const researchResults = await Promise.all(
      request.items.map((item) => {
        const rate = rates.find((r) => {
          const m = item.manufacturer?.toLowerCase() || "";
          const rm = r.manufacturer.toLowerCase();
          return rm === m || rm.includes(m) || m.includes(rm);
        });
        return this.catalog.research(item, rate, rulesText);
      })
    );

    // 4. ルール名をテキスト化
    const appliedRulesText = rules.map((r) => `${r.name}: ${r.action}`);

    // 5. 計算
    const result = this.calculator.calculate(
      request,
      researchResults,
      rates,
      appliedRulesText
    );

    // 6. フォーマット
    return this.formatter.format(result);
  }
}
