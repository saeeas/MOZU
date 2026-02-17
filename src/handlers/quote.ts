import { RequestParser } from "../services/parser";
import { SheetsService } from "../services/sheets";
import { NotionService } from "../services/notion";
import { CatalogService } from "../services/catalog";
import { QuoteCalculator } from "../services/calculator";
import { QuoteFormatter } from "../services/formatter";
import { extractTextFromPdf } from "../services/pdf-reader";
import { RecommendationEngine, Recommendation } from "../services/recommender";
import { getDatabase } from "../services/database";

/**
 * 見積もり調査のメインハンドラー
 * テキスト or PDF → 解析 → 金額/納期/在庫調査 → DB照会 → レコメンド → 結果返信
 */
export class QuoteHandler {
  private parser = new RequestParser();
  private sheets = new SheetsService();
  private notion = new NotionService();
  private catalog = new CatalogService();
  private calculator = new QuoteCalculator();
  private formatter = new QuoteFormatter();
  private recommender = new RecommendationEngine();

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

    // 3. DBから既存の価格データを先に検索（あればAI調査を補完）
    const dbPriceHints = this.lookupDbPrices(request.items);

    // 4. 各商品を並行で調査（金額・納期・在庫）
    const researchResults = await Promise.all(
      request.items.map((item, idx) => {
        const rate = rates.find((r) => {
          const m = item.manufacturer?.toLowerCase() || "";
          const rm = r.manufacturer.toLowerCase();
          return rm === m || rm.includes(m) || m.includes(rm);
        });

        // DBに価格データがあればrulesTextに追記して精度を上げる
        const hint = dbPriceHints[idx];
        const enrichedRules = hint
          ? `${rulesText}\n\n■ 社内DB参考情報:\n${hint}`
          : rulesText;

        return this.catalog.research(item, rate, enrichedRules);
      })
    );

    // 5. ルール名をテキスト化
    const appliedRulesText = rules.map((r) => `${r.name}: ${r.action}`);

    // 6. 計算
    const result = this.calculator.calculate(
      request,
      researchResults,
      rates,
      appliedRulesText
    );

    // 7. 付属品レコメンドを取得
    const modelNumbers = request.items
      .map((item) => item.modelNumber)
      .filter((mn): mn is string => !!mn);

    let recommendations: Recommendation[] = [];
    if (modelNumbers.length > 0) {
      recommendations = this.recommender.recommendForQuote(modelNumbers, 5);
    }

    // 8. フォーマット（レコメンド付き）
    return this.formatter.format(result, recommendations);
  }

  /**
   * DBから既存の価格データを検索してヒント文字列を返す
   */
  private lookupDbPrices(
    items: Array<{ productName: string; modelNumber?: string; manufacturer?: string }>
  ): (string | null)[] {
    try {
      const db = getDatabase();
      return items.map((item) => {
        if (!item.modelNumber) return null;

        const product = db
          .prepare(
            "SELECT product_name, list_price, manufacturer FROM products WHERE model_number = ?"
          )
          .get(item.modelNumber) as
          | { product_name: string; list_price: number | null; manufacturer: string }
          | undefined;

        if (!product || !product.list_price) return null;

        return `品番 ${item.modelNumber} の過去の定価実績: ¥${product.list_price.toLocaleString()}（${product.manufacturer}）`;
      });
    } catch {
      // DB未初期化の場合は空で返す
      return items.map(() => null);
    }
  }
}
