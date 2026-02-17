import OpenAI from "openai";
import { QuoteRequestItem, MarkupRate } from "../types/quote";

export interface ResearchResult {
  listPrice?: number;
  estimatedDelivery?: string;
  stockStatus?: string;
  researchNote: string;
  manualCheckNeeded: string[];
}

/**
 * AIを使って商品の金額・納期・在庫を調査する
 *
 * AIの知識ベースで回答できる範囲で情報を提供し、
 * 確認が必要な箇所を明示する。
 */
export class CatalogService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  /**
   * 商品の金額・納期・在庫情報を調査
   */
  async research(
    item: QuoteRequestItem,
    rate: MarkupRate | undefined,
    rulesText: string
  ): Promise<ResearchResult> {
    const query = [
      item.manufacturer && `メーカー: ${item.manufacturer}`,
      `商品名: ${item.productName}`,
      item.modelNumber && `型番: ${item.modelNumber}`,
      `数量: ${item.quantity}${item.unit || "式"}`,
    ]
      .filter(Boolean)
      .join("\n");

    const rateInfo = rate
      ? `掛け率: ${rate.manufacturer} → ${(rate.rate * 100).toFixed(0)}%`
      : "掛け率: 不明（スプシに該当メーカーなし）";

    const completion = await this.openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `あなたは建材・設備商品の見積もり調査アシスタントです。
指定された商品について、以下の情報をできる範囲で調査してJSON形式で回答してください。

■ 調査項目:
1. 定価（メーカー希望小売価格）
2. 納期目安（一般的な納期）
3. 在庫状況（一般的な流通状況。廃番・受注生産・通常在庫 など）

■ 見積もりルール:
${rulesText || "なし"}

■ 掛け率情報:
${rateInfo}

■ 出力JSON:
{
  "listPrice": 定価（数値。不明ならnull）,
  "estimatedDelivery": "納期目安（文字列。例: '2-3週間', '即納', '受注後30日'。不明なら null）",
  "stockStatus": "在庫状況（文字列。例: '通常在庫あり', '受注生産', '廃番注意'。不明なら null）",
  "researchNote": "調査メモ（定価の根拠、注意点、代替品の提案など。必ず記入）",
  "manualCheckNeeded": ["要手動確認の項目リスト。例: '定価はメーカーWebで要確認', '廃番の可能性あり、後継品確認が必要'"]
}

■ 重要:
- 不確かな価格は出さない。根拠がない場合はnullにして manualCheckNeeded に「メーカーWebで定価確認が必要」と入れる
- 型番がわかっている場合は具体的な情報を出す
- 型番が不明な場合はその商品ジャンルの一般的な情報を出す
- 廃番品やモデルチェンジの可能性がある場合は必ず言及する`,
        },
        { role: "user", content: query },
      ],
    });

    const parsed = JSON.parse(
      completion.choices[0].message.content || "{}"
    );

    return {
      listPrice: parsed.listPrice || undefined,
      estimatedDelivery: parsed.estimatedDelivery || undefined,
      stockStatus: parsed.stockStatus || undefined,
      researchNote: parsed.researchNote || "調査結果なし",
      manualCheckNeeded: parsed.manualCheckNeeded || [],
    };
  }
}
