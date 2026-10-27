"""Nodes for the coordinator graph."""

from __future__ import annotations

from typing import Literal

from langchain.messages import AIMessage, SystemMessage, ToolMessage
from langgraph.graph import END
from langgraph.types import interrupt

from agent.platform.layout import system_prompt
from agent.platform.state import MessagesState
from agent.platform.turn import catalog_text
from agent.tools import tools


def model_failed(state: MessagesState) -> dict:
    """Shown when the model call still fails after retry."""
    return {"messages": [AIMessage(content="模型调用失败，没有形成回答。")]}


def confirmed(decision) -> bool:
    return isinstance(decision, dict) and decision.get("confirm") is True


def make_nodes(chat):
    # Augment the LLM with tools
    tools_by_name = {item.name: item for item in tools}
    model_with_tools = chat.bind_tools(tools)

    # Step 3: Define model node

    def llm_call(state: MessagesState):
        """LLM decides whether to call a tool or not"""

        content = system_prompt()
        extra = catalog_text.get()
        if extra:
            content = content + "\n\n" + extra
        return {
            "messages": [
                model_with_tools.invoke(
                    [SystemMessage(content=content)]
                    + state["messages"]
                )
            ],
            "llm_calls": state.get("llm_calls", 0) + 1
        }

    # Step 4: Define tool node

    def tool_node(state: MessagesState):
        """Performs the tool call"""

        calls = state["messages"][-1].tool_calls
        allowed = True
        pending = [item for item in calls if item.get("name") == "run_weight_decision"]
        if pending:
            books = []
            for item in pending:
                books.append(str((item.get("args") or {}).get("workbook") or ""))
            decision = interrupt("将计算工作簿：" + "、".join(books) + "。确认后才会开始计算。")
            allowed = confirmed(decision)
        result = []
        for tool_call in calls:
            if tool_call.get("name") == "run_weight_decision" and not allowed:
                observation = "未确认，没有开始计算。"
            else:
                tool = tools_by_name[tool_call["name"]]
                observation = tool.invoke(tool_call["args"])
            result.append(ToolMessage(content=observation, tool_call_id=tool_call["id"]))
        return {"messages": result}

    # Step 5: Define logic to determine whether to end

    # Conditional edge function to route to the tool node or end based upon whether the LLM made a tool call
    def should_continue(state: MessagesState) -> Literal["tool_node", END]:
        """Decide if we should continue the loop or stop based upon whether the LLM made a tool call"""

        messages = state["messages"]
        last_message = messages[-1]

        # If the LLM makes a tool call, then perform an action
        if last_message.tool_calls:
            return "tool_node"

        # Otherwise, we stop (reply to the user)
        return END

    return llm_call, tool_node, should_continue
