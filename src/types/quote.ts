/** 依頼から抽出した情報 */
export interface QuoteRequest {
  /** 顧客名（記載があれば） */
  customerName?: string;
  /** 依頼された商品リスト */
  items: QuoteRequestItem[];
  /** 希望納期（記載があれば） */
  requestedDelivery?: string;
  /** その他の条件・備考 */
  notes?: string;
}

export interface QuoteRequestItem {
  /** 商品名 / 品番 */
  productName: string;
  /** メーカー名 */
  manufacturer?: string;
  /** 型番 */
  modelNumber?: string;
  /** 数量 */
  quantity: number;
  /** 単位（個, 台, セット など） */
  unit?: string;
}

/** 掛け率テーブルの1行 */
export interface MarkupRate {
  /** メーカー名 */
  manufacturer: string;
  /** 商品カテゴリ */
  category?: string;
  /** 掛け率（例: 0.65 = 65%） */
  rate: number;
}

/** Notionから取得する見積もりルール */
export interface QuoteRule {
  /** ルール名 */
  name: string;
  /** ルールの条件 */
  condition: string;
  /** 適用する処理の説明 */
  action: string;
  /** 優先度 */
  priority: number;
}

/** 商品ごとの調査結果 */
export interface ItemResearchResult {
  productName: string;
  manufacturer?: string;
  modelNumber?: string;
  quantity: number;
  unit: string;
  /** 定価（カタログ価格） */
  listPrice?: number;
  /** 掛け率 */
  markupRate?: number;
  /** 見積単価（定価 x 掛け率） */
  unitPrice?: number;
  /** 小計 */
  subtotal?: number;
  /** 納期目安 */
  estimatedDelivery?: string;
  /** 在庫状況 */
  stockStatus?: string;
  /** 調査メモ（AIからの補足情報） */
  researchNote?: string;
  /** 要手動確認の項目 */
  manualCheckNeeded: string[];
}

/** 最終的な見積もり調査結果 */
export interface QuoteResult {
  request: QuoteRequest;
  items: ItemResearchResult[];
  /** 合計金額（算出できた分のみ） */
  totalAmount?: number;
  /** 適用されたルール */
  appliedRules: string[];
  /** 確認事項 */
  warnings: string[];
  /** 生成日時 */
  createdAt: Date;
}
