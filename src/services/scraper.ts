import { chromium, Browser, Page, BrowserContext } from "playwright-core";
import path from "path";
import fs from "fs";
import { getDatabase } from "./database";

/** スクレイピング設定 */
interface ScraperConfig {
  /** LIXIL認証ページURL */
  authUrl: string;
  /** LIXILポータルURL */
  portalUrl: string;
  /** ログインID */
  loginId: string;
  /** パスワード */
  loginPassword: string;
  /** 図面保存先ディレクトリ */
  drawingsDir: string;
  /** headlessモード */
  headless: boolean;
  /** ページ読み込みタイムアウト（ms） */
  timeout: number;
  /** リクエスト間の待機時間（ms） */
  delayBetweenRequests: number;
  /** Chromiumの実行パス（環境に応じて設定） */
  executablePath?: string;
}

/** スクレイピングした見積もり情報 */
interface ScrapedQuote {
  quoteNumber: string;
  quoteDate?: string;
  customerName?: string;
  projectName?: string;
  totalAmount?: number;
  sourceUrl?: string;
  items: ScrapedQuoteItem[];
  drawings: ScrapedDrawing[];
}

/** スクレイピングした明細行 */
interface ScrapedQuoteItem {
  productName: string;
  modelNumber?: string;
  quantity: number;
  unit: string;
  unitPrice?: number;
  subtotal?: number;
}

/** ダウンロードした図面 */
interface ScrapedDrawing {
  fileName: string;
  filePath: string;
  fileType: string;
}

/**
 * LIXILパートナーポータルから見積もりデータを自動スクレイピング
 *
 * 対象: https://ptnrportal.apps.lixil.com/l-limb-top/ui/Top/Top.aspx
 *
 * ASP.NETアプリケーション（ViewState, PostBack）のため
 * Playwrightでフルブラウザ操作を行う
 */
export class LixilScraper {
  private config: ScraperConfig;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private logId: number | null = null;

  constructor(config?: Partial<ScraperConfig>) {
    this.config = {
      authUrl:
        process.env.LIXIL_AUTH_URL ||
        "https://ex-auth.lixil.co.jp/#/login",
      portalUrl:
        process.env.LIXIL_PORTAL_URL ||
        "https://ptnrportal.apps.lixil.com/l-limb-top/ui/Top/Top.aspx",
      loginId: process.env.LIXIL_LOGIN_ID || "",
      loginPassword: process.env.LIXIL_LOGIN_PASSWORD || "",
      drawingsDir: path.join(process.cwd(), "data", "drawings"),
      headless: process.env.LIXIL_HEADLESS !== "false",
      timeout: 60000,
      delayBetweenRequests: 2000,
      executablePath: process.env.CHROMIUM_PATH || undefined,
      ...config,
    };

    // 図面保存先を作成
    if (!fs.existsSync(this.config.drawingsDir)) {
      fs.mkdirSync(this.config.drawingsDir, { recursive: true });
    }
  }

