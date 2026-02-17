import { QuoteResult, ItemResearchResult } from "../types/quote";

/**
 * 見積もり調査結果をSlackメッセージに整形する
 */
export class QuoteFormatter {
  format(result: QuoteResult): { text: string; blocks: any[] } {
    const blocks: any[] = [];

    // ヘッダー
    blocks.push({
      type: "header",
      text: { type: "plain_text", text: "見積もり調査結果" },
    });

    if (result.request.customerName) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*顧客:* ${result.request.customerName}` },
      });
    }

    blocks.push({ type: "divider" });

    // 各商品
    for (const item of result.items) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: this.formatItem(item) },
      });
      blocks.push({ type: "divider" });
    }

    // 合計
    if (result.totalAmount) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*合計: ¥${result.totalAmount.toLocaleString()}*（税抜）`,
        },
      });
    }

    // 確認事項
    const allManualChecks = result.items.flatMap((i) => i.manualCheckNeeded);
    if (result.warnings.length > 0 || allManualChecks.length > 0) {
      const lines = [
        ...result.warnings.map((w) => `• ${w}`),
        ...allManualChecks.map((c) => `• ${c}`),
      ];
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*要確認:*\n${lines.join("\n")}`,
        },
      });
    }

    // 適用ルール
    if (result.appliedRules.length > 0) {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `適用ルール: ${result.appliedRules.join(" / ")}`,
          },
        ],
      });
    }

    // 納期
    if (result.request.requestedDelivery) {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `希望納期: ${result.request.requestedDelivery}`,
          },
        ],
      });
    }

    return { text: this.formatPlain(result), blocks };
  }

  private formatItem(item: ItemResearchResult): string {
    const lines: string[] = [];

    // 商品名行
    let title = `*${item.productName}*`;
    if (item.manufacturer) title += ` (${item.manufacturer})`;
    if (item.modelNumber) title += ` \`${item.modelNumber}\``;
    lines.push(title);

    // 数量
    lines.push(`数量: ${item.quantity}${item.unit}`);

    // 金額
    if (item.listPrice) {
      lines.push(`定価: ¥${item.listPrice.toLocaleString()}`);
    }
    if (item.markupRate) {
      lines.push(`掛け率: ${(item.markupRate * 100).toFixed(0)}%`);
    }
    if (item.unitPrice) {
      lines.push(`*見積単価: ¥${item.unitPrice.toLocaleString()}*`);
    }
    if (item.subtotal) {
      lines.push(`*小計: ¥${item.subtotal.toLocaleString()}*`);
    }

    // 納期・在庫
    if (item.estimatedDelivery) {
      lines.push(`納期: ${item.estimatedDelivery}`);
    }
    if (item.stockStatus) {
      lines.push(`在庫: ${item.stockStatus}`);
    }

    // 調査メモ
    if (item.researchNote) {
      lines.push(`> ${item.researchNote}`);
    }

    // 手動確認
    if (item.manualCheckNeeded.length > 0) {
      lines.push(
        item.manualCheckNeeded.map((c) => `:warning: ${c}`).join("\n")
      );
    }

    return lines.join("\n");
  }

  private formatPlain(result: QuoteResult): string {
    const items = result.items
      .map((i) => {
        const price = i.subtotal
          ? `¥${i.subtotal.toLocaleString()}`
          : "要確認";
        const stock = i.stockStatus || "要確認";
        const delivery = i.estimatedDelivery || "要確認";
        return `${i.productName} x${i.quantity} → ${price} / 納期:${delivery} / 在庫:${stock}`;
      })
      .join("\n");

    return `見積もり調査結果\n${items}`;
  }
}
