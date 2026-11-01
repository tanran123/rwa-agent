import uuid

from agent.calculation import registry
from agent.calculation.nodes import FIELDS
from agent.calculation.pipeline import STEPS, active_steps, pipeline_steps
from agent.calculation.state import PipelineState
from agent.composition.subagents import build_subagents
from agent.runtime.skills import read_skill

EXPECTED_STEPS = (
    "weight：会执行。风险暴露权重判断：按权重法风险暴露分类划分暴露、取权重并计算敞口。\n"
    "ccf：还没进名单，停住，不能编结果。表外转换系数：只处理表外，等值金额 = 名义金额 × 转换系数。\n"
    "crm：还没进名单，停住，不能编结果。缓释：把覆盖部分和未覆盖部分拆开，不改原来的风险权重。\n"
    "rwa：还没进名单，停住，不能编结果。按留痕汇总风险加权资产。\n"
    "当前顺序：weight"
)


def test_registry_order_and_enablement() -> None:
    items = registry.steps()
    assert [item.name for item in items] == ["weight", "ccf", "crm", "rwa"]
    assert [item.enabled for item in items] == [True, False, False, False]
    assert registry.active_names() == ["weight"]


def test_pipeline_steps_text_is_unchanged() -> None:
    assert pipeline_steps.invoke({}) == EXPECTED_STEPS


def test_steps_alias_matches_registry() -> None:
    assert STEPS == active_steps() == ["weight"]


def test_state_annotations_are_the_only_field_list() -> None:
    assert FIELDS == tuple(PipelineState.__annotations__)


def test_subagent_specs_match_the_registry() -> None:
    specs = build_subagents()
    assert [item["name"] for item in specs] == ["weight", "ccf", "crm", "rwa"]
    by_name = {item["name"]: item for item in specs}
    assert [tool.name for tool in by_name["weight"]["tools"]] == ["pipeline_steps", "run_weight_decision"]
    assert [tool.name for tool in by_name["ccf"]["tools"]] == ["pipeline_steps", "ccf_status"]
    assert [tool.name for tool in by_name["crm"]["tools"]] == ["pipeline_steps", "crm_status"]
    assert [tool.name for tool in by_name["rwa"]["tools"]] == ["pipeline_steps", "rwa_status"]
    assert by_name["weight"]["skills"] == ["/skills/"]
    assert "skills" not in by_name["ccf"]


def test_disabled_steps_stop_without_inventing_numbers() -> None:
    from agent.subagents.ccf.program import run as run_ccf
    from agent.subagents.crm.program import run as run_crm
    from agent.subagents.rwa.program import run as run_rwa

    for step in (run_ccf, run_crm, run_rwa):
        out = step({})
        assert out["stopped"] is True
        assert out["stop_reason"]


def test_graph_has_all_nodes_but_only_weight_runs() -> None:
    from agent.calculation.graph import calculation

    graph = calculation()
    nodes = {name for name in graph.get_graph().nodes if name not in ("__start__", "__end__")}
    assert nodes == {"weight", "ccf", "crm", "rwa"}

    out = graph.invoke(
        {"source": "", "steps_ran": []},
        {"configurable": {"thread_id": "phase3-test-" + uuid.uuid4().hex[:8]}},
    )
    assert out["steps_ran"] == ["weight"]
    assert out["stopped"] is True
    assert out["stop_reason"] == "没有工作簿路径"


def test_credit_weight_skill_loads() -> None:
    skill = read_skill("credit-weight")
    assert "run_weight_decision" in skill.body
    assert "不要自己重算" in skill.body


def test_subagents_can_be_disabled(monkeypatch) -> None:
    from agent.composition.chat import _subagents_enabled

    monkeypatch.setenv("RWA_COORDINATOR_SUBAGENTS", "0")
    assert _subagents_enabled() is False
    monkeypatch.setenv("RWA_COORDINATOR_SUBAGENTS", "1")
    assert _subagents_enabled() is True


def test_step_spec_delegates_to_program_run(monkeypatch) -> None:
    import agent.subagents.weight.program as program
    from agent.calculation.registry import by_name

    seen = {}

    def fake_run(context):
        seen.update(context)
        return {"delegated": True}

    monkeypatch.setattr(program, "run", fake_run)
    out = by_name()["weight"].run({"source": "x.xlsx"})
    assert out == {"delegated": True}
    assert seen == {"source": "x.xlsx"}
