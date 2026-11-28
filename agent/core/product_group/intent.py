"""Intent classification and user-constraint extraction.

The rules are a fast path. Callers may call the intent skill when the result is
``auto``; this module never calls a model itself.
"""

from __future__ import annotations

import re
from typing import Any

ANSWER_HINTS = ("?", "？", "什么", "是什么", "为什么", "哪些", "哪个", "怎么", "如何", "详细", "解释", "介绍", "列出", "包含", "说明", "查一下", "看看", "是否", "有没有", "多少")
REFINE_HINTS = ("改成", "改为", "固定", "默认值", "复用", "不要", "不建", "不新建", "不创建", "换成", "新增", "删除", "只处理", "只保留", "全部", "全组", "整体", "优化", "调整", "应用")
REVIEW_HINTS = ("检查", "校验", "复核", "完整性", "合理性", "一致性", "有没有问题", "有没有遗漏", "质量")
GENERATE_HINTS = ("生成", "重新生成", "重生成", "生成本组", "重新做")

GLOBAL_HINTS = ("全部", "全组", "所有", "整体", "整个", "每个", "全部字段", "全组字段")

CONSTRAINT_PATTERNS = (
    ("NO_NEW_FIELDS", ("不要新建", "不新建", "不创建", "不要新增", "禁止新建", "不建标准字段", "不建任何标准字段")),
    ("REQUIRED_ONLY", ("只处理必填", "只保留必填", "只看必填", "仅必填", "只做必填")),
    ("PREFER_REUSE", ("复用已有", "优先复用", "复用现有", "不要重复建", "不重复建")),
    ("NO_OVERRIDE_USER_EDITS", ("不要覆盖", "保留我的修改", "不要改我改过", "保留人工修改")),
)


def _text(value: Any) -> str:
    return str(value or "").strip()


def _has(text: str, words: tuple[str, ...]) -> bool:
    return any(word in text for word in words)


def _targets_in_text(text: str, target_fields: list[dict]) -> list[str]:
    found = []
    for field in target_fields or []:
        if not isinstance(field, dict):
            continue
        name = _text(field.get("name"))
        label = _text(field.get("label"))
        if name and name in text:
            found.append(name)
        elif label and len(label) >= 2 and label in text:
            found.append(name)
    return list(dict.fromkeys(item for item in found if item))


def user_constraints(text: str) -> list[dict]:
    value = _text(text)
    found = []
    for code, words in CONSTRAINT_PATTERNS:
        if _has(value, words):
            found.append({"type": code, "text": value, "source": "user"})
    assignments = []
    for match in re.finditer(r"([A-Za-z][A-Za-z0-9_]*)\s*(?:设为|改为|固定为|赋值为|固定)\s*([^\s，,。；;]+)", value):
        assignments.append({"field": match.group(1), "value": match.group(2)})
    if assignments:
        found.append({"type": "FIELD_ASSIGNMENTS", "assignments": assignments, "source": "user"})
    return found


def classify_intent(text: str, target_fields: list[dict] | None = None) -> dict:
    value = _text(text)
    targets = _targets_in_text(value, target_fields or [])
    constraints = user_constraints(value)
    review = _has(value, REVIEW_HINTS)
    refine = _has(value, REFINE_HINTS)
    answer = _has(value, ANSWER_HINTS)
    generate = _has(value, GENERATE_HINTS)
    global_scope = _has(value, GLOBAL_HINTS) or bool(
        [item for item in constraints if item.get("type") in ("NO_NEW_FIELDS", "REQUIRED_ONLY")]
    )

    if review and (refine or generate):
        tasks = []
        if refine or targets:
            tasks.append({"type": "global_refine" if global_scope else "local_refine", "targets": targets})
        tasks.append({"type": "review", "scope": "group"})
        return {
            "type": "composite",
            "confidence": 0.86,
            "targets": targets,
            "tasks": tasks,
            "constraints": constraints,
        }
    if generate and not refine:
        return {"type": "propose", "confidence": 0.88, "targets": targets, "tasks": [{"type": "propose"}], "constraints": constraints}
    if review:
        return {"type": "review", "confidence": 0.88, "targets": targets, "tasks": [{"type": "review", "scope": "group"}], "constraints": constraints}
    if answer and not refine:
        return {"type": "answer", "confidence": 0.8, "targets": targets, "tasks": [{"type": "answer"}], "constraints": constraints}
    if refine or targets:
        task_type = "global_refine" if global_scope else "local_refine"
        return {"type": task_type, "confidence": 0.82, "targets": targets, "tasks": [{"type": task_type, "targets": targets}], "constraints": constraints}
    return {"type": "auto", "confidence": 0.35, "targets": targets, "tasks": [], "constraints": constraints}
