import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = process.env.MOZU_DB_PATH || path.join(process.cwd(), "data", "mozu.db");

let db: Database.Database | null = null;

/**
 * SQLiteデータベースの初期化・接続管理
 */
export function getDatabase(): Database.Database {
  if (db) return db;

  // dataディレクトリを作成
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(DB_PATH);

  // WALモードで高速化
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  initializeSchema(db);
  return db;
}

/**
 * テーブルスキーマの初期化
 */
function initializeSchema(db: Database.Database): void {
  db.exec(`
    -- 製品マスタ
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_number TEXT,
      product_name TEXT NOT NULL,
      manufacturer TEXT DEFAULT 'LIXIL',
      category TEXT,
      series TEXT,
      list_price REAL,
      unit TEXT DEFAULT '個',
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(model_number, manufacturer)
    );

    -- 見積もり（ヘッダー）
    CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_number TEXT UNIQUE,
      quote_date TEXT,
      customer_name TEXT,
      project_name TEXT,
      total_amount REAL,
      source_url TEXT,
      raw_data TEXT,
      scraped_at TEXT DEFAULT (datetime('now'))
    );

    -- 見積もり明細
    CREATE TABLE IF NOT EXISTS quote_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      model_number TEXT,
      quantity REAL DEFAULT 1,
      unit TEXT DEFAULT '個',
      unit_price REAL,
      subtotal REAL,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
    );

    -- 図面・添付ファイル
    CREATE TABLE IF NOT EXISTS drawings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER,
      quote_id INTEGER,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_type TEXT DEFAULT 'pdf',
      downloaded_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
      FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE
    );

    -- 商品の共起関係（付属品レコメンド用）
    CREATE TABLE IF NOT EXISTS product_associations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      associated_product_id INTEGER NOT NULL,
      co_occurrence_count INTEGER DEFAULT 1,
      confidence REAL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (associated_product_id) REFERENCES products(id) ON DELETE CASCADE,
      UNIQUE(product_id, associated_product_id)
    );

    -- スクレイピング実行ログ
    CREATE TABLE IF NOT EXISTS scrape_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT,
      status TEXT DEFAULT 'running',
      quotes_scraped INTEGER DEFAULT 0,
      products_found INTEGER DEFAULT 0,
      errors TEXT,
      notes TEXT
    );

    -- インデックス
    CREATE INDEX IF NOT EXISTS idx_products_model ON products(model_number);
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(product_name);
    CREATE INDEX IF NOT EXISTS idx_products_manufacturer ON products(manufacturer);
    CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);
    CREATE INDEX IF NOT EXISTS idx_quote_items_product ON quote_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_associations_product ON product_associations(product_id);
    CREATE INDEX IF NOT EXISTS idx_associations_confidence ON product_associations(confidence DESC);
  `);
}

/**
 * データベース接続を閉じる
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
