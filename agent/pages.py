"""Page links the coordinator can open. Calculation subagents do not use this."""

from langchain_core.tools import tool

PAGES = {
    "/engine": "底稿计算",
    "/results": "结果明细",
    "/wizard": "计量向导",
}


@tool
def open_page(path: str) -> str:
    """Open a product page when the user asks to look at the screen. path is /engine, /results, or /wizard."""
    if path not in PAGES:
        return "没有这个页面：" + path
    return "将打开 " + PAGES[path]
