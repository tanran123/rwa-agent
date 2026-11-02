"""Repository paths and the two shared data files. One place, no parents[4]."""

from __future__ import annotations

from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
AGENT = REPO / "agent"
OUTPUT = REPO / "output"
WEIGHT = AGENT / "steps" / "weight"
CLASS_DOC = WEIGHT / "knowledge" / "权重法风险暴露分类.json"
PAPER_CACHE = WEIGHT / "paper" / "底稿模型计算.json"
PAPER_SAMPLES = WEIGHT / "samples"
TRACES = OUTPUT / "traces"
WORKBOOKS = OUTPUT / "workbooks"
