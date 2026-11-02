"""One registry for calculation order and enablement.

``ORDER`` in ``agent.steps`` is the regulatory order. This module is the
only place that decides which of those steps may actually execute: a step must
be listed in ``ENABLED`` *and* expose a working ``program.run``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

ENABLED: tuple[str, ...] = ("weight",)


@dataclass(frozen=True)
class StepSpec:
    name: str
    detail: str
    module: Any
    enabled: bool

    @property
    def program(self):
        return self.module.program

    def status(self) -> str:
        return self.program.status()

    def run(self, context: dict) -> dict:
        return self.program.run(context)


def steps() -> tuple[StepSpec, ...]:
    """All steps in regulatory order, with their enablement resolved."""
    from agent.steps import ORDER

    return tuple(
        StepSpec(
            name=item.program.NAME,
            detail=item.program.DETAIL,
            module=item,
            enabled=item.program.NAME in ENABLED,
        )
        for item in ORDER
    )


def by_name() -> dict[str, StepSpec]:
    return {item.name: item for item in steps()}


def active_names() -> list[str]:
    return [item.name for item in steps() if item.enabled]


def status_lines() -> list[str]:
    return [item.status() for item in steps()]
