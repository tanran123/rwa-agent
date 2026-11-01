import inspect
import json

from agent.platform.graph import agent
from agent.runtime.skills import read_skill
from agent.tools import tools
from agent.tools.domain import (
    exposure_class_summary,
    hqla_compute_summary,
    hqla_sample_plan,
    market_modules,
    working_paper_summary,
)

DOMAIN = {
    "working_paper_summary",
    "hqla_compute_summary",
    "hqla_sample_plan",
    "market_modules",
    "exposure_class_summary",
}


def test_domain_tools_are_registered() -> None:
    names = {item.name for item in tools}
    assert DOMAIN <= names
    assert len(names) == len(tools)


def test_working_paper_summary_reads_the_cache() -> None:
    data = json.loads(working_paper_summary.invoke({}))
    assert data["file"]
    assert isinstance(data["process_row_count"], int)
    assert data["process_row_count"] >= 0
    assert "ead_yi" in data


def test_hqla_tools_use_a_task_payload() -> None:
    task = {
        "input": {"rows": [{"lineNo": 1, "item": "L1", "secId": "A|B", "ccyGroupRaw": "USD", "amount": 100}]},
        "cfg": None,
        "lists": {},
        "reported": [],
    }
    reference = [{"id": "A|B", "rating": "Aaa", "rw": 0, "p30": 1, "ccy": "USD", "mat": "2030-01-01"}]
    summary = json.loads(hqla_compute_summary.invoke({"task": task, "reference": reference}))
    assert summary["stats"]["total"] == 1
    assert summary["stats"]["matched"] == 1
    assert "rows" not in summary

    plan = json.loads(hqla_sample_plan.invoke({"task": task, "reference": reference}))
    assert plan["size"] == 1
    assert plan["universe"] == 1


def test_market_modules_returns_the_catalog() -> None:
    modules = json.loads(market_modules.invoke({}))
    assert modules
    assert {"id", "title"} <= set(modules[0])


def test_exposure_class_summary_counts_rules() -> None:
    data = json.loads(exposure_class_summary.invoke({}))
    assert data["rule_count"] >= 1
    assert data["field_count"] >= 1


def test_domain_skills_load() -> None:
    for name in ("hqla-review", "market-risk", "reference-data", "working-paper", "credit-weight"):
        skill = read_skill(name)
        assert skill.description
        assert skill.body


def test_graph_entry_takes_no_arguments() -> None:
    assert inspect.signature(agent).parameters == {}
