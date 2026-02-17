/** Slackの依頼文からAIが抽出した情報 */
export interface QuoteRequest {
  /** 依頼元（Slackメッセージの投稿者） */
  requestedBy: string;
  /** 顧客名（依頼文に記載があれば） */
  customerName?: string;
  /** 依頼された商品リスト */
  items: QuoteRequestItem[];
  /** 希望納期（依頼文に記載があれば） */
  requestedDelivery?: string;
  /** その他の条件・備考 */
  notes?: string;
  /** 元のSlackメッセージ情報 */
  slackMeta: {
    channelId: string;
    messageTs: string;
    threadTs?: string;
  };
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

/** 計算済みの見積もり1行 */
export interface QuoteLineItem {
  productName: string;
  manufacturer?: string;
  modelNumber?: string;
  quantity: number;
  unit: string;
  /** 定価（カタログ価格） */
  listPrice?: number;
  /** 掛け率 */
  markupRate?: number;
  /** 単価（定価 × 掛け率） */
  unitPrice?: number;
  /** 小計 */
  subtotal?: number;
  /** 納期目安 */
  estimatedDelivery?: string;
  /** 価格が取得できなかった場合の理由 */
  priceNote?: string;
}

/** 最終的な見積もりドラフト */
export interface QuoteDraft {
  /** 依頼情報 */
  request: QuoteRequest;
  /** 見積もり明細 */
  lineItems: QuoteLineItem[];
  /** 合計金額 */
  totalAmount?: number;
  /** 適用されたルール */
  appliedRules: string[];
  /** 注意事項・確認事項 */
  warnings: string[];
  /** 生成日時 */
  createdAt: Date;
}
