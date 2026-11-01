"""Run one agent turn under the debugger, without Koa or Flask.

Examples:
    .venv/bin/python tools/debug_agent.py "帮我算 output/uploads/UP-mvoyi799.xlsx"
    .venv/bin/python tools/debug_agent.py --page /hqla --thread <id> --confirm false "取消"
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agent.composition.client import reply  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("message", nargs="?", default="只回复：调试测试。", help="用户这一句，默认一句无害问候")
    parser.add_argument("--page", default="/", help="当前页面，默认 /")
    parser.add_argument("--thread", help="接着上一轮的 threadId")
    parser.add_argument("--confirm", choices=["true", "false"], help="暂停时确认或取消")
    parser.add_argument("--catalog", help="页面表单目录 JSON 字符串")
    args = parser.parse_args()

    confirm = None if args.confirm is None else args.confirm == "true"
    catalog = json.loads(args.catalog) if args.catalog else None
    out = reply(
        [{"role": "user", "content": args.message}],
        args.page,
        None,
        args.thread,
        confirm,
        catalog,
    )
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
