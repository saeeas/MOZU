import OpenAI from "openai";
import { QuoteRequest } from "../types/quote";

/**
 * テキスト（手入力 or PDF抽出）を解析し、構造化データに変換する
 */
export class RequestParser {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async parse(text: string): Promise<QuoteRequest> {
    const completion = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `あなたは見積もり依頼の内容を解析するアシスタントです。
テキストから以下の情報をJSON形式で抽出してください。

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

注意:
- 数量が明示されていない場合は1とする
- 商品名と型番は区別して抽出する
- 複数商品がある場合はすべてitemsに含める
- PDFから抽出したテキストの場合、表形式が崩れていることがあるので文脈から判断する`,
        },
        { role: "user", content: text },
      ],
    });

    const parsed = JSON.parse(
      completion.choices[0].message.content || "{}"
    );

    return {
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
    };
  }
}
