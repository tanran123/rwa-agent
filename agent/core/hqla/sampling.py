"""抽样：全量 / 属性抽样（AAM 23005A.1）/ 固定样本量，按申报档位分层，种子可复现。"""

from __future__ import annotations

ATTR_TABLE = {
    ("lower", "relying"): [4, 16, 30],
    ("lower", "none"): [14, 34, 54],
    ("higher", "relying"): [10, 28, 46],
    ("higher", "none"): [30, 57, 83],
}


def attribute_sample_size(sampling):
    row = ATTR_TABLE.get((sampling.get("risk"), sampling.get("reliance"))) or ATTR_TABLE[("lower", "none")]
    idx = min(2, max(0, int(sampling.get("expectedDeviations") or 0)))
    return row[idx]


def mulberry32(seed):
    state = {"a": int(seed) & 0xFFFFFFFF}

    def rnd():
        a = state["a"]
        a |= 0
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = (t ^ (t >> 15)) & 0xFFFFFFFF
        t = (t * (1 | t)) & 0xFFFFFFFF
        t = (t + ((t ^ (t >> 7)) * (61 | t))) & 0xFFFFFFFF
        state["a"] = a
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

    return rnd


def plan_sample(rows, cfg):
    sampling = cfg.get("sampling") or {}
    universe = [r for r in rows if not r.get("isAdjustment")]
    if sampling.get("onlyMatched"):
        universe = [r for r in universe if r.get("ref")]
    filter_level = sampling.get("filterLevel")
    if filter_level and filter_level != "ALL":
        universe = [r for r in universe if r.get("item") == filter_level]

    size = len(universe)
    method = "全量检查（100%）"
    if sampling.get("mode") == "attribute":
        size = attribute_sample_size(sampling)
        risk_label = "较高风险" if sampling.get("risk") == "higher" else "较低风险"
        rely_label = "依赖控制" if sampling.get("reliance") == "relying" else "不依赖控制"
        method = f"属性抽样（AAM 23005A.1：{risk_label} / {rely_label} / 预计偏差 {sampling.get('expectedDeviations') or 0}）"
    elif sampling.get("mode") == "fixed":
        size = min(len(universe), max(1, int(sampling.get("fixedSize") or 15)))
        method = f"固定样本量（{size} 笔）"
    size = min(size, len(universe))

    rnd = mulberry32(int(sampling.get("seed") or 1))

    strata = {}
    for row in universe:
        key = "UNK" if row.get("item") == "UNK" else row.get("item")
        strata.setdefault(key, []).append(row)
    keys = [k for k in strata if strata[k]]

    alloc = {}
    if not sampling.get("stratify", True) or size >= len(universe):
        for key in keys:
            alloc[key] = len(strata[key])
    else:
        total = len(universe)
        assigned = 0
        remainders = []
        for key in keys:
            exact = size * len(strata[key]) / total
            base = int(exact)
            if base == 0 and strata[key]:
                base = 1
            alloc[key] = min(base, len(strata[key]))
            assigned += alloc[key]
            remainders.append({"k": key, "r": exact - base})
        remainders.sort(key=lambda item: item["r"], reverse=True)
        i = 0
        while assigned < size and i < len(remainders) * 4:
            key = remainders[i % len(remainders)]["k"]
            if alloc[key] < len(strata[key]):
                alloc[key] += 1
                assigned += 1
            i += 1

    picked = []
    for key in keys:
        pool = sorted(strata[key], key=lambda row: str(row.get("key") or ""))
        n = min(alloc.get(key, 0), len(pool))
        indices = list(range(len(pool)))
        for i in range(len(indices) - 1, 0, -1):
            j = int(rnd() * (i + 1))
            indices[i], indices[j] = indices[j], indices[i]
        for idx in indices[:n]:
            picked.append(pool[idx])
    picked.sort(key=lambda row: row.get("i", 0))

    return {
        "indices": [row.get("i") for row in picked],
        "size": len(picked),
        "universe": len(universe),
        "method": method,
        "seed": int(sampling.get("seed") or 1),
        "strata": [{"level": key, "population": len(strata[key]), "sample": alloc.get(key, 0)} for key in keys],
        "coverage": (len(picked) / len(universe)) if universe else 0,
    }
