import {
  QuoteRequest,
  QuoteDraft,
  QuoteLineItem,
  QuoteRule,
  MarkupRate,
} from "../types/quote";
import { CatalogLookupResult } from "./catalog";

/**
 * 見積もり計算エンジン
 * カタログ情報 + 掛け率 + ルール を組み合わせて見積もりドラフトを生成
 */
export class QuoteCalculator {
  /**
   * 見積もりドラフトを計算する
   */
  calculate(
    request: QuoteRequest,
    catalogResults: CatalogLookupResult[],
    rates: MarkupRate[],
    rules: QuoteRule[]
  ): QuoteDraft {
    const warnings: string[] = [];
    const appliedRules: string[] = [];

    // 明細を計算
    const lineItems: QuoteLineItem[] = request.items.map((item, index) => {
      const catalog = catalogResults[index];
      const rate = this.findRate(
        item.manufacturer || catalog?.manufacturer,
        rates
      );

      const lineItem: QuoteLineItem = {
        productName: item.productName,
        manufacturer: item.manufacturer || catalog?.manufacturer,
        modelNumber: item.modelNumber || catalog?.modelNumber,
        quantity: item.quantity,
        unit: item.unit || "式",
        listPrice: catalog?.listPrice,
        markupRate: rate?.rate,
        estimatedDelivery: catalog?.estimatedDelivery,
      };

      // 定価と掛け率が揃っていれば計算
      if (lineItem.listPrice && lineItem.markupRate) {
        lineItem.unitPrice = Math.ceil(
          lineItem.listPrice * lineItem.markupRate
        );
        lineItem.subtotal = lineItem.unitPrice * lineItem.quantity;
      }

      // 不足情報の警告
      if (!catalog?.found) {
        warnings.push(
          `⚠ ${item.productName}: カタログ価格が未取得です（手動確認が必要）`
        );
        if (catalog?.note) {
          lineItem.priceNote = catalog.note;
        }
      }
      if (!rate) {
        warnings.push(
          `⚠ ${item.manufacturer || "不明メーカー"}: 掛け率がスプシに見つかりません`
        );
      }

      return lineItem;
    });

    // ルールを適用
    for (const rule of rules) {
      const applied = this.applyRule(rule, lineItems, request);
      if (applied) {
        appliedRules.push(`${rule.name}: ${rule.action}`);
      }
    }

    // 合計金額
    const totalAmount = lineItems.reduce(
      (sum, item) => sum + (item.subtotal || 0),
      0
    );

    return {
      request,
      lineItems,
      totalAmount: totalAmount > 0 ? totalAmount : undefined,
      appliedRules,
      warnings,
      createdAt: new Date(),
    };
  }

  /**
   * メーカー名から掛け率を検索
   */
  private findRate(
    manufacturer: string | undefined,
    rates: MarkupRate[]
  ): MarkupRate | undefined {
    if (!manufacturer) return undefined;

    const normalized = manufacturer.toLowerCase();

    // 完全一致
    const exact = rates.find(
      (r) => r.manufacturer.toLowerCase() === normalized
    );
    if (exact) return exact;

    // 部分一致
    return rates.find(
      (r) =>
        r.manufacturer.toLowerCase().includes(normalized) ||
        normalized.includes(r.manufacturer.toLowerCase())
    );
  }

  /**
   * ルールを適用する（条件に合致すればtrue）
   * ルールの具体的な適用ロジックはAIに判断させることも可能
   */
  private applyRule(
    rule: QuoteRule,
    _lineItems: QuoteLineItem[],
    _request: QuoteRequest
  ): boolean {
    // ルールの適用はNotionに書かれた条件による
    // 現時点ではルール名を記録するのみ
    // 将来: AIにルールの条件を評価させて自動適用
    return true;
  }
}
