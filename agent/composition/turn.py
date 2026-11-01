"""Per-request notes for the coordinator. Not stored in the checkpoint."""

from __future__ import annotations

import contextvars

catalog_text = contextvars.ContextVar("rwa_catalog", default="")
page_actions = contextvars.ContextVar("rwa_page_actions", default=None)


def note_page_actions(actions) -> None:
    page_actions.set(actions)


def noted_page_actions():
    return page_actions.get()
