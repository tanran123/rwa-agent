from agent.core.product_group.intent import classify_intent
from agent.core.product_group.proposal import merge_proposal
from agent.core.product_group.review import review_proposal


def proposal(*decisions):
    return {"decisions": list(decisions), "standardFields": [], "mappings": [], "newDictionaries": []}


def test_intent_answer_and_refine():
    fields = [{"name": "bank_licensed_flag", "label": "是否银行"}]
    assert classify_intent("bank_licensed_flag 是什么？", fields)["type"] == "answer"
    assert classify_intent("把 bank_licensed_flag 改成固定默认值否", fields)["type"] == "local_refine"
    assert classify_intent("检查本组字段完整性", fields)["type"] == "review"


def test_merge_preserves_user_selection_and_new_decisions():
    previous = proposal({"targetField": "a", "decisionType": "reuse", "mapping": {"mappingType": "direct", "sourceField": "A"}})
    proposed = proposal(
        {"targetField": "a", "decisionType": "reuse", "mapping": {"mappingType": "direct", "sourceField": "A"}},
        {"targetField": "b", "decisionType": "reuse", "mapping": {"mappingType": "direct", "sourceField": "B"}},
    )
    merged = merge_proposal(previous, proposed, selection={"decisions": ["a"]})
    assert merged["selection"]["decisions"] == ["a", "b"]
    assert merged["diff"]["addedDecisions"] == ["b"]


def test_no_new_fields_constraint_creates_conflict():
    proposed = proposal(
        {"targetField": "a", "decisionType": "create", "mapping": {"mappingType": "direct", "sourceField": "A"}}
    )
    merged = merge_proposal({}, proposed, constraints=[{"type": "NO_NEW_FIELDS"}])
    assert merged["requiresApproval"] is True
    assert merged["selection"]["decisions"] == []
    assert merged["conflicts"][0]["code"] == "NO_NEW_FIELDS"


def test_review_calc_mapping_and_missing_required():
    proposed = proposal(
        {"targetField": "calc_field", "decisionType": "reuse", "mapping": {"mappingType": "direct", "sourceField": "A"}},
        {"targetField": "required_field", "decisionType": "missing"},
    )
    findings = review_proposal(
        proposed,
        {"targetFields": [{"name": "calc_field", "systemCalc": True}, {"name": "required_field", "required": True}], "dictionaries": []},
    )
    codes = {item["code"] for item in findings}
    assert "CALC_MAPPING" in codes
    assert "DECISION_MISSING" in codes
