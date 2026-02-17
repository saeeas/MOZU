import {
  QuoteRequest,
  QuoteResult,
  ItemResearchResult,
  MarkupRate,
} from "../types/quote";
import { ResearchResult } from "./catalog";

/**
 * 調査結果と掛け率を組み合わせて見積もり金額を計算する
 */
export class QuoteCalculator {
  calculate(
    request: QuoteRequest,
    researchResults: ResearchResult[],
    rates: MarkupRate[],
    appliedRulesText: string[]
  ): QuoteResult {
    const warnings: string[] = [];

    const items: ItemResearchResult[] = request.items.map((item, index) => {
      const research = researchResults[index];
      const rate = this.findRate(item.manufacturer, rates);

      const result: ItemResearchResult = {
        productName: item.productName,
        manufacturer: item.manufacturer,
        modelNumber: item.modelNumber,
        quantity: item.quantity,
        unit: item.unit || "式",
        listPrice: research.listPrice,
        markupRate: rate?.rate,
        estimatedDelivery: research.estimatedDelivery,
        stockStatus: research.stockStatus,
        researchNote: research.researchNote,
        manualCheckNeeded: [...research.manualCheckNeeded],
      };

      // 定価と掛け率が揃っていれば計算
      if (result.listPrice && result.markupRate) {
        result.unitPrice = Math.ceil(result.listPrice * result.markupRate);
        result.subtotal = result.unitPrice * result.quantity;
      } else {
        if (!result.listPrice) {
          result.manualCheckNeeded.push("定価が不明 → メーカーWebで確認");
        }
        if (!result.markupRate) {
          result.manualCheckNeeded.push(
            `掛け率が不明 → スプシに「${item.manufacturer || "メーカー名"}」を追加`
          );
        }
      }

      // 在庫・納期の警告
      if (
        research.stockStatus &&
        (research.stockStatus.includes("廃番") ||
          research.stockStatus.includes("生産終了"))
      ) {
        warnings.push(
          `${item.productName}: 廃番/生産終了の可能性あり。後継品を要確認`
        );
      }

      return result;
    });

    const calculableItems = items.filter((i) => i.subtotal);
    const totalAmount =
      calculableItems.length > 0
        ? calculableItems.reduce((sum, i) => sum + (i.subtotal || 0), 0)
        : undefined;

    return {
      request,
      items,
      totalAmount,
      appliedRules: appliedRulesText,
      warnings,
      createdAt: new Date(),
    };
  }

  private findRate(
    manufacturer: string | undefined,
    rates: MarkupRate[]
  ): MarkupRate | undefined {
    if (!manufacturer) return undefined;
    const normalized = manufacturer.toLowerCase();

    return (
      rates.find((r) => r.manufacturer.toLowerCase() === normalized) ||
      rates.find(
        (r) =>
          r.manufacturer.toLowerCase().includes(normalized) ||
          normalized.includes(r.manufacturer.toLowerCase())
      )
    );
  }
}
