"""Shared runtime: settings, model, skills and on-disk checkpoint/store.

The old import surface is kept (``from agent.runtime import checkpointer``),
but storage is loaded lazily so importing ``agent.runtime.model`` from an
engine does not open SQLite as a side effect.
"""

from __future__ import annotations

from typing import Any

__all__ = [
    "CALCULATION",
    "LATEST",
    "RUNTIME",
    "FileSaver",
    "Record",
    "SharedStore",
    "checkpointer",
    "store",
]

_STORAGE_NAMES = frozenset(__all__)


def __getattr__(name: str) -> Any:
    if name in _STORAGE_NAMES:
        from . import storage

        return getattr(storage, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__() -> list[str]:
    return sorted(__all__)
