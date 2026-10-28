"""python -m agent.mcp

Passes this project's tool list into the generic MCP server.
"""

import json
from pathlib import Path

from agent.tools import tools
from agent.mcp.server import serve


def server_name() -> str:
    path = Path(__file__).resolve().parents[1] / "agent.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    name = data.get("name") if isinstance(data, dict) else None
    if not isinstance(name, str) or not name.strip():
        raise ValueError(str(path) + " 缺少 name")
    return name.strip()


serve(tools, server_name())