  /**
   * スクレイピングを開始
   * 全見積もりをスキャンしてDBに保存する
   */
  async run(): Promise<{ quotesScraped: number; productsFound: number }> {
    const db = getDatabase();
    let quotesScraped = 0;
    let productsFound = 0;

    // スクレイピングログ開始
    const logResult = db
      .prepare("INSERT INTO scrape_logs (status) VALUES ('running')")
      .run();
    this.logId = logResult.lastInsertRowid as number;

    try {
      await this.launchBrowser();
      await this.login();

      console.log("[スクレイパー] ログイン成功、見積もり一覧を取得中...");

      // 見積もり一覧ページへ遷移
      await this.navigateToQuoteList();

      // 見積もり一覧をスキャン
      const quoteLinks = await this.collectQuoteLinks();
      console.log(`[スクレイパー] ${quoteLinks.length}件の見積もりを検出`);

      for (const link of quoteLinks) {
        try {
          console.log(`[スクレイパー] 見積もり処理中: ${link.quoteNumber}`);

          // 既にスクレイピング済みかチェック
          const existing = db
            .prepare("SELECT id FROM quotes WHERE quote_number = ?")
            .get(link.quoteNumber);

          if (existing) {
            console.log(`  → スキップ（取得済み）`);
            continue;
          }

          // 見積もり詳細を取得
          const quote = await this.scrapeQuoteDetail(link.url, link.quoteNumber);

          // DBに保存
          const saved = this.saveQuoteToDb(quote);
          quotesScraped++;
          productsFound += saved.newProducts;

          console.log(
            `  → 保存完了（明細: ${quote.items.length}件, 新規製品: ${saved.newProducts}件）`
          );

          // サーバー負荷軽減のため待機
          await this.delay(this.config.delayBetweenRequests);
        } catch (err) {
          console.error(`  → エラー: ${err instanceof Error ? err.message : err}`);
        }
      }

      // ページネーションがある場合は次ページへ
      let hasNextPage = true;
      while (hasNextPage) {
        hasNextPage = await this.goToNextPage();
        if (!hasNextPage) break;

        const moreLinks = await this.collectQuoteLinks();
        console.log(`[スクレイパー] 次ページ: ${moreLinks.length}件の見積もりを検出`);

        for (const link of moreLinks) {
          try {
            const existing = db
              .prepare("SELECT id FROM quotes WHERE quote_number = ?")
              .get(link.quoteNumber);

            if (existing) continue;

            const quote = await this.scrapeQuoteDetail(link.url, link.quoteNumber);
            const saved = this.saveQuoteToDb(quote);
            quotesScraped++;
            productsFound += saved.newProducts;

            await this.delay(this.config.delayBetweenRequests);
          } catch (err) {
            console.error(`  → エラー: ${err instanceof Error ? err.message : err}`);
          }
        }
      }

      // ログ更新
      db.prepare(
        `UPDATE scrape_logs SET finished_at = datetime('now'), status = 'completed',
         quotes_scraped = ?, products_found = ? WHERE id = ?`
      ).run(quotesScraped, productsFound, this.logId);

      console.log(
        `[スクレイパー] 完了: ${quotesScraped}件の見積もり, ${productsFound}件の新製品`
      );

      return { quotesScraped, productsFound };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      db.prepare(
        `UPDATE scrape_logs SET finished_at = datetime('now'), status = 'error',
         quotes_scraped = ?, products_found = ?, errors = ? WHERE id = ?`
      ).run(quotesScraped, productsFound, errorMsg, this.logId);
      throw err;
    } finally {
      await this.closeBrowser();
    }
  }

  // =========================================================================
  // ブラウザ操作
  // =========================================================================

