"""LangGraph state for one product-group configuration run."""

from __future__ import annotations

from typing import Any, TypedDict


class GroupConfigState(TypedDict, total=False):
    payload: dict[str, Any]
    text: str
    thread_id: str
    run_id: str
    proposal_id: str
    draft_digest: str
    approval_status: str

    intent: dict[str, Any]
    plan: list[dict[str, Any]]
    tasks: list[dict[str, Any]]
    task_results: list[dict[str, Any]]

    answer_text: str
    proposed: dict[str, Any]
    merged: dict[str, Any]
    selection: dict[str, Any]
    diff: dict[str, Any]
    conflicts: list[dict[str, Any]]
    review_findings: list[dict[str, Any]]
    constraints: list[dict[str, Any]]
    requires_approval: bool

    status: str
    error: str
    result: dict[str, Any]
