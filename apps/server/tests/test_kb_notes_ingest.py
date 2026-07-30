"""Notes source only reads an explicitly configured Markdown directory."""

from modules.kb.ingest.notes import NotesIngester


async def test_notes_ingester_is_disabled_without_directory(monkeypatch):
    monkeypatch.delenv("KB_NOTES_DIR", raising=False)
    assert await NotesIngester().fetch(None) == []


async def test_notes_ingester_reads_markdown_with_safe_relative_ids(monkeypatch, tmp_path):
    notes = tmp_path / "notes"
    notes.mkdir()
    (notes / "rag.md").write_text("---\ntitle: RAG 笔记\n---\n\n检索增强生成。", encoding="utf-8")
    (notes / "skip.md").symlink_to(notes / "rag.md")
    monkeypatch.setenv("KB_NOTES_DIR", str(notes))

    docs = await NotesIngester().fetch(None)
    assert docs == [
        {
            "external_id": "rag",
            "title": "RAG 笔记",
            "url": None,
            "raw_md": "---\ntitle: RAG 笔记\n---\n\n检索增强生成。",
            "meta": {"path": "rag.md"},
        }
    ]
