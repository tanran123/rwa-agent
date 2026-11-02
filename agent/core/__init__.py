"""Deterministic code. Nothing here may import ``agent.llm``.

If a module under this package needs a model, the capability belongs in
``agent/llm/capabilities`` and the core function takes the result as input.
"""
