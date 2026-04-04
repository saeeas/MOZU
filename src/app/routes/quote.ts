import { Router } from "express";
import multer from "multer";
import path from "path";
import os from "os";
import fs from "fs";
import * as XLSX from "xlsx";

export const quoteRouter = Router();

const MOZU_RESOURCES = path.join(os.homedir(), "Desktop", "MOZU_resources");
const XLSX_PATH = path.join(MOZU_RESOURCES, "掛け率表", "掛け率表.xlsx");

// 掛け率表アップロード先
const storage = multer.diskStorage({
  destination: path.join(MOZU_RESOURCES, "掛け率表"),
  filename: (_req, _file, cb) => cb(null, "掛け率表.xlsx"),
});
const upload = multer({ storage });

// ──────────────────────────────────────────
// メーカー判定テーブル（品番プレフィックス → メーカー）
// ──────────────────────────────────────────
const MAKER_PREFIXES: Record<string, string[]> = {
  "リンナイ":     ["RUF", "RUFH", "RBF", "RC-", "RDT", "RMS", "REW", "RMH", "RGB", "GCW", "RHF", "RUS"],
  "TOTO":        ["TK", "CS", "SW", "TCF", "CES", "EWB", "WB", "DB", "TCA", "TLS"],
  "LIXIL":       ["BF", "SF", "LF", "CF", "BB", "RN", "A-", "AM", "BC", "DT"],
  "ノーリツ":     ["GT", "GQ", "GRQ", "ORC"],
  "パナソニック":  ["FY", "CH", "XCH", "DL-", "FV", "WY"],
};

function identifyMaker(productCode: string): string | null {
  const upper = productCode.toUpperCase();
  for (const [maker, prefixes] of Object.entries(MAKER_PREFIXES)) {
    if (prefixes.some((p) => upper.startsWith(p.toUpperCase()))) return maker;
  }
  return null;
}

// ──────────────────────────────────────────
// 掛け率表.xlsx の読み込み
// 想定列: A=メーカー, B=品種カテゴリ, C=仕入れ掛け率, D=提示掛け率, E=適用開始日, F=備考
// ──────────────────────────────────────────
interface MarkupRow {
  maker: string;
  category: string;
  purchaseRate: number;   // 仕入れ掛け率
  displayRate: number;    // 提示掛け率
  appliedFrom?: string;
  note?: string;
}

function readMarkupRates(): MarkupRow[] {
  if (!fs.existsSync(XLSX_PATH)) return [];

  const wb = XLSX.readFile(XLSX_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][];

  const result: MarkupRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;
    result.push({
      maker:        String(row[0] ?? "").trim(),
      category:     String(row[1] ?? "").trim(),
      purchaseRate: parseFloat(String(row[2])) || 0,
      displayRate:  parseFloat(String(row[3])) || 0,
      appliedFrom:  row[4] ? String(row[4]).trim() : undefined,
      note:         row[5] ? String(row[5]).trim() : undefined,
    });
  }
  return result;
}

function findRate(maker: string, rates: MarkupRow[]): MarkupRow | null {
  const norm = maker.toLowerCase();
  return (
    rates.find((r) => r.maker.toLowerCase() === norm) ||
    rates.find((r) => r.maker.toLowerCase().includes(norm) || norm.includes(r.maker.toLowerCase())) ||
    null
  );
}

// ──────────────────────────────────────────
// エンドポイント
// ──────────────────────────────────────────

// GET /api/quote/markup-rates  →  掛け率表の全行
quoteRouter.get("/markup-rates", (_req, res) => {
  const hasFile = fs.existsSync(XLSX_PATH);
  if (!hasFile) return res.json({ ok: false, error: "掛け率表が見つかりません", rates: [] });
  res.json({ ok: true, rates: readMarkupRates() });
});

// POST /api/quote/calculate
// body: { productCode: string, listPrice: number }
quoteRouter.post("/calculate", (req, res) => {
  const { productCode, listPrice } = req.body as {
    productCode: string;
    listPrice: number;
  };

  if (!productCode || !listPrice) {
    return res.status(400).json({ error: "productCode と listPrice は必須です" });
  }

  const maker = identifyMaker(productCode);
  const rates = readMarkupRates();
  const row = maker ? findRate(maker, rates) : null;

  if (!row) {
    return res.json({
      ok: false,
      productCode,
      listPrice,
      maker: maker ?? "不明",
      error: "掛け率表にメーカーが見つかりません",
    });
  }

  const purchasePrice = Math.round(listPrice * row.purchaseRate);
  const displayPrice  = Math.round(listPrice * row.displayRate);

  res.json({
    ok: true,
    productCode,
    listPrice,
    maker: row.maker,
    category: row.category,
    purchaseRate:  row.purchaseRate,
    displayRate:   row.displayRate,
    purchasePrice,
    displayPrice,
    appliedFrom: row.appliedFrom,
    note: row.note,
  });
});

// POST /api/quote/upload-markup-rates  →  掛け率表.xlsx をアップロードして上書き保存
quoteRouter.post("/upload-markup-rates", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "ファイルなし" });
  res.json({ ok: true, message: "掛け率表を更新しました" });
});

// GET /api/quote/markup-rates-status  →  掛け率表の存在チェック
quoteRouter.get("/markup-rates-status", (_req, res) => {
  const exists = fs.existsSync(XLSX_PATH);
  const mtime  = exists ? fs.statSync(XLSX_PATH).mtime.toISOString() : null;
  res.json({ exists, mtime, path: XLSX_PATH });
});
