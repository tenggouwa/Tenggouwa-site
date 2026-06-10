"""search/service.py 的 snippet 高亮 / 截断 / 取源逻辑测试（纯字符串处理）。"""

from modules.search.service import SearchService, _highlight, _truncate


class TestTruncate:
    def test_short_unchanged(self):
        assert _truncate("hello", 10) == "hello"

    def test_strips_and_flattens_newlines(self):
        assert _truncate("  a\nb  ", 10) == "a b"

    def test_long_gets_ellipsis(self):
        out = _truncate("x" * 20, 10)
        assert out == "x" * 9 + "…"
        assert len(out) == 10

    def test_none_becomes_empty(self):
        assert _truncate(None, 5) == ""


class TestHighlight:
    def test_empty_text(self):
        assert _highlight("", "q") == ""

    def test_wraps_match(self):
        out = _highlight("Hello World", "world")
        assert "<mark>World</mark>" in out  # 保留原文大小写
        assert out.startswith("Hello")

    def test_case_insensitive(self):
        out = _highlight("hello there", "HELLO")
        assert "<mark>hello</mark>" in out

    def test_no_match_no_mark(self):
        out = _highlight("just some text", "zzz")
        assert "<mark>" not in out
        assert out == "just some text"

    def test_centers_window_with_ellipsis(self):
        text = "a" * 100 + "NEEDLE" + "b" * 100
        out = _highlight(text, "NEEDLE")
        assert "<mark>NEEDLE</mark>" in out
        assert out.startswith("…")
        assert out.endswith("…")

    def test_flattens_newlines(self):
        out = _highlight("line1\nline2", "line2")
        assert "<mark>line2</mark>" in out


class TestPickSnippetSource:
    pick = staticmethod(SearchService._pick_snippet_source)

    def test_prefers_summary_when_it_matches(self):
        assert self.pick("foo", "title", "has foo here", "content") == "has foo here"

    def test_falls_through_to_content(self):
        assert self.pick("foo", "title", "nope", "foo inside") == "foo inside"

    def test_falls_through_to_title(self):
        assert self.pick("foo", "title foo", "nope", "nope") == "title foo"

    def test_case_insensitive(self):
        assert self.pick("FOO", "title", "lower foo", "content") == "lower foo"

    def test_no_match_defaults_to_summary(self):
        assert self.pick("zzz", "title", "summary", "content") == "summary"

    def test_no_match_empty_summary_defaults_to_content(self):
        assert self.pick("zzz", "title", "", "content") == "content"
