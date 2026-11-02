"""Inject the current page catalog into the model request, not the checkpoint."""

from __future__ import annotations

from langchain.agents.middleware import AgentMiddleware, ModelRequest
from langchain_core.messages import SystemMessage

from agent.llm.session.turn import catalog_text


def _with_catalog(request: ModelRequest) -> ModelRequest:
    extra = catalog_text.get()
    if not extra:
        return request
    current = request.system_message
    body = str(current.content) if current is not None else ""
    content = (body + "\n\n" + extra).strip() if body else extra
    return request.override(system_message=SystemMessage(content=content))


class TurnContextMiddleware(AgentMiddleware):
    """Append the per-request catalog to the system prompt on every model call."""

    def wrap_model_call(self, request, handler):
        return handler(_with_catalog(request))

    async def awrap_model_call(self, request, handler):
        return await handler(_with_catalog(request))