  private async launchBrowser(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.config.headless,
      executablePath: this.config.executablePath,
    });
    this.context = await this.browser.newContext({
      acceptDownloads: true,
      locale: "ja-JP",
      viewport: { width: 1280, height: 900 },
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.config.timeout);
  }

  private async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }

  /**
   * LIXILポータルにログイン
   *
   * 認証フロー:
   * 1. ex-auth.lixil.co.jp でID/PW認証（SPA / #/login）
   * 2. 認証成功後、ポータル本体にリダイレクト or 手動遷移
   */
  private async login(): Promise<void> {
    const page = this.getPage();

    // --- Step 1: 認証ページにアクセス ---
    console.log("[スクレイパー] 認証ページにアクセス中...");
    await page.goto(this.config.authUrl, { waitUntil: "networkidle" });
    await this.delay(2000); // SPAレンダリング待ち

    // ID入力フィールドを探す（複数パターン対応）
    const userSelectors = [
      'input[type="text"]',
      'input[type="email"]',
      'input[name*="user" i]',
      'input[name*="id" i]',
      'input[name*="login" i]',
      'input[id*="user" i]',
      'input[id*="login" i]',
      'input[placeholder*="ID" i]',
      'input[placeholder*="ユーザー"]',
      'input[autocomplete="username"]',
    ];

    let userInput = null;
    for (const sel of userSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible().catch(() => false)) {
          userInput = el;
          break;
        }
      } catch { continue; }
    }

    if (!userInput) {
      // 全input[type=text]を試す
      userInput = page.locator('input').first();
    }

    await userInput.waitFor({ state: "visible", timeout: 15000 });
    await userInput.fill(this.config.loginId);
    console.log("[スクレイパー] ID入力完了");

    // PW入力フィールド
    const passInput = page.locator('input[type="password"]').first();
    await passInput.waitFor({ state: "visible", timeout: 10000 });
    await passInput.fill(this.config.loginPassword);
    console.log("[スクレイパー] パスワード入力完了");

    // ログインボタン
    const btnSelectors = [
      'button[type="submit"]',
      'button:has-text("ログイン")',
      'button:has-text("サインイン")',
      'button:has-text("Login")',
      'input[type="submit"]',
      'a:has-text("ログイン")',
    ];

    for (const sel of btnSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible().catch(() => false)) {
          await btn.click();
          console.log("[スクレイパー] ログインボタンクリック");
          break;
        }
      } catch { continue; }
    }

    // 認証完了を待機（URLが変わる or ページ遷移）
    await page.waitForLoadState("networkidle", { timeout: 30000 });
    await this.delay(3000);

    // --- Step 2: ポータル本体に遷移 ---
    const currentUrl = page.url();
    console.log(`[スクレイパー] 認証後URL: ${currentUrl}`);

    if (currentUrl.includes("ex-auth") || currentUrl.includes("login")) {
      // まだ認証ページにいる場合、エラーメッセージを確認
      const errorText = await page.locator('.error, .alert, [class*="error"]').innerText().catch(() => "");
      if (errorText) {
        throw new Error(`ログイン失敗: ${errorText}`);
      }
      // 認証は通ったかもしれないがリダイレクトされていない → ポータルに手動遷移
      console.log("[スクレイパー] ポータルへ手動遷移...");
      await page.goto(this.config.portalUrl, { waitUntil: "networkidle" });
    }

    // 最終確認
    const finalUrl = page.url();
    if (finalUrl.includes("login") || finalUrl.includes("Login")) {
      throw new Error("ログインに失敗しました。ID/パスワードを確認してください。");
    }

    console.log(`[スクレイパー] ログイン成功 → ${finalUrl}`);
  }

  /**
   * 見積もり一覧ページへ遷移
   *
   * ポータルのナビゲーションメニューから見積もり一覧にアクセス
   * ASP.NETの場合、メニューリンクがPostBackの場合がある
   */
  private async navigateToQuoteList(): Promise<void> {
    const page = this.getPage();

    // ナビゲーションメニューから見積もり関連のリンクを探索
    // 「見積」「見積もり」「見積一覧」「見積書」などのテキストを含むリンクを検索
    const quoteNavSelectors = [
      'a:has-text("見積")',
      'a:has-text("見積一覧")',
      'a:has-text("見積書")',
      '[id*="Quote"], [id*="quote"], [id*="Mitsumori"]',
      'a[href*="Quote"], a[href*="quote"], a[href*="Mitsumori"]',
    ];

    for (const selector of quoteNavSelectors) {
      try {
        const link = page.locator(selector).first();
        const isVisible = await link.isVisible().catch(() => false);
        if (isVisible) {
          await link.click();
          await page.waitForLoadState("networkidle");
          console.log("[スクレイパー] 見積もり一覧ページに遷移");
          return;
        }
      } catch {
        continue;
      }
    }

    // フレーム内のナビゲーションも確認（ASP.NETはiframeを使うことがある）
    for (const frame of page.frames()) {
      for (const selector of quoteNavSelectors) {
        try {
          const link = frame.locator(selector).first();
          const isVisible = await link.isVisible().catch(() => false);
          if (isVisible) {
            await link.click();
            await page.waitForLoadState("networkidle");
            console.log("[スクレイパー] フレーム内の見積もり一覧に遷移");
            return;
          }
        } catch {
          continue;
        }
      }
    }

    console.warn(
      "[スクレイパー] 見積もり一覧のナビゲーションが見つかりません。現在のページで続行します。"
    );
  }

  /**
   * 見積もり一覧から各見積もりへのリンクを収集
   */
  private async collectQuoteLinks(): Promise<
    { quoteNumber: string; url: string }[]
  > {
    const page = this.getPage();
    const links: { quoteNumber: string; url: string }[] = [];

    // テーブル行またはリスト要素から見積もり情報を取得
    // ASP.NETのGridViewやListViewパターン
    const rows = await page
      .locator(
        'table[id*="Grid"] tr, table[id*="List"] tr, table[id*="grd"] tr, .quote-list tr, table.data tr'
      )
      .all();

    for (const row of rows) {
      try {
        // 各行からリンクと見積もり番号を抽出
        const link = row.locator("a").first();
        const href = await link.getAttribute("href").catch(() => null);
        const text = await row.innerText().catch(() => "");

        // 見積もり番号のパターン（数字+ハイフン、または英数字の組み合わせ）
        const quoteNumMatch = text.match(
          /[A-Z]?\d{4,}[-]?\d{0,}|Q\d+|MT\d+|[A-Z]{2,3}-\d{4,}/
        );

        if (quoteNumMatch && href) {
          links.push({
            quoteNumber: quoteNumMatch[0],
            url: href.startsWith("http")
              ? href
              : new URL(href, page.url()).toString(),
          });
        } else if (href && href !== "#") {
          // 見積もり番号が取れなくてもリンクがあれば番号部分を推定
          const linkText = await link.innerText().catch(() => "");
          if (linkText.trim()) {
            links.push({
              quoteNumber: linkText.trim(),
              url: href.startsWith("http")
                ? href
                : new URL(href, page.url()).toString(),
            });
          }
        }
      } catch {
        continue;
      }
    }

    // GridViewがなかった場合のフォールバック: 全リンクからパターンマッチ
    if (links.length === 0) {
      const allLinks = await page.locator("a[href]").all();
      for (const a of allLinks) {
        try {
          const href = await a.getAttribute("href");
          const text = await a.innerText();
          if (
            href &&
            (href.includes("Quote") ||
              href.includes("Detail") ||
              href.includes("Mitsumori") ||
              text.match(/\d{6,}/))
          ) {
            links.push({
              quoteNumber: text.trim() || `unknown-${links.length}`,
              url: href.startsWith("http")
                ? href
                : new URL(href, page.url()).toString(),
            });
          }
        } catch {
          continue;
        }
      }
    }

    return links;
  }

  /**
   * 見積もり詳細ページからデータを抽出
   */
  private async scrapeQuoteDetail(
    url: string,
    quoteNumber: string
  ): Promise<ScrapedQuote> {
    const page = this.getPage();

    // PostBackリンクの場合はJavaScript実行
    if (url.startsWith("javascript:")) {
      await page.evaluate(url);
    } else {
      await page.goto(url, { waitUntil: "networkidle" });
    }
    await page.waitForLoadState("networkidle");

    const quote: ScrapedQuote = {
      quoteNumber,
      sourceUrl: page.url(),
      items: [],
      drawings: [],
    };

    // ---- ヘッダー情報の取得 ----
    // 見積もり番号、日付、顧客名、プロジェクト名
    const headerFields = await this.extractHeaderFields(page);
    quote.quoteDate = headerFields.date;
    quote.customerName = headerFields.customer;
    quote.projectName = headerFields.project;
    quote.totalAmount = headerFields.total;

    // ---- 明細情報の取得 ----
    quote.items = await this.extractLineItems(page);

    // ---- 図面・添付ファイルのダウンロード ----
    quote.drawings = await this.downloadAttachments(page, quoteNumber);

    // 一覧に戻る
    await this.navigateBack();

    return quote;
  }

  /**
   * 見積もりヘッダー情報を抽出
   */
  private async extractHeaderFields(
    page: Page
  ): Promise<{
    date?: string;
    customer?: string;
    project?: string;
    total?: number;
  }> {
    const result: {
      date?: string;
      customer?: string;
      project?: string;
      total?: number;
    } = {};

    // ASP.NETのラベルやテーブルセルからテキストを取得
    const pageText = await page.innerText("body").catch(() => "");

    // 日付パターン
    const dateMatch = pageText.match(
      /(\d{4}[\/\-年]\d{1,2}[\/\-月]\d{1,2}日?)/
    );
    if (dateMatch) result.date = dateMatch[1];

    // 顧客名（「お客様名」「顧客名」「得意先」の後のテキスト）
    const customerMatch = pageText.match(
      /(?:お客様名|顧客名|得意先)[：:\s]*([^\n\r\t]+)/
    );
    if (customerMatch) result.customer = customerMatch[1].trim();

    // プロジェクト名（「物件名」「工事名」「案件名」の後のテキスト）
    const projectMatch = pageText.match(
      /(?:物件名|工事名|案件名|現場名)[：:\s]*([^\n\r\t]+)/
    );
    if (projectMatch) result.project = projectMatch[1].trim();

    // 合計金額
    const totalMatch = pageText.match(
      /(?:合計|総合計|見積金額)[：:\s]*[￥¥]?\s*([\d,]+)/
    );
    if (totalMatch) result.total = parseFloat(totalMatch[1].replace(/,/g, ""));

    return result;
  }

  /**
   * 見積もり明細行を抽出
   */
  private async extractLineItems(page: Page): Promise<ScrapedQuoteItem[]> {
    const items: ScrapedQuoteItem[] = [];

    // 明細テーブルを探す
    const tableSelectors = [
      'table[id*="Detail"] tr',
      'table[id*="Item"] tr',
      'table[id*="Meisai"] tr',
      'table[id*="grd"] tr',
      "table.detail tr",
      "table.items tr",
      "#detailTable tr",
    ];

    let rows: any[] = [];
    for (const selector of tableSelectors) {
      rows = await page.locator(selector).all();
      if (rows.length > 1) break; // ヘッダー行を考慮して2行以上
    }

    // フォールバック: ページ内の全テーブルの行を検査
    if (rows.length <= 1) {
      rows = await page.locator("table tr").all();
    }

    let isHeader = true;
    for (const row of rows) {
      // ヘッダー行はスキップ
      if (isHeader) {
        const th = await row.locator("th").count();
        if (th > 0) continue;
        // 最初のtd行もヘッダーの可能性があるのでテキスト確認
        const text = await row.innerText().catch(() => "");
        if (
          text.includes("品名") ||
          text.includes("商品名") ||
          text.includes("型番")
        ) {
          isHeader = false;
          continue;
        }
        isHeader = false;
      }

      try {
        const cells = await row.locator("td").allInnerTexts();
        if (cells.length < 2) continue;

        // セルの内容から明細情報を推定
        // 一般的な並び: No | 品名 | 型番 | 数量 | 単位 | 単価 | 金額
        const item = this.parseLineItemCells(cells);
        if (item && item.productName) {
          items.push(item);
        }
      } catch {
        continue;
      }
    }

    return items;
  }

  /**
   * テーブルセルから明細情報を解析
   */
  private parseLineItemCells(cells: string[]): ScrapedQuoteItem | null {
    const cleaned = cells.map((c) => c.trim()).filter((c) => c.length > 0);
    if (cleaned.length < 2) return null;

    // 全セルが数字のみの行はスキップ（合計行等）
    if (cleaned.every((c) => /^[\d,.\-]+$/.test(c) || c === "")) return null;

    // 品名を探す: 数字でない最初の実質的なテキストセル
    let productName = "";
    let modelNumber: string | undefined;
    let quantity = 1;
    let unit = "式";
    let unitPrice: number | undefined;
    let subtotal: number | undefined;

    for (const cell of cleaned) {
      // 品番/型番パターン（英数字+ハイフン）
      if (
        !modelNumber &&
        /^[A-Z][A-Z0-9\-]{3,}/.test(cell) &&
        cell.length <= 30
      ) {
        modelNumber = cell;
        continue;
      }

      // 数量パターン（整数 or 小数1-2桁）
      if (/^\d+(\.\d{1,2})?$/.test(cell) && parseFloat(cell) < 10000) {
        if (!quantity || quantity === 1) {
          quantity = parseFloat(cell);
          continue;
        }
      }

      // 金額パターン（カンマ付き数字）
      if (/^[\d,]+$/.test(cell) && cell.includes(",")) {
        const num = parseFloat(cell.replace(/,/g, ""));
        if (!unitPrice) {
          unitPrice = num;
        } else if (!subtotal) {
          subtotal = num;
        }
        continue;
      }

      // 単位パターン
      if (/^(個|台|本|枚|セット|組|式|m|㎡|箇所)$/.test(cell)) {
        unit = cell;
        continue;
      }

      // それ以外で文字を含む場合は品名候補
      if (!productName && cell.length > 1 && /[ぁ-んァ-ヶ亜-熙a-zA-Z]/.test(cell)) {
        productName = cell;
      }
    }

    if (!productName) return null;

    return {
      productName,
      modelNumber,
      quantity,
      unit,
      unitPrice,
      subtotal,
    };
  }

  /**
   * 添付ファイル（図面PDF等）をダウンロード
   */
  private async downloadAttachments(
    page: Page,
    quoteNumber: string
  ): Promise<ScrapedDrawing[]> {
    const drawings: ScrapedDrawing[] = [];
    const quoteDir = path.join(this.config.drawingsDir, quoteNumber);

    // ダウンロードリンクを探す
    const downloadSelectors = [
      'a[href*=".pdf"]',
      'a[href*="download"]',
      'a[href*="Download"]',
      'a:has-text("図面")',
      'a:has-text("PDF")',
      'a:has-text("ダウンロード")',
      'a[href*="attachment"]',
      'a[href*="file"]',
    ];

    for (const selector of downloadSelectors) {
      try {
        const links = await page.locator(selector).all();
        for (const link of links) {
          try {
            const text = await link.innerText().catch(() => "");
            const href = await link.getAttribute("href").catch(() => null);

            if (!href) continue;

            // ダウンロードディレクトリの準備
            if (!fs.existsSync(quoteDir)) {
              fs.mkdirSync(quoteDir, { recursive: true });
            }

            // Playwrightのダウンロード機能を使用
            const [download] = await Promise.all([
              page.waitForEvent("download", { timeout: 10000 }).catch(() => null),
              link.click().catch(() => null),
            ]);

            if (download) {
              const suggestedName =
                download.suggestedFilename() || `${quoteNumber}_${drawings.length}.pdf`;
              const savePath = path.join(quoteDir, suggestedName);
              await download.saveAs(savePath);

              const ext = path.extname(suggestedName).replace(".", "");
              drawings.push({
                fileName: suggestedName,
                filePath: savePath,
                fileType: ext || "pdf",
              });

              console.log(`  → 図面ダウンロード: ${suggestedName}`);
            }
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }

    return drawings;
  }

  /**
   * 一覧ページに戻る
   */
  private async navigateBack(): Promise<void> {
    const page = this.getPage();
    try {
      // 「戻る」ボタンを探す
      const backSelectors = [
        'a:has-text("戻る")',
        'a:has-text("一覧")',
        'input[value*="戻る"]',
        'button:has-text("戻る")',
      ];
      for (const sel of backSelectors) {
        const btn = page.locator(sel).first();
        const visible = await btn.isVisible().catch(() => false);
        if (visible) {
          await btn.click();
          await page.waitForLoadState("networkidle");
          return;
        }
      }
      // フォールバック: ブラウザバック
      await page.goBack({ waitUntil: "networkidle" });
    } catch {
      // エラーでもリカバリ試行
      await page.goto(this.config.portalUrl, { waitUntil: "networkidle" });
      await this.navigateToQuoteList();
    }
  }

  /**
   * ページネーション: 次ページへ
   */
  private async goToNextPage(): Promise<boolean> {
    const page = this.getPage();
    try {
      const nextSelectors = [
        'a:has-text("次へ")',
        'a:has-text("次のページ")',
        'a:has-text(">")',
        ".pager a.next",
        'input[value="次へ"]',
        '[id*="NextPage"]',
      ];

      for (const sel of nextSelectors) {
        const btn = page.locator(sel).first();
        const visible = await btn.isVisible().catch(() => false);
        if (visible) {
          await btn.click();
          await page.waitForLoadState("networkidle");
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  // =========================================================================
  // DB保存
  // =========================================================================

  /**
   * スクレイピングした見積もりデータをDBに保存
   */
  private saveQuoteToDb(quote: ScrapedQuote): { newProducts: number } {
    const db = getDatabase();
    let newProducts = 0;

    const insertQuote = db.prepare(`
      INSERT INTO quotes (quote_number, quote_date, customer_name, project_name, total_amount, source_url, raw_data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertItem = db.prepare(`
      INSERT INTO quote_items (quote_id, product_id, product_name, model_number, quantity, unit, unit_price, subtotal, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertDrawing = db.prepare(`
      INSERT INTO drawings (product_id, quote_id, file_name, file_path, file_type)
      VALUES (?, ?, ?, ?, ?)
    `);

    const upsertProduct = db.prepare(`
      INSERT INTO products (model_number, product_name, manufacturer, list_price, unit)
      VALUES (?, ?, 'LIXIL', ?, ?)
      ON CONFLICT(model_number, manufacturer)
      DO UPDATE SET
        product_name = COALESCE(NULLIF(excluded.product_name, ''), product_name),
        list_price = COALESCE(excluded.list_price, list_price),
        updated_at = datetime('now')
    `);

    const findProduct = db.prepare(
      "SELECT id FROM products WHERE model_number = ? AND manufacturer = 'LIXIL'"
    );

    // トランザクションで一括保存
    const saveTransaction = db.transaction(() => {
      // 見積もりヘッダー
      const quoteResult = insertQuote.run(
        quote.quoteNumber,
        quote.quoteDate || null,
        quote.customerName || null,
        quote.projectName || null,
        quote.totalAmount || null,
        quote.sourceUrl || null,
        JSON.stringify(quote)
      );
      const quoteId = quoteResult.lastInsertRowid as number;

      // 明細行
      for (let i = 0; i < quote.items.length; i++) {
        const item = quote.items[i];
        let productId: number | null = null;

        // 製品マスタにUPSERT
        if (item.modelNumber) {
          upsertProduct.run(
            item.modelNumber,
            item.productName,
            item.unitPrice || null,
            item.unit
          );
          const product = findProduct.get(item.modelNumber) as any;
          if (product) {
            productId = product.id;
            // 新規追加されたかチェック
            const check = db
              .prepare(
                "SELECT COUNT(*) as cnt FROM quote_items WHERE product_id = ?"
              )
              .get(productId) as any;
            if (check && check.cnt === 0) newProducts++;
          }
        }

        insertItem.run(
          quoteId,
          productId,
          item.productName,
          item.modelNumber || null,
          item.quantity,
          item.unit,
          item.unitPrice || null,
          item.subtotal || null,
          i
        );
      }

      // 図面
      for (const drawing of quote.drawings) {
        insertDrawing.run(null, quoteId, drawing.fileName, drawing.filePath, drawing.fileType);
      }

      return { quoteId, newProducts };
    });

    const result = saveTransaction();
    return { newProducts: result.newProducts };
  }

  // =========================================================================
  // ユーティリティ
  // =========================================================================

  private getPage(): Page {
    if (!this.page) throw new Error("ブラウザが初期化されていません");
    return this.page;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
