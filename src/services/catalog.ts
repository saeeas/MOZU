import * as cheerio from "cheerio";
import OpenAI from "openai";

/**
 * メーカーWebサイトから商品情報を検索する
 *
 * 完全自動のスクレイピングはサイトごとに実装が必要なため、
 * ここではAIに「調べるべきURL」と「検索キーワード」を提案させ、
 * 取得できた場合は価格・納期を抽出する。
 *
 * 取得できない場合は「要手動確認」としてフラグを立てる。
 */
export interface CatalogLookupResult {
  productName: string;
  manufacturer?: string;
  modelNumber?: string;
  listPrice?: number;
  estimatedDelivery?: string;
  sourceUrl?: string;
  /** 自動取得できたか。falseの場合は手動確認が必要 */
  found: boolean;
  note?: string;
}

export class CatalogService {
  private openai: OpenAI;

  /** メーカー別の検索URL（拡張可能） */
  private manufacturerUrls: Record<string, string> = {
    // 例: 必要に応じて追加
    // "TOTO": "https://www.toto.co.jp/",
    // "LIXIL": "https://www.lixil.co.jp/",
  };

  constructor() {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  /**
   * 商品情報を検索する
   * 現状はAIに検索アドバイスをもらい、手動確認のフラグを立てる
   * 将来的にはメーカー別のスクレイピングロジックを追加可能
   */
  async lookup(
    productName: string,
    manufacturer?: string,
    modelNumber?: string
  ): Promise<CatalogLookupResult> {
    // メーカーごとの自動取得ロジックがある場合はそちらを使う
    // （将来の拡張ポイント）

    // 現時点ではAIに検索ヒントを生成させる
    const searchHint = await this.generateSearchHint(
      productName,
      manufacturer,
      modelNumber
    );

    return {
      productName,
      manufacturer,
      modelNumber,
      found: false,
      note: searchHint,
    };
  }

  /**
   * AIに検索のヒントを生成させる
   */
  private async generateSearchHint(
    productName: string,
    manufacturer?: string,
    modelNumber?: string
  ): Promise<string> {
    const query = [
      manufacturer && `メーカー: ${manufacturer}`,
      `商品: ${productName}`,
      modelNumber && `型番: ${modelNumber}`,
    ]
      .filter(Boolean)
      .join(", ");

    const completion = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `あなたは建材・設備商品の調査アシスタントです。
指定された商品について、定価と納期を確認するための最適な検索方法を簡潔に教えてください。
- 検索すべきWebサイトのURL
- 検索に使うキーワード
- 注意点
を箇条書きで回答してください。`,
        },
        {
          role: "user",
          content: query,
        },
      ],
    });

    return (
      completion.choices[0].message.content ||
      "商品情報を手動で確認してください"
    );
  }

  /**
   * メーカーの検索URLを登録する
   */
  registerManufacturerUrl(manufacturer: string, url: string): void {
    this.manufacturerUrls[manufacturer] = url;
  }
}
