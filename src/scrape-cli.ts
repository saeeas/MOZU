import "dotenv/config";
import { LixilScraper } from "./services/scraper";
import { RecommendationEngine } from "./services/recommender";
import { closeDatabase } from "./services/database";

/**
 * LIXILポータルスクレイピング CLI
 *
 * 使い方:
 *   npx ts-node src/scrape-cli.ts                 # スクレイピング実行 + レコメンド構築
 *   npx ts-node src/scrape-cli.ts --scrape-only   # スクレイピングのみ
 *   npx ts-node src/scrape-cli.ts --build-only    # レコメンドDB再構築のみ
 *   npx ts-node src/scrape-cli.ts --stats          # 統計表示
 *   npx ts-node src/scrape-cli.ts --recommend XXX  # 品番XXXのレコメンド取得
 */

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  if (args.includes("--stats")) {
    showStats();
    return;
  }

  if (args.includes("--recommend")) {
    const idx = args.indexOf("--recommend");
    const modelNumber = args[idx + 1];
    if (!modelNumber) {
      console.error("品番を指定してください: --recommend <品番>");
      process.exit(1);
    }
    showRecommendations(modelNumber);
    return;
  }

  const scrapeOnly = args.includes("--scrape-only");
  const buildOnly = args.includes("--build-only");

  try {
    // ステップ1: スクレイピング
    if (!buildOnly) {
      console.log("========================================");
      console.log("  MOZU - LIXILポータル スクレイピング");
      console.log("========================================\n");

      validateEnv();

      const scraper = new LixilScraper();
      const result = await scraper.run();

      console.log(`\n見積もり取得数: ${result.quotesScraped}`);
      console.log(`新製品追加数: ${result.productsFound}`);
    }

    // ステップ2: レコメンド構築
    if (!scrapeOnly) {
      console.log("\n========================================");
      console.log("  付属品レコメンド データ構築");
      console.log("========================================\n");

      const engine = new RecommendationEngine();
      const assocResult = engine.buildAssociations();
      console.log(`関連ペア数: ${assocResult.pairsFound}`);

      // 統計表示
      const stats = engine.getStats();
      console.log(`\n--- データベース統計 ---`);
      console.log(`製品数: ${stats.totalProducts}`);
      console.log(`見積もり数: ${stats.totalQuotes}`);
      console.log(`関連ペア数: ${stats.totalAssociations}`);

      if (stats.topProducts.length > 0) {
        console.log(`\n--- よく見積もりされる製品 TOP10 ---`);
        for (const p of stats.topProducts) {
          console.log(`  ${p.modelNumber || "(品番なし)"} | ${p.productName} | ${p.count}件`);
        }
      }
    }
  } catch (err) {
    console.error("\nエラー:", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    closeDatabase();
  }
}

function validateEnv(): void {
  if (!process.env.LIXIL_LOGIN_ID || !process.env.LIXIL_LOGIN_PASSWORD) {
    console.error(
      "エラー: .envに LIXIL_LOGIN_ID と LIXIL_LOGIN_PASSWORD を設定してください"
    );
    process.exit(1);
  }
}

function showStats(): void {
  const engine = new RecommendationEngine();
  const stats = engine.getStats();

  console.log("--- MOZU データベース統計 ---");
  console.log(`製品数: ${stats.totalProducts}`);
  console.log(`見積もり数: ${stats.totalQuotes}`);
  console.log(`関連ペア数: ${stats.totalAssociations}`);

  if (stats.topProducts.length > 0) {
    console.log(`\nよく見積もりされる製品 TOP10:`);
    for (const p of stats.topProducts) {
      console.log(
        `  ${p.modelNumber || "(品番なし)"} | ${p.productName} | ${p.count}件`
      );
    }
  }

  closeDatabase();
}

function showRecommendations(modelNumber: string): void {
  const engine = new RecommendationEngine();
  const recs = engine.recommend(modelNumber);

  if (recs.length === 0) {
    console.log(`品番「${modelNumber}」のレコメンドデータがありません。`);
    console.log(
      "先にスクレイピングを実行してデータを蓄積してください。"
    );
  } else {
    console.log(`\n品番「${modelNumber}」と一緒に見積もりされる商品:\n`);
    for (const rec of recs) {
      const price = rec.listPrice ? `¥${rec.listPrice.toLocaleString()}` : "価格不明";
      console.log(
        `  ${rec.modelNumber || "(品番なし)"} | ${rec.productName} | ${price}`
      );
      console.log(`    ${rec.reason}`);
    }
  }

  closeDatabase();
}

function printHelp(): void {
  console.log(`
MOZU - LIXILポータル見積もりスクレイパー & レコメンドエンジン

使い方:
  npx ts-node src/scrape-cli.ts                  スクレイピング実行 + レコメンド構築
  npx ts-node src/scrape-cli.ts --scrape-only    スクレイピングのみ
  npx ts-node src/scrape-cli.ts --build-only     レコメンドDB再構築のみ
  npx ts-node src/scrape-cli.ts --stats          統計表示
  npx ts-node src/scrape-cli.ts --recommend XXX  品番XXXのレコメンド取得
  npx ts-node src/scrape-cli.ts --help           このヘルプを表示

環境変数 (.env):
  LIXIL_LOGIN_ID        LIXILポータルのログインID
  LIXIL_LOGIN_PASSWORD  LIXILポータルのパスワード
  LIXIL_PORTAL_URL      ポータルURL（デフォルト: https://ptnrportal.apps.lixil.com/...）
  LIXIL_HEADLESS        ブラウザ表示 true/false（デフォルト: true）
  CHROMIUM_PATH         Chromium実行ファイルのパス（任意）
  MOZU_DB_PATH          SQLiteデータベースのパス（デフォルト: data/mozu.db）
`);
}

main();
