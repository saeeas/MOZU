import { Router } from "express";
import fs from "fs";
import path from "path";
import os from "os";

export const checklistRouter = Router();

const STATE_DIR = path.join(os.homedir(), ".mozu");
const STATE_FILE = path.join(STATE_DIR, "checklist-state.json");

// デフォルトのチェックリスト項目
const DEFAULT_ITEMS = [
  { id: "markup_dl",   label: "掛け率表をDLして所定フォルダに上書き保存",  emoji: "📊" },
  { id: "mozu_mail",   label: "MOZUメールチェック",                         emoji: "📧" },
  { id: "gmail_mail",  label: "Gmailチェック",                              emoji: "📧" },
];

interface ChecklistState {
  date: string;   // YYYY-MM-DD
  checked: Record<string, boolean>;
}

function loadState(): ChecklistState {
  if (!fs.existsSync(STATE_FILE)) return { date: "", checked: {} };
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
}

function saveState(state: ChecklistState) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// GET /api/checklist  →  今日のチェック状態を返す
checklistRouter.get("/", (_req, res) => {
  const today = todayStr();
  let state = loadState();

  // 日付が変わったらリセット
  if (state.date !== today) {
    state = { date: today, checked: {} };
    saveState(state);
  }

  const items = DEFAULT_ITEMS.map((item) => ({
    ...item,
    checked: !!state.checked[item.id],
  }));

  res.json({ date: today, items });
});

// PATCH /api/checklist/:id  →  チェック状態を更新
checklistRouter.patch("/:id", (req, res) => {
  const { id } = req.params;
  const { checked } = req.body as { checked: boolean };
  const today = todayStr();

  let state = loadState();
  if (state.date !== today) state = { date: today, checked: {} };

  state.checked[id] = checked;
  saveState(state);

  res.json({ ok: true, id, checked });
});
