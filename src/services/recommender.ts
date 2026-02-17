import { getDatabase } from "./database";

/** レコメンド結果 */
export interface Recommendation {
  /** 関連商品のID */
  productId: number;
  /** 品番 */
  modelNumber: string;
  /** 品名 */
  productName: string;
  /** メーカー */
  manufacturer: string;
  /** 定価 */
  listPrice?: number;
  /** 一緒に見積もりされた回数 */
  coOccurrenceCount: number;
  /** 信頼度スコア (0-1) */
  confidence: number;
  /** 関係の説明 */
  reason: string;
}

/**
 * 付属品レコメンドエンジン
 *
 * 仕組み:
 * 1. 同じ見積もり内に含まれる商品同士の共起関係を分析
 * 2. ある品番を指定したとき、過去の見積もりで一緒に含まれていた
 *    商品を「付属品候補」として推薦
 * 3. 共起回数と信頼度（条件付き確率）でランキング
 *
 * 信頼度 = (AとBが一緒に出現した見積もり数) / (Aが出現した見積もり数)
 */
export class RecommendationEngine {
  /**
   * 全見積もりデータから共起関係を再計算
   * スクレイピング後に1回実行すると、全関連データが更新される
   */
  buildAssociations(): { pairsFound: number } {
    const db = getDatabase();
    let pairsFound = 0;

    console.log("[レコメンド] 共起関係の構築を開始...");

    // 既存の関連データをクリア
    db.prepare("DELETE FROM product_associations").run();

    // 同じ見積もり内で一緒に出現する製品ペアを集計
    // product_idが設定されている明細行のみ対象
    const pairs = db
      .prepare(
        `
      SELECT
        a.product_id AS product_a,
        b.product_id AS product_b,
        COUNT(DISTINCT a.quote_id) AS co_count
      FROM quote_items a
      JOIN quote_items b
        ON a.quote_id = b.quote_id
        AND a.product_id != b.product_id
      WHERE a.product_id IS NOT NULL
        AND b.product_id IS NOT NULL
      GROUP BY a.product_id, b.product_id
      HAVING co_count >= 1
    `
      )
      .all() as { product_a: number; product_b: number; co_count: number }[];

    // 各製品が出現する見積もり数を事前計算
    const productQuoteCounts = db
      .prepare(
        `
      SELECT product_id, COUNT(DISTINCT quote_id) AS quote_count
      FROM quote_items
      WHERE product_id IS NOT NULL
      GROUP BY product_id
    `
      )
      .all() as { product_id: number; quote_count: number }[];

    const countMap = new Map<number, number>();
    for (const row of productQuoteCounts) {
      countMap.set(row.product_id, row.quote_count);
    }

    // 関連データを挿入
    const insert = db.prepare(`
      INSERT INTO product_associations (product_id, associated_product_id, co_occurrence_count, confidence)
      VALUES (?, ?, ?, ?)
    `);

    const insertAll = db.transaction(() => {
      for (const pair of pairs) {
        const totalA = countMap.get(pair.product_a) || 1;
        const confidence = pair.co_count / totalA;

        insert.run(pair.product_a, pair.product_b, pair.co_count, confidence);
        pairsFound++;
      }
    });

    insertAll();
    console.log(`[レコメンド] ${pairsFound}件のペア関係を構築`);

    return { pairsFound };
  }

  /**
   * 品番から付属品・関連商品をレコメンド
   *
   * @param modelNumber 対象の品番
   * @param limit 最大件数
   * @param minConfidence 最低信頼度（0-1）
   */
  recommend(
    modelNumber: string,
    limit: number = 10,
    minConfidence: number = 0.1
  ): Recommendation[] {
    const db = getDatabase();

    // 品番から製品IDを取得
    const product = db
      .prepare("SELECT id, product_name FROM products WHERE model_number = ?")
      .get(modelNumber) as { id: number; product_name: string } | undefined;

    if (!product) {
      // 部分一致で検索
      const partial = db
        .prepare(
          "SELECT id, product_name FROM products WHERE model_number LIKE ? LIMIT 1"
        )
        .get(`%${modelNumber}%`) as { id: number; product_name: string } | undefined;

      if (!partial) return [];
      return this.getRecommendationsForProduct(partial.id, limit, minConfidence);
    }

    return this.getRecommendationsForProduct(product.id, limit, minConfidence);
  }

  /**
   * 品名（テキスト）から付属品をレコメンド
   * AIパーサーが品番を特定できなかった場合のフォールバック
   */
  recommendByName(
    productName: string,
    limit: number = 10,
    minConfidence: number = 0.1
  ): Recommendation[] {
    const db = getDatabase();

    // LIKE検索で製品を探す
    const product = db
      .prepare(
        "SELECT id FROM products WHERE product_name LIKE ? ORDER BY id LIMIT 1"
      )
      .get(`%${productName}%`) as { id: number } | undefined;

    if (!product) return [];
    return this.getRecommendationsForProduct(product.id, limit, minConfidence);
  }

