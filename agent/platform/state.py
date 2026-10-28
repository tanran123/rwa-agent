"""State for the coordinator graph."""

from __future__ import annotations

import operator

from langchain.messages import AnyMessage
from typing_extensions import Annotated, TypedDict


class MessagesState(TypedDict):
    messages: Annotated[list[AnyMessage], operator.add]
    llm_calls: int
