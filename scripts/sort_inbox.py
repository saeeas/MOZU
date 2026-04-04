#!/usr/bin/env python3
"""
inbox/ フォルダのファイルを自動振り分けするスクリプト

ファイル命名規則:
  品番_カタログ.pdf  →  カタログ/メーカー名/
  品番_図面.pdf      →  図面/

使い方:
  python3 sort_inbox.py            # 通常実行
  python3 sort_inbox.py --dry-run  # 移動せず確認だけ

依存: openpyxl（なければ: pip3 install openpyxl）
"""

import os
import shutil
import argparse
from pathlib import Path

try:
    import openpyxl
    OPENPYXL_AVAILABLE = True
except ImportError:
    OPENPYXL_AVAILABLE = False

# ────────────────────────────────────────────
# メーカー判定: 品番プレフィックス → メーカー名
# 掛け率表.xlsx に新メーカーが追加されたらここも追記
# ────────────────────────────────────────────
MAKER_PREFIXES: dict[str, list[str]] = {
    "リンナイ": [
        "RUF", "RUFH", "RBF", "RC-", "RDT", "RMS",
        "REW", "RMH", "RGB", "GCW", "RHF", "RUS",
    ],
    "TOTO": [
        "TK", "CS", "SW", "TCF", "CES", "EWB", "WB",
        "DB", "TCA", "TLS",
    ],
    "LIXIL": [
        "BF", "SF", "LF", "CF", "BB", "RN", "A-",
        "AM", "BC", "DT",
    ],
    "ノーリツ": [
        "GT", "GQ", "GRQ", "ORC", "RC-N",
    ],
    "パナソニック": [
        "FY", "CH", "XCH", "DL-", "FV", "WY",
    ],
}


def load_makers_from_xlsx(xlsx_path: Path) -> list[str]:
    """掛け率表.xlsx の1列目からメーカー一覧を取得する"""
    if not OPENPYXL_AVAILABLE:
        print("⚠️  openpyxl がインストールされていません。pip3 install openpyxl で追加できます。")
        return []
    try:
        wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
        ws = wb.active
        makers = []
        for row in ws.iter_rows(min_row=2, values_only=True):
            if row and row[0]:
                maker = str(row[0]).strip()
                if maker and maker not in makers:
                    makers.append(maker)
        wb.close()
        return makers
    except Exception as e:
        print(f"⚠️  掛け率表の読み込みエラー: {e}")
        return []


def identify_maker(product_code: str) -> str | None:
    """品番プレフィックスからメーカーを特定する。不明なら None を返す"""
    code_upper = product_code.upper()
    for maker, prefixes in MAKER_PREFIXES.items():
        for prefix in prefixes:
            if code_upper.startswith(prefix.upper()):
                return maker
    return None


def parse_filename(filename: str) -> tuple[str, str | None]:
    """
    ファイル名を (品番, 種別) にパースする
    例: RUF-ME2406SAW_カタログ.pdf → ("RUF-ME2406SAW", "カタログ")
         TCF6543_図面.pdf           → ("TCF6543", "図面")
    """
    stem = Path(filename).stem  # 拡張子なし
    if "_" in stem:
        idx = stem.rfind("_")
        return stem[:idx], stem[idx + 1:]
    return stem, None


def sort_inbox(base_dir: Path, dry_run: bool = False) -> None:
    inbox_dir  = base_dir / "inbox"
    catalog_dir = base_dir / "カタログ"
    zumen_dir  = base_dir / "図面"
    xlsx_path  = base_dir / "掛け率表" / "掛け率表.xlsx"

    if not inbox_dir.exists():
        print(f"❌ inbox フォルダが見つかりません: {inbox_dir}")
        return

    # 掛け率表からメーカー一覧を確認（プレフィックスの補完は手動）
    if xlsx_path.exists():
        print(f"📊 掛け率表を読み込み中 ...")
        makers = load_makers_from_xlsx(xlsx_path)
        if makers:
            print(f"   確認済みメーカー: {', '.join(makers)}")
    else:
        print(f"⚠️  掛け率表が見つかりません（{xlsx_path}）")
        print("   掛け率表/掛け率表.xlsx を配置してください。")

    # inbox のファイル一覧
    files = sorted(
        f for f in inbox_dir.iterdir()
        if f.is_file() and not f.name.startswith(".")
    )

    if not files:
        print("\n📭 inbox にファイルがありません。")
        return

    print(f"\n📂 inbox: {len(files)} 件")
    print("─" * 50)

    moved = 0
    skipped = 0

    for file_path in files:
        product_code, file_type = parse_filename(file_path.name)

        if file_type == "図面":
            dest_dir  = zumen_dir
            dest_path = dest_dir / file_path.name

        elif file_type == "カタログ":
            maker = identify_maker(product_code)
            if maker:
                dest_dir = catalog_dir / maker
            else:
                dest_dir = catalog_dir / "未分類"
                print(f"  ⚠️  メーカー不明: {product_code} → カタログ/未分類/ に移動")
            dest_path = dest_dir / file_path.name

        else:
            kind = f"（種別: {file_type}）" if file_type else "（種別なし）"
            print(f"  ⏭️  スキップ {kind}: {file_path.name}")
            skipped += 1
            continue

        # 移動先フォルダを作成
        if not dry_run:
            dest_dir.mkdir(parents=True, exist_ok=True)

        # ファイル移動
        rel = dest_path.relative_to(base_dir)
        if dry_run:
            print(f"  [DRY-RUN] {file_path.name}  →  {rel}")
        else:
            if dest_path.exists():
                print(f"  ⚠️  上書き: {rel}")
            shutil.move(str(file_path), str(dest_path))
            print(f"  ✅ {file_path.name}  →  {rel}")

        moved += 1

    print("─" * 50)
    suffix = "（DRY-RUN）" if dry_run else ""
    print(f"完了{suffix}: {moved} 件移動, {skipped} 件スキップ\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="inbox/ のファイルをカタログ・図面フォルダへ自動振り分け"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="実際には移動しない確認モード"
    )
    parser.add_argument(
        "--base-dir",
        default=str(Path.home() / "Desktop" / "MOZU_resources"),
        help="MOZU_resources フォルダのパス（デフォルト: ~/Desktop/MOZU_resources）"
    )
    args = parser.parse_args()

    base_dir = Path(args.base_dir)
    print(f"🗂️  MOZU_resources: {base_dir}")

    sort_inbox(base_dir, dry_run=args.dry_run)
