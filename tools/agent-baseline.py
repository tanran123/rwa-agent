"""Record baseline chat turns so a refactor can be compared turn by turn.

Run from the repo root after `./start.sh`:

    .venv/bin/python tools/agent-baseline.py            # all scenarios
    .venv/bin/python tools/agent-baseline.py --only 2   # one scenario
    .venv/bin/python tools/agent-baseline.py --workbook output/uploads/x.xlsx

The output goes to output/baseline/<timestamp>.json. Every scenario starts a
fresh thread; scenario 2 records the confirmation pause and then cancels, so it
never runs a real calculation.
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.request
from datetime import datetime
from pathlib import Path

BASE = "http://127.0.0.1:8766"
OUT = Path(__file__).resolve().parents[1] / "output" / "baseline"

SCENARIOS = [
    {
        "name": "progress",
        "page": "/",
        "messages": [{"role": "user", "content": "现在能算到哪一步？后面三步为什么停着？"}],
    },
    {
        "name": "calculation-confirm-cancel",
        "page": "/",
        "messages": [{"role": "user", "content": "帮我算一下这本工作簿的风险权重。"}],
        "then_confirm": False,
    },
    {
        "name": "last-result",
        "page": "/",
        "messages": [{"role": "user", "content": "上一次计算的结果是什么？"}],
    },
    {
        "name": "page-action",
        "page": "/hqla",
        "messages": [{"role": "user", "content": "把新建任务的名称填成 2026 年 HQLA 测试，先不要保存。"}],
    },
    {
        "name": "identify-products",
        "page": "/",
        "messages": [{"role": "user", "content": "帮我识别这些产品代码：REPO、IRS、FX。"}],
    },
    {
        "name": "rules-chat",
        "page": "/",
        "messages": [{"role": "user", "content": "权重法里商业银行的风险权重怎么取？"}],
    },
]


def post(path: str, body: dict, timeout: int = 120) -> dict:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        BASE + path,
        data=data,
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def run_one(item: dict) -> dict:
    if item["name"] == "rules-chat":
        return {"request": item, "response": post("/api/rules/chat", {"messages": item["messages"]})}
    body = {"messages": item["messages"], "page": item.get("page") or "/"}
    first = post("/api/agent/chat", body)
    record = {"request": body, "response": first}
    if "then_confirm" in item and first.get("threadId"):
        body2 = dict(body)
        body2["threadId"] = first["threadId"]
        body2["confirm"] = item["then_confirm"]
        body2["messages"] = [{"role": "user", "content": "取消"}]
        record["confirm_response"] = post("/api/agent/chat", body2)
    return record


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", type=int, help="1-based scenario number")
    parser.add_argument("--workbook", help="给场景 2 用一本真实工作簿，才会走到确认")
    args = parser.parse_args()
    if args.workbook:
        SCENARIOS[1]["messages"] = [
            {"role": "user", "content": "帮我算这本工作簿的风险权重：" + args.workbook}
        ]
    picked = SCENARIOS
    if args.only:
        picked = [SCENARIOS[args.only - 1]]

    OUT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = OUT / (stamp + ".json")
    results = []
    for item in picked:
        started = time.time()
        try:
            record = run_one(item)
        except Exception as exc:  # noqa: BLE001 - a baseline note, not a crash
            record = {"request": item, "error": f"{type(exc).__name__}: {exc}"}
        record["seconds"] = round(time.time() - started, 2)
        results.append(record)
        print(item["name"], "ok" if "error" not in record else record["error"])
    target.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    print("written", target)


if __name__ == "__main__":
    main()
