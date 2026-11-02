"""Read the JSON object a capability model returned."""

from __future__ import annotations

import json
import re


def extract_json(text: str) -> dict:
    raw = str(text or "").strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", raw, re.DOTALL)
    if fenced:
        raw = fenced.group(1)
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end <= start:
        raise RuntimeError("模型没有返回可用的 JSON")
    return json.loads(raw[start : end + 1])
