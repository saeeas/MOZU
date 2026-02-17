import { QuoteDraft, QuoteLineItem } from "../types/quote";

/**
 * 見積もりドラフトをSlack投稿用のメッセージに整形する
 */
export class QuoteFormatter {
  /**
   * Slack Block Kit 形式のメッセージを生成
   */
  formatForSlack(draft: QuoteDraft): { text: string; blocks: any[] } {
    const blocks: any[] = [];

    // ヘッダー
    blocks.push({
      type: "header",
      text: {
        type: "plain_text",
        text: "📋 見積もりドラフト",
      },
    });

    // 顧客情報
    if (draft.request.customerName) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*顧客:* ${draft.request.customerName}`,
        },
      });
    }

    blocks.push({ type: "divider" });

    // 明細
    for (const item of draft.lineItems) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: this.formatLineItem(item),
        },
      });
    }

    blocks.push({ type: "divider" });

    // 合計
    if (draft.totalAmount) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*合計: ¥${draft.totalAmount.toLocaleString()}*（税抜）`,
        },
      });
    } else {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*合計: 算出不可*（カタログ価格の手動入力が必要です）",
        },
      });
    }

    // 適用ルール
    if (draft.appliedRules.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "*適用ルール:*\n" +
            draft.appliedRules.map((r) => `• ${r}`).join("\n"),
        },
      });
    }

    // 警告・確認事項
    if (draft.warnings.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "*確認事項:*\n" +
            draft.warnings.join("\n"),
        },
      });
    }

    // 納期
    if (draft.request.requestedDelivery) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*希望納期:* ${draft.request.requestedDelivery}`,
        },
      });
    }

    // アクションボタン
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "価格を手動入力" },
          action_id: "edit_prices",
          value: draft.request.slackMeta.messageTs,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "見積書PDF生成" },
          action_id: "generate_pdf",
          style: "primary",
          value: draft.request.slackMeta.messageTs,
        },
      ],
    });

    return {
      text: this.formatPlainText(draft),
      blocks,
    };
  }

  /**
   * 明細1行をフォーマット
   */
  private formatLineItem(item: QuoteLineItem): string {
    const parts: string[] = [];

    // 商品名 + メーカー + 型番
    let title = `*${item.productName}*`;
    if (item.manufacturer) title += ` (${item.manufacturer})`;
    if (item.modelNumber) title += ` [${item.modelNumber}]`;
    parts.push(title);

    // 数量
    parts.push(`数量: ${item.quantity}${item.unit}`);

    // 価格情報
    if (item.listPrice) {
      parts.push(`定価: ¥${item.listPrice.toLocaleString()}`);
    }
    if (item.markupRate) {
      parts.push(`掛け率: ${(item.markupRate * 100).toFixed(0)}%`);
    }
    if (item.unitPrice) {
      parts.push(`単価: ¥${item.unitPrice.toLocaleString()}`);
    }
    if (item.subtotal) {
      parts.push(`小計: ¥${item.subtotal.toLocaleString()}`);
    }

    // 納期
    if (item.estimatedDelivery) {
      parts.push(`納期: ${item.estimatedDelivery}`);
    }

    // 注意
    if (item.priceNote) {
      parts.push(`💡 ${item.priceNote}`);
    }

    return parts.join("\n");
  }

  /**
   * プレーンテキスト版（通知用フォールバック）
   */
  private formatPlainText(draft: QuoteDraft): string {
    const items = draft.lineItems
      .map(
        (item) =>
          `${item.productName} x${item.quantity}${item.unit}${item.subtotal ? ` → ¥${item.subtotal.toLocaleString()}` : " → 要確認"}`
      )
      .join("\n");

    const total = draft.totalAmount
      ? `合計: ¥${draft.totalAmount.toLocaleString()}`
      : "合計: 要確認";

    return `見積もりドラフト\n${items}\n${total}`;
  }
}
