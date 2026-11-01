from types import SimpleNamespace

from agent.composition import client


def test_result_has_the_page_contract() -> None:
    out = client._result("回答", "thread-1", False)
    assert out == {
        "reply": "回答",
        "pages": [],
        "draft": None,
        "actions": [],
        "threadId": "thread-1",
        "confirm": False,
    }


def test_actions_of_reads_a_fenced_block() -> None:
    text = '先说一句。\n```json\n{"actions":[{"path":"/hqla","form":"task","fields":{"name":"A"},"save":true}]}\n```'
    steps, shown = client.actions_of(text)
    assert steps == [{"path": "/hqla", "form": "task", "fields": {"name": "A"}, "save": True}]
    assert "actions" not in shown


def test_strip_actions_json_keeps_prose() -> None:
    text = '在页面上处理。{"actions":[{"form":"task","save":false}]}'
    assert client.strip_actions_json(text).strip() == "在页面上处理。"


def test_coerce_actions_accepts_strings_and_lists() -> None:
    assert client.coerce_actions('[{"form":"a"}]') == [{"form": "a", "save": False}]
    assert client.coerce_actions({"actions": [{"path": "/x", "form": "b"}]}) == [
        {"path": "/x", "form": "b", "save": False}
    ]


def test_for_page_drops_forms_from_other_pages() -> None:
    catalog = {"forms": [{"id": "task", "path": "/hqla"}]}
    actions = [{"form": "task", "fields": {"a": 1}, "save": True}, {"form": "other"}]
    assert client.for_page(actions, "/hqla", catalog) == [
        {"path": "/hqla", "form": "task", "fields": {"a": 1}, "save": True}
    ]


def test_draft_of_returns_none_without_a_json_fence() -> None:
    assert client.draft_of("没有草稿") is None
    assert client.draft_of('```json\n{"name":"doc"}\n```') == {"name": "doc"}


def test_reply_returns_the_same_shape(monkeypatch) -> None:
    message = SimpleNamespace(type="ai", content="已经算好。")
    snapshot = SimpleNamespace(values={"messages": [message]}, interrupts=())

    class FakeGraph:
        def get_state(self, config):
            return snapshot

        def stream(self, payload, config, **kwargs):
            yield {}

        def update_state(self, config, values):
            return None

    import agent.platform.graph as graph_module

    monkeypatch.setattr(graph_module, "graph", lambda: FakeGraph())
    monkeypatch.setattr(graph_module, "thread_config", lambda thread_id, checkpoint_id=None: {"configurable": {"thread_id": thread_id}})

    out = client.reply([{"role": "user", "content": "算一下"}], "/")
    assert out["reply"] == "已经算好。"
    assert out["pages"] == []
    assert out["actions"] == []
    assert out["confirm"] is False
    assert out["threadId"]


def test_reply_reports_a_pending_confirmation(monkeypatch) -> None:
    interrupted = SimpleNamespace(values={"messages": []}, interrupts=[SimpleNamespace(value="将计算工作簿：a.xlsx。确认后才会开始计算。")])
    snapshot = SimpleNamespace(values={"messages": []}, interrupts=())

    class FakeGraph:
        def get_state(self, config):
            return interrupted

        def stream(self, payload, config, **kwargs):
            yield {}

    import agent.platform.graph as graph_module

    monkeypatch.setattr(graph_module, "graph", lambda: FakeGraph())
    monkeypatch.setattr(graph_module, "thread_config", lambda thread_id, checkpoint_id=None: {"configurable": {"thread_id": thread_id}})

    out = client.reply([{"role": "user", "content": "算 a.xlsx"}], "/", confirm=None)
    assert out["confirm"] is True
    assert "将计算工作簿" in out["reply"]


def test_interrupt_text_reads_hitl_action_requests() -> None:
    value = {
        "action_requests": [
            {"name": "run_weight_decision", "args": {"workbook": "a.xlsx"}},
            {"name": "run_weight_decision", "args": {"workbook": "b.xlsx"}},
        ]
    }
    assert client._interrupt_text(value) == "将计算工作簿：a.xlsx、b.xlsx。确认后才会开始计算。"


def test_interrupt_text_falls_back_to_a_generic_sentence() -> None:
    assert client._interrupt_text({"action_requests": [{"name": "x", "args": {}}]}) == "这一步需要确认，确认后才会继续。"


def test_resume_builds_hitl_decisions() -> None:
    value = {"action_requests": [{"name": "x", "args": {}} for _ in range(2)]}
    approved = client._resume(value, True)
    rejected = client._resume(value, False)
    assert approved.resume == {"decisions": [{"type": "approve"}, {"type": "approve"}]}
    assert rejected.resume == {
        "decisions": [
            {"type": "reject", "message": "用户取消计算"},
            {"type": "reject", "message": "用户取消计算"},
        ]
    }


def test_resume_keeps_the_legacy_shape() -> None:
    assert client._resume("将计算工作簿：a.xlsx。确认后才会开始计算。", False).resume == {"confirm": False}


def test_reply_returns_page_actions_from_a_tool_call(monkeypatch) -> None:
    from langchain_core.messages import AIMessage, HumanMessage

    history = [
        HumanMessage(content="填一下名称"),
        AIMessage(
            content="",
            tool_calls=[
                {
                    "name": "page_actions",
                    "args": {"actions": [{"path": "/orgs", "form": "org", "fields": {"name": "测试银行"}, "save": False}]},
                    "id": "call-1",
                    "type": "tool_call",
                }
            ],
        ),
        AIMessage(content="已经填好。"),
    ]
    snapshot = SimpleNamespace(values={"messages": history}, interrupts=())

    class FakeGraph:
        def get_state(self, config):
            return snapshot

        def stream(self, payload, config, **kwargs):
            yield {}

    import agent.platform.graph as graph_module

    monkeypatch.setattr(graph_module, "graph", lambda: FakeGraph())
    monkeypatch.setattr(graph_module, "thread_config", lambda thread_id, checkpoint_id=None: {"configurable": {"thread_id": thread_id}})

    catalog = {"forms": [{"id": "org", "path": "/orgs"}]}
    out = client.reply([{"role": "user", "content": "填一下名称"}], "/orgs", catalog=catalog)
    assert out["actions"] == [{"path": "/orgs", "form": "org", "fields": {"name": "测试银行"}, "save": False}]
    assert "已按这些步骤" in out["reply"]
