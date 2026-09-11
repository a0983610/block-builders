#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把遊戲跑得起來的那幾支檔匯出成一個資料夾。

用途：① 整包丟給別人玩　② 給其他專案當參考（只有產品檔，沒有測試與工具）。

**要匯出哪些檔不是寫死的，是從 index.html 讀出來的**——它掃 `<script src="…">`，
再去 blueprints/list.js 把自訂藍圖的檔名撈出來。所以之後多加一支 .js、多一座藍圖，
這支腳本不用跟著改（這個 repo 的規矩：不要寫死會隨改動變動的東西）。

跑法（在 repo 根目錄或任何地方都可以，路徑是照這支檔自己的位置算的）：

    python tools/export-game.py                完整包 → dist/積木小人-v版號/
    python tools/export-game.py --min          精簡包：只有遊戲跑得起來的最小集
    python tools/export-game.py --zip          順便壓一份 .zip
    python tools/export-game.py --list         只印會匯出哪些檔，不複製
    python tools/export-game.py --clean        先把目標資料夾清空再匯出
    python tools/export-game.py --out D:\給同事  匯到別的地方

雙擊用的是旁邊的 export-game.bat。
"""

import argparse
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# <script src="…">。document.write 那一行組出來的字串也會被這條抓到，
# 所以下面用 PATH_OK 把「長得不像路徑」的濾掉。
SRC_RE = re.compile(r'<script\s+src="([^"]+)"')
PATH_OK = re.compile(r'^[\w\-./]+\.js$')
# index.html 開場防呆那張表：['lib/three.min.js', function () { return THREE; }]
NEED_RE = re.compile(r"\[\s*'([^']+\.js)'\s*,\s*function")
VER_RE = re.compile(r"const VERSION = '([^']+)'")
BP_RE = re.compile(r"BP_FILES\s*=\s*\[(.*?)\]", re.S)


def read(p: Path) -> str:
    return p.read_text(encoding='utf-8')


def scripts_in(html: Path) -> list[str]:
    """那一頁載了哪幾支本機的 .js（照出現順序）。"""
    return [s for s in SRC_RE.findall(read(html)) if PATH_OK.match(s)]


def blueprint_files() -> list[str]:
    """blueprints/list.js 裡登記的自訂藍圖檔名。"""
    m = BP_RE.search(read(ROOT / 'blueprints' / 'list.js'))
    return re.findall(r"'([^']+)'", m.group(1)) if m else []


def required() -> list[str]:
    """index.html 自己認定「少一支就跑不起來」的那幾支。"""
    return NEED_RE.findall(read(ROOT / 'index.html'))


def version() -> str:
    return VER_RE.search(read(ROOT / 'src' / 'game.js')).group(1)


def collect(full: bool) -> list[str]:
    """要複製的相對路徑清單（順序：遊戲頁 → 它載的 → 藍圖 → 工作台）。"""
    files = ['index.html'] + scripts_in(ROOT / 'index.html')
    if full:
        files += ['blueprints/list.js']
        files += ['blueprints/' + n for n in blueprint_files()]
        files += ['藍圖預覽.html'] + scripts_in(ROOT / '藍圖預覽.html')
    else:
        # 精簡包不帶自訂藍圖：index.html 那一段有 if (window.BP_FILES) 擋著，
        # 少了 list.js 只會在 console 留一則 404，遊戲照跑。
        files = [f for f in files if not f.startswith('blueprints/')]
    seen, out = set(), []
    for f in files:
        if f not in seen:
            seen.add(f)
            out.append(f)
    return out


def human(n: int) -> str:
    return f'{n / 1024:.0f} KB' if n < 1024 * 1024 else f'{n / 1024 / 1024:.2f} MB'


def main() -> int:
    ap = argparse.ArgumentParser(
        description='把遊戲跑得起來的檔案匯出成一個資料夾',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', help='輸出資料夾（預設 dist/積木小人-v版號）')
    ap.add_argument('--min', action='store_true',
                    help='精簡包：只有 index.html + lib/ + src/，不含自訂藍圖與藍圖預覽頁')
    ap.add_argument('--clean', action='store_true', help='先把目標資料夾整個清掉再匯出')
    ap.add_argument('--zip', action='store_true', help='匯出後順便壓一份同名 .zip')
    ap.add_argument('--list', action='store_true', help='只印會匯出哪些檔，不複製')
    a = ap.parse_args()

    full = not a.min
    ver = version()
    files = collect(full)

    # 缺檔先擋下來：寧可不出包，也不要出一包開起來是白畫面的
    missing = [f for f in files if not (ROOT / f).exists()]
    need_miss = [f for f in required() if f not in files]
    if missing or need_miss:
        for f in missing:
            print(f'  ✗ 找不到：{f}')
        for f in need_miss:
            print(f'  ✗ index.html 說這支是必要的，卻不在清單裡：{f}')
        print('沒有匯出任何東西。')
        return 1

    total = sum((ROOT / f).stat().st_size for f in files)
    label = '完整包' if full else '精簡包'
    print(f'積木小人 v{ver}　{label}：{len(files)} 支檔、{human(total)}')

    if a.list:
        for f in files:
            print(f'  {human((ROOT / f).stat().st_size):>9}  {f}')
        return 0

    out = Path(a.out) if a.out else ROOT / 'dist' / f'積木小人-v{ver}{"" if full else "-精簡"}'
    out = out.resolve()
    if out == ROOT or ROOT in out.parents and out.name in ('src', 'lib', 'blueprints', 'tools'):
        print(f'  ✗ 不能匯到 {out}（那是原始碼的位置）')
        return 1

    if a.clean and out.exists():
        # --clean 是真的 rmtree，所以只肯清「空的」或「上一次匯出的」資料夾
        if any(out.iterdir()) and not (out / 'index.html').exists():
            print(f'  ✗ {out} 裡面不像是上一次匯出的東西（沒有 index.html），沒有動它。')
            return 1
        shutil.rmtree(out)
        print(f'  已清空 {out}')
    existed = out.exists()
    for f in files:
        dst = out / f
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / f, dst)

    # 自我檢查：複製過去的 index.html 要求的每一支，在新資料夾裡都找得到
    bad = [s for s in scripts_in(out / 'index.html')
           if not (out / s).exists() and s in required()]
    print(f'  → {out}')
    if existed:
        print('    （資料夾本來就在，直接覆蓋；要先清空的話加 --clean）')
    if bad:
        for s in bad:
            print(f'  ✗ 匯出後仍然缺：{s}')
        return 1
    print(f'    必要的 {len(required())} 支相依檔都在，雙擊 index.html 就能玩。')
    if not full:
        print('    精簡包沒有 blueprints/：開起來 console 會有一則 list.js 404，遊戲照跑。')

    if a.zip:
        z = shutil.make_archive(str(out), 'zip', root_dir=out.parent, base_dir=out.name)
        print(f'  → {z}（{human(Path(z).stat().st_size)}）')
        print('    收到的人要先解壓縮出來再開裡面的 index.html。')
    return 0


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass                                  # 老 Python 沒有 reconfigure，讓它照預設編碼印
    sys.exit(main())
