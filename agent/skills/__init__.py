"""Skill directories. Each child directory holds one SKILL.md.

``DIALOGUE`` is only used by the legacy chat loop to append full bodies.
The DeepAgents coordinator loads every skill under ``agent/skills`` through
the skills middleware and discloses bodies on demand.
"""

DIALOGUE = ["calculation-order", "page-actions"]
