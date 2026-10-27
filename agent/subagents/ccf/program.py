"""Off-balance conversion. Stops until this step is implemented and listed."""

NAME = "ccf"
DETAIL = "表外转换系数：只处理表外，等值金额 = 名义金额 × 转换系数。"


def status() -> str:
    from agent.calculation.pipeline import active_steps

    state = "会执行" if NAME in active_steps() else "还没进名单，停住，不能编结果"
    return NAME + "：" + state + "。" + DETAIL


def explain() -> str:
    from agent.calculation.pipeline import active_steps

    if NAME in active_steps():
        return NAME + " 已在名单里，整表计算会按顺序执行。不要在对话里另算一套数。"
    return NAME + " 还没有实现。" + DETAIL + "流水线停住，不要编造转换系数或等值金额。"


def run(context: dict) -> dict:
    context["stopped"] = True
    context["stop_reason"] = explain()
    return context
