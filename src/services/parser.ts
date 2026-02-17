import OpenAI from "openai";
import { QuoteRequest, QuoteRequestItem } from "../types/quote";

/**
 * Slackの依頼メッセージをAIで解析し、構造化データに変換する
 */
export class RequestParser {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  /**
   * Slackメッセージを解析して見積もり依頼情報を抽出
   */
  async parse(
    messageText: string,
    userId: string,
    channelId: string,
    messageTs: string,
    threadTs?: string
  ): Promise<QuoteRequest> {
    const completion = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `あなたは見積もり依頼の内容を解析するアシスタントです。
Slackに投稿された見積もり依頼メッセージから、以下の情報をJSON形式で抽出してください。

出力フォーマット:
{
  "customerName": "顧客名（記載があれば。なければnull）",
  "items": [
    {
      "productName": "商品名",
      "manufacturer": "メーカー名（わかれば。なければnull）",
      "modelNumber": "型番（わかれば。なければnull）",
      "quantity": 数量（数値）,
      "unit": "単位（個、台、セットなど。不明なら'式'）"
    }
  ],
  "requestedDelivery": "希望納期（記載があれば。なければnull）",
  "notes": "その他の条件や備考（あれば。なければnull）"
}

注意事項:
- 数量が明示されていない場合は1とする
- 商品名と型番は区別して抽出する
- 複数商品がある場合はすべてitemsに含める
- メーカー名は略称でもそのまま抽出する`,
        },
        {
          role: "user",
          content: messageText,
        },
      ],
    });

    const parsed = JSON.parse(
      completion.choices[0].message.content || "{}"
    );

    return {
      requestedBy: userId,
      customerName: parsed.customerName || undefined,
      items: (parsed.items || []).map((item: any) => ({
        productName: item.productName || "不明",
        manufacturer: item.manufacturer || undefined,
        modelNumber: item.modelNumber || undefined,
        quantity: item.quantity || 1,
        unit: item.unit || "式",
      })),
      requestedDelivery: parsed.requestedDelivery || undefined,
      notes: parsed.notes || undefined,
      slackMeta: {
        channelId,
        messageTs,
        threadTs,
      },
    };
  }
}
