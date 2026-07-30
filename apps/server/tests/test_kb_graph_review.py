"""图谱人工审核：提案不可直接改变公开图；批准后才实际生效。"""

from types import SimpleNamespace

import pytest
from modules.kb.repository import KBRepository


class _Session:
    def __init__(self, *rows):
        self.rows = list(rows)
        self.added = []

    async def get(self, _model, _id):
        return self.rows.pop(0) if self.rows else None

    def add(self, row):
        self.added.append(row)

    async def flush(self):
        pass


async def test_create_rename_review_keeps_entity_unchanged_until_approval():
    entity = SimpleNamespace(id=7, name="RAG")
    session = _Session(entity)
    review = await KBRepository(session).create_graph_review(
        target_kind="entity",
        target_id=7,
        action="rename_entity",
        payload={"name": "Retrieval-Augmented Generation"},
        note="use canonical name",
        requested_by="admin",
    )
    assert entity.name == "RAG"
    assert review.status == "pending"
    assert review.payload["name"] == "Retrieval-Augmented Generation"


async def test_approve_rename_review_applies_change_and_audits_actor():
    review = SimpleNamespace(
        status="pending",
        action="rename_entity",
        target_id=7,
        payload={"name": " Retrieval-Augmented Generation "},
        resolved_by=None,
        resolved_at=None,
    )
    entity = SimpleNamespace(id=7, name="RAG")
    session = _Session(review, entity)
    result = await KBRepository(session).resolve_graph_review(3, decision="approve", resolved_by="alice")
    assert result.status == "applied"
    assert entity.name == "Retrieval-Augmented Generation"
    assert result.resolved_by == "alice" and result.resolved_at is not None


async def test_approve_relation_review_disables_instead_of_deleting():
    review = SimpleNamespace(
        status="pending",
        action="disable_relation",
        target_id=8,
        payload={},
        resolved_by=None,
        resolved_at=None,
    )
    relation = SimpleNamespace(id=8, disabled=False)
    session = _Session(review, relation)
    result = await KBRepository(session).resolve_graph_review(4, decision="approve", resolved_by="alice")
    assert result.status == "applied"
    assert relation.disabled is True


async def test_reject_does_not_change_target():
    review = SimpleNamespace(
        status="pending",
        action="disable_relation",
        target_id=8,
        payload={},
        resolved_by=None,
        resolved_at=None,
    )
    session = _Session(review)
    result = await KBRepository(session).resolve_graph_review(4, decision="reject", resolved_by="alice")
    assert result.status == "rejected"
    assert result.resolved_by == "alice"


async def test_invalid_review_action_is_rejected():
    with pytest.raises(ValueError, match="不支持"):
        await KBRepository(_Session()).create_graph_review(
            target_kind="entity", target_id=1, action="unknown", payload={}, note="", requested_by="admin"
        )
