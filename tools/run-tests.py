#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""跑測試的選單：不必記指令，選一個數字就好。

雙擊旁邊的 run-tests.bat 就會開這支。真正做事的還是 tools/e2e-3d.cjs
（與藍圖體檢 tools/check-bp.cjs），這裡只負責把常用的幾種跑法列出來、
把參數接過去、最後報一下花了多久與結果。

帶參數的話就不出選單，直接照你給的跑：

    python tools/run-tests.py --tier must
    python tools/run-tests.py --tier commit --seed 1184
    python tools/run-tests.py --until 完工慶祝

驗收規矩（見 CLAUDE.md〈測試與驗收〉）：commit 前跑 commit 檔就好，一輪綠就算完成；
完整輪是使用者說要跑才跑。
"""

import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
E2E = ROOT / 'tools' / 'e2e-3d.cjs'
CHECK_BP = ROOT / 'tools' / 'check-bp.cjs'

# 選單：(顯示的字, 要跑的那支, 參數, 要不要再問一個字串)
MENU = [
    ('必要檔　　--tier must　　　骨架＋核心行為，改一行先跑這個', E2E, ['--tier', 'must'], None),
    ('commit 檔 --tier commit　 要 commit 前跑這個', E2E, ['--tier', 'commit'], None),
    ('完整輪　　（使用者說要跑才跑的那個）', E2E, [], None),
    ('跑到某一段就收工　--until 段名', E2E, ['--until'], '段名（例：完工慶祝）'),
    ('段落一覽　--list　　　　　印段名／等級／行數，不開瀏覽器', E2E, ['--list'], None),
    ('藍圖體檢　check-bp --all　48 座全掃一遍', CHECK_BP, ['--all'], None),
]


def run(script: Path, args: list[str]) -> int:
    """跑下去，輸出直接流到畫面上（不攔截，才看得到一條一條的進度）。"""
    cmd = ['node', str(script)] + args
    print('$ ' + ' '.join(cmd) + '\n', flush=True)
    t0 = time.time()
    try:
        code = subprocess.call(cmd, cwd=ROOT)
    except FileNotFoundError:
        print('找不到 node。這套測試要 Node.js 與 Playwright（chromium）。')
        return 2
    sec = time.time() - t0
    mm, ss = divmod(int(sec), 60)
    took = f'{mm} 分 {ss} 秒' if mm else f'{ss} 秒'
    print()
    if code == 0:
        # --list 只是印段落一覽，沒有跑任何一條，別讓它報「全部通過」
        print(f'✔ {"印完了" if "--list" in args else "全部通過"}（{took}）')
    elif code == 1:
        print(f'✘ 有失敗（{took}）')
        if script == E2E:
            print('  照上面印出來的種子重跑那一段就能重現：'
                  'node tools/e2e-3d.cjs --seed N --until 段名')
            print('  重現不出來的話那條是在賭骰子——修量測，不要動門檻'
                  '（見 CLAUDE.md〈紅了怎麼查〉）。')
    else:
        # e2e 的約定：0 過、1 有測試沒過、2 是腳本自己跑不起來（參數打錯、少裝東西）
        print(f'✘ 跑不起來，exit {code}（{took}）——原因就印在上面。')
    return code


def menu() -> int:
    print('積木小人 · 跑測試\n')
    for i, (label, _, _, _) in enumerate(MENU, 1):
        print(f'  [{i}] {label}')
    print('  [0] 離開')
    try:
        pick = input('\n選一個：').strip()
    except (EOFError, KeyboardInterrupt):
        return 0
    if pick in ('', '0'):
        return 0
    if not pick.isdigit() or not 1 <= int(pick) <= len(MENU):
        print('沒有這個選項。')
        return 2
    _, script, args, ask = MENU[int(pick) - 1]
    args = list(args)
    if ask:
        try:
            extra = input(ask + '：').strip()
        except (EOFError, KeyboardInterrupt):
            return 0
        if not extra:
            print('沒給，取消。')
            return 2
        args.append(extra)
    print()
    return run(script, args)


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass                                  # 老 Python 沒有 reconfigure，讓它照預設編碼印
    sys.exit(run(E2E, sys.argv[1:]) if len(sys.argv) > 1 else menu())