  /**
   * 複数の品番から付属品をまとめてレコメンド
   * 見積もり全体に対する推薦（既に含まれている商品は除外）
   */
  recommendForQuote(
    modelNumbers: string[],
    limit: number = 15
  ): Recommendation[] {
    const db = getDatabase();
    const allRecs = new Map<number, Recommendation>();

    // 見積もりに含まれている製品IDを集める
    const existingProductIds = new Set<number>();
    for (const mn of modelNumbers) {
      const p = db
        .prepare("SELECT id FROM products WHERE model_number = ?")
        .get(mn) as { id: number } | undefined;
      if (p) existingProductIds.add(p.id);
    }

    // 各品番からレコメンドを取得して統合
    for (const mn of modelNumbers) {
      const recs = this.recommend(mn, 20, 0.05);
      for (const rec of recs) {
        // 既に見積もりに含まれている商品は除外
        if (existingProductIds.has(rec.productId)) continue;

        const existing = allRecs.get(rec.productId);
        if (existing) {
          // 複数の商品から推薦された場合はスコアを加算
          existing.coOccurrenceCount += rec.coOccurrenceCount;
          existing.confidence = Math.max(existing.confidence, rec.confidence);
          existing.reason = `複数品番と関連（信頼度: ${(existing.confidence * 100).toFixed(0)}%）`;
        } else {
          allRecs.set(rec.productId, { ...rec });
        }
      }
    }

    // スコアでソートして上位を返す
    return Array.from(allRecs.values())
      .sort((a, b) => {
        // 複数品番と関連する商品を優先
        const aMulti = a.reason.includes("複数") ? 1 : 0;
        const bMulti = b.reason.includes("複数") ? 1 : 0;
        if (aMulti !== bMulti) return bMulti - aMulti;
        // 信頼度順
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        // 共起回数順
        return b.coOccurrenceCount - a.coOccurrenceCount;
      })
      .slice(0, limit);
  }

  /**
   * 製品IDから関連商品を取得（内部メソッド）
   */
  private getRecommendationsForProduct(
    productId: number,
    limit: number,
    minConfidence: number
  ): Recommendation[] {
    const db = getDatabase();

    const rows = db
      .prepare(
        `
      SELECT
        pa.associated_product_id AS product_id,
        p.model_number,
        p.product_name,
        p.manufacturer,
        p.list_price,
        pa.co_occurrence_count,
        pa.confidence
      FROM product_associations pa
      JOIN products p ON p.id = pa.associated_product_id
      WHERE pa.product_id = ?
        AND pa.confidence >= ?
      ORDER BY pa.confidence DESC, pa.co_occurrence_count DESC
      LIMIT ?
    `
      )
      .all(productId, minConfidence, limit) as Array<{
      product_id: number;
      model_number: string;
      product_name: string;
      manufacturer: string;
      list_price: number | null;
      co_occurrence_count: number;
      confidence: number;
    }>;

    return rows.map((row) => ({
      productId: row.product_id,
      modelNumber: row.model_number || "",
      productName: row.product_name,
      manufacturer: row.manufacturer,
      listPrice: row.list_price || undefined,
      coOccurrenceCount: row.co_occurrence_count,
      confidence: row.confidence,
      reason: `過去${row.co_occurrence_count}件の見積もりで一緒に含まれていました（信頼度: ${(row.confidence * 100).toFixed(0)}%）`,
    }));
  }

  // =========================================================================
  // DB検索ユーティリティ
  // =========================================================================

  /**
   * 品番で製品情報を検索
   */
  searchProduct(
    query: string
  ): Array<{
    id: number;
    modelNumber: string;
    productName: string;
    manufacturer: string;
    listPrice?: number;
    quoteCount: number;
  }> {
    const db = getDatabase();

    const rows = db
      .prepare(
        `
      SELECT
        p.id,
        p.model_number,
        p.product_name,
        p.manufacturer,
        p.list_price,
        COUNT(DISTINCT qi.quote_id) AS quote_count
      FROM products p
      LEFT JOIN quote_items qi ON qi.product_id = p.id
      WHERE p.model_number LIKE ?
         OR p.product_name LIKE ?
      GROUP BY p.id
      ORDER BY quote_count DESC
      LIMIT 20
    `
      )
      .all(`%${query}%`, `%${query}%`) as Array<{
      id: number;
      model_number: string;
      product_name: string;
      manufacturer: string;
      list_price: number | null;
      quote_count: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      modelNumber: r.model_number || "",
      productName: r.product_name,
      manufacturer: r.manufacturer,
      listPrice: r.list_price || undefined,
      quoteCount: r.quote_count,
    }));
  }

  /**
   * DB内の統計情報を取得
   */
  getStats(): {
    totalProducts: number;
    totalQuotes: number;
    totalAssociations: number;
    topProducts: Array<{ modelNumber: string; productName: string; count: number }>;
  } {
    const db = getDatabase();

    const totalProducts = (
      db.prepare("SELECT COUNT(*) as c FROM products").get() as any
    ).c;
    const totalQuotes = (
      db.prepare("SELECT COUNT(*) as c FROM quotes").get() as any
    ).c;
    const totalAssociations = (
      db.prepare("SELECT COUNT(*) as c FROM product_associations").get() as any
    ).c;

    const topProducts = db
      .prepare(
        `
      SELECT p.model_number, p.product_name, COUNT(DISTINCT qi.quote_id) as cnt
      FROM products p
      JOIN quote_items qi ON qi.product_id = p.id
      GROUP BY p.id
      ORDER BY cnt DESC
      LIMIT 10
    `
      )
      .all() as Array<{
      model_number: string;
      product_name: string;
      cnt: number;
    }>;

    return {
      totalProducts,
      totalQuotes,
      totalAssociations,
      topProducts: topProducts.map((r) => ({
        modelNumber: r.model_number,
        productName: r.product_name,
        count: r.cnt,
      })),
    };
  }
}
