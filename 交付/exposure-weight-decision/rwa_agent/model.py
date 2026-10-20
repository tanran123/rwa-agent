"""入口仍叫 rwa_agent.model。程序在 agent/subagents/weight/calc/model.py。"""

from rwa_agent._agent_path import REPO  # noqa: F401
from agent.subagents.weight.calc import model as _impl

globals().update({name: value for name, value in vars(_impl).items() if not name.startswith("__")})
