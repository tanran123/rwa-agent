"""The only layer allowed to call a model.

``core/`` must not import from here. Capabilities are single-purpose
DeepAgents graphs built from the skill files under ``agent/llm/skills/``.
"""

from agent.llm.client import CHAT, MAPPING, chat_model, complete

__all__ = ["CHAT", "MAPPING", "chat_model", "complete"]
