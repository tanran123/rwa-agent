"""Deterministic product-group proposal, intent and review helpers.

This package is pure Python: no model calls, no ``agent.llm`` imports and no
database access. LangGraph nodes and Flask routes call it.
"""

from agent.core.product_group.intent import classify_intent
from agent.core.product_group.proposal import merge_proposal
from agent.core.product_group.review import review_proposal
from agent.core.product_group.revision import digest_payload

__all__ = ["classify_intent", "merge_proposal", "review_proposal", "digest_payload"]
