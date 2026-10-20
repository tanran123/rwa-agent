"""One directory per calculation step, in regulatory order."""

from . import ccf, crm, rwa, weight

ORDER = (weight, ccf, crm, rwa)


def specs(model) -> list[dict]:
    return [item.spec(model) for item in ORDER]
