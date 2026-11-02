"""State carried from one calculation step to the next."""

from __future__ import annotations

from typing import Any

from typing_extensions import TypedDict


class PipelineState(TypedDict, total=False):
    source: str
    dest: str | None
    steps_ran: list[str]
    stopped: bool
    stop_reason: str
    result: dict[str, Any]
    annotated: str
    trace_file: str
    ead_yi: Any
    rwa_yi: Any
