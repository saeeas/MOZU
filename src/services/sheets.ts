import { google } from "googleapis";
import { MarkupRate } from "../types/quote";

/**
 * Google Sheets から掛け率テーブルを取得する
 *
 * スプレッドシートの想定フォーマット:
 * | メーカー名 | カテゴリ | 掛け率 |
 * | TOTO      | 水回り   | 0.65  |
 * | LIXIL     | 建材     | 0.60  |
 */
export class SheetsService {
  private sheets;
  private spreadsheetId: string;

  constructor() {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    this.sheets = google.sheets({ version: "v4", auth });
    this.spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || "";
  }

  /**
   * 掛け率テーブル全体を取得
   * シート名 "掛け率" の A2:C を読む想定（1行目はヘッダー）
   */
  async getMarkupRates(): Promise<MarkupRate[]> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "掛け率!A2:C",
    });

    const rows = res.data.values || [];
    return rows.map((row) => ({
      manufacturer: row[0] || "",
      category: row[1] || undefined,
      rate: parseFloat(row[2]) || 0,
    }));
  }

  /**
   * メーカー名で掛け率を検索（部分一致）
   */
  async findRate(manufacturer: string): Promise<MarkupRate | undefined> {
    const rates = await this.getMarkupRates();
    const normalized = manufacturer.toLowerCase();

    // 完全一致を優先
    const exact = rates.find(
      (r) => r.manufacturer.toLowerCase() === normalized
    );
    if (exact) return exact;

    // 部分一致
    return rates.find(
      (r) =>
        r.manufacturer.toLowerCase().includes(normalized) ||
        normalized.includes(r.manufacturer.toLowerCase())
    );
  }
}
