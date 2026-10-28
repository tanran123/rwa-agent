"""One node per calculation step. The node calls that step's program.run."""

from __future__ import annotations

from agent.calculation.state import PipelineState

FIELDS = (
    "source",
    "dest",
    "steps_ran",
    "stopped",
    "stop_reason",
    "result",
    "annotated",
    "trace_file",
    "ead_yi",
    "rwa_yi",
)


def make_node(step):
    name = step.NAME
    run = step.program.run

    def node(state: PipelineState) -> dict:
        context = {key: state[key] for key in FIELDS if key in state}
        if "steps_ran" not in context:
            context["steps_ran"] = []
        updated = run(context)
        if not isinstance(updated, dict):
            raise RuntimeError(name + " 没有返回状态")
        ran = list(updated.get("steps_ran") or [])
        ran.append(name)
        updated["steps_ran"] = ran
        return {key: updated[key] for key in FIELDS if key in updated}

    return node
