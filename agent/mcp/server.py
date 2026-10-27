"""Generic MCP tool server. One JSON object per line on stdin and stdout.

The server does not know what the tools do. Pass any objects that have
``name``, ``description``, and ``invoke``. ``args_schema`` or ``inputSchema``
supplies the parameter object when present.
"""

from __future__ import annotations

import json
import sys

PROTOCOL = "2024-11-05"
SUPPORTED = {"2024-11-05", "2025-03-26", "2025-06-18"}


def input_schema(item) -> dict:
    given = getattr(item, "inputSchema", None)
    if isinstance(given, dict):
        schema = {"type": "object", "properties": given.get("properties") or {}}
        required = given.get("required")
        if required:
            schema["required"] = required
        return schema
    model = getattr(item, "args_schema", None)
    raw = model.model_json_schema() if model is not None and hasattr(model, "model_json_schema") else {}
    schema = {"type": "object", "properties": raw.get("properties") or {}}
    required = raw.get("required")
    if required:
        schema["required"] = required
    return schema


def tool_listing(tools) -> list[dict]:
    return [
        {
            "name": item.name,
            "description": getattr(item, "description", "") or "",
            "inputSchema": input_schema(item),
        }
        for item in tools
    ]


def invoke_tool(tool, arguments) -> str:
    if arguments is None:
        arguments = {}
    if not isinstance(arguments, dict):
        raise TypeError("arguments 必须是对象")
    if hasattr(tool, "invoke"):
        return str(tool.invoke(arguments))
    return str(tool(arguments))


class Server:
    def __init__(self, tools, name: str, version: str = "0"):
        if not isinstance(name, str) or not name.strip():
            raise ValueError("MCP 服务缺少 name")
        self.name = name.strip()
        self.version = version or "0"
        self.by_name = {}
        ordered = []
        for item in tools:
            tool_name = getattr(item, "name", "")
            if not isinstance(tool_name, str) or not tool_name.strip():
                raise ValueError("工具缺少 name")
            tool_name = tool_name.strip()
            if tool_name in self.by_name:
                raise ValueError("工具重名：" + tool_name)
            self.by_name[tool_name] = item
            ordered.append(item)
        self.tools = ordered

    def call(self, name, arguments) -> dict:
        tool = self.by_name.get(name)
        if tool is None:
            return {"content": [{"type": "text", "text": "没有这个工具：" + str(name)}], "isError": True}
        try:
            text = invoke_tool(tool, arguments)
        except Exception as exc:
            return {"content": [{"type": "text", "text": str(exc)}], "isError": True}
        return {"content": [{"type": "text", "text": text}], "isError": False}

    def handle(self, message: dict):
        method = message.get("method")
        params = message.get("params") or {}
        if not isinstance(params, dict):
            raise ValueError("params 必须是对象")
        if method == "initialize":
            version = params.get("protocolVersion")
            if version not in SUPPORTED:
                version = PROTOCOL
            return {
                "protocolVersion": version,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": self.name, "version": self.version},
            }
        if method == "ping":
            return {}
        if method == "tools/list":
            return {"tools": tool_listing(self.tools)}
        if method == "tools/call":
            return self.call(params.get("name"), params.get("arguments"))
        raise LookupError(method or "")


def write(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def serve(tools, name: str, version: str = "0") -> None:
    """Serve tools until stdin closes. tools is any sequence of callable tools."""
    server = Server(tools, name, version)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            write({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}})
            continue
        if not isinstance(message, dict) or "method" not in message:
            if isinstance(message, dict) and "id" in message:
                write({"jsonrpc": "2.0", "id": message.get("id"), "error": {"code": -32600, "message": "Invalid Request"}})
            continue
        if "id" not in message:
            continue
        try:
            result = server.handle(message)
        except LookupError:
            write({"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32601, "message": "Method not found"}})
            continue
        except Exception as exc:
            write({"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32603, "message": str(exc)}})
            continue
        write({"jsonrpc": "2.0", "id": message["id"], "result": result})
