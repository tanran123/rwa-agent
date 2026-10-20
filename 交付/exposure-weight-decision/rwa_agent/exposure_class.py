"""入口仍叫 rwa_agent.exposure_class。程序在 agent/subagents/weight/calc/exposure_class.py。"""

from rwa_agent._agent_path import REPO  # noqa: F401
from agent.subagents.weight.calc import exposure_class as _impl

globals().update({name: value for name, value in vars(_impl).items() if not name.startswith("__")})
