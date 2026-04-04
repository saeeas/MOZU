import { Router } from "express";
import { google } from "googleapis";
import fs from "fs";
import path from "path";
import os from "os";

export const authRouter = Router();

const TOKEN_DIR = path.join(os.homedir(), ".mozu", "tokens");
const REDIRECT_URI = "http://localhost:3000/auth/callback";

// アカウント定義
export const ACCOUNTS = {
  mozu:     { label: "MOZU（仕事）",   hint: "s_nagaosa@mozu-inc.com" },
  personal: { label: "個人（Gmail）",  hint: "1296bty@gmail.com" },
} as const;
export type AccountKey = keyof typeof ACCOUNTS;

function getClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    REDIRECT_URI
  );
}

export function getTokenPath(account: AccountKey) {
  return path.join(TOKEN_DIR, `${account}.json`);
}

export function loadToken(account: AccountKey) {
  const p = getTokenPath(account);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function saveToken(account: AccountKey, token: object) {
  fs.mkdirSync(TOKEN_DIR, { recursive: true });
  fs.writeFileSync(getTokenPath(account), JSON.stringify(token, null, 2));
}

export function getAuthClient(account: AccountKey) {
  const client = getClient();
  const token = loadToken(account);
  if (!token) return null;
  client.setCredentials(token);
  return client;
}

// GET /auth/connect/:account  → Google OAuthページへリダイレクト
authRouter.get("/connect/:account", (req, res) => {
  const account = req.params.account as AccountKey;
  if (!ACCOUNTS[account]) return res.status(400).send("不明なアカウント");

  const client = getClient();
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar.readonly"],
    state: account,
    login_hint: ACCOUNTS[account].hint,
  });
  res.redirect(url);
});

// GET /auth/callback  → トークンを保存してホームへ
authRouter.get("/callback", async (req, res) => {
  const { code, state } = req.query as { code: string; state: AccountKey };
  if (!code || !state || !ACCOUNTS[state]) {
    return res.status(400).send("認証エラー");
  }

  const client = getClient();
  const { tokens } = await client.getToken(code);
  saveToken(state, tokens);

  res.redirect(`/?connected=${state}`);
});

// GET /auth/status  → 各アカウントの接続状況
authRouter.get("/status", (_req, res) => {
  const status: Record<string, boolean> = {};
  for (const key of Object.keys(ACCOUNTS) as AccountKey[]) {
    status[key] = !!loadToken(key);
  }
  res.json(status);
});

// DELETE /auth/disconnect/:account
authRouter.delete("/disconnect/:account", (req, res) => {
  const account = req.params.account as AccountKey;
  const p = getTokenPath(account);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  res.json({ ok: true });
});
