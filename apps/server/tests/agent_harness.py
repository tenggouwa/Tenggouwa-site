"""agent 循环层测试 harness（第 2 层）：脚本化 LLM + 内存 repo + 不变量断言。

不联网、确定性、毫秒级。把 `answer_stream` 的模型行为用脚本喂进去，断言 SSE 事件 /
消息配对 / 落库 / 边界。新场景照着 test_agent_loop.py 加即可。
"""

from types import SimpleNamespace

from modules.agent.repository import AgentWindow


class ScriptedLLM:
    """假 chat_llm：stream_step 按 rounds 逐轮 yield 事件；complete 返回固定摘要。

    rounds[i] 是一个事件列表，如：
        [{"type": "content", "delta": "..."},
         {"type": "tool_calls", "tool_calls": [{"id","type","function":{"name","arguments"}}]}]
    调用次数超过 rounds 长度时钳制到最后一轮（配合 MAX_STEPS 兜底场景）。
    """

    def __init__(self, rounds: list[list[dict]]) -> None:
        self.rounds = list(rounds)
        self.calls = 0

    async def stream_step(self, messages, *, tools=None, **_kw):
        idx = min(self.calls, len(self.rounds) - 1)
        self.calls += 1
        for ev in self.rounds[idx]:
            yield ev

    async def complete(self, messages, *, tools=None, tool_choice="auto", max_tokens=1024, temperature=0.3):
        return {"content": "（摘要）", "tool_calls": []}


class FakeRepo:
    """内存 repo：记录每次 append，可注入初始 window / rows_after / session。"""

    def __init__(self, *, window=None, rows_after=None, session=None) -> None:
        self.rows: list[SimpleNamespace] = []  # 记录的 append
        self.saved = None  # save_summary 的产物
        self._window = window or AgentWindow(None, [], 1, 0)
        self._rows_after = rows_after or []
        self._session = session or SimpleNamespace(id="s", summary=None, summarized_upto_seq=0)

    async def create_session(self, title):
        return "s"

    async def get_session(self, sid):
        return self._session if sid else None

    async def load_window(self, sid):
        return self._window

    async def append(self, sid, seq, role, content, *, tool_calls=None, tool_call_id=None):
        self.rows.append(
            SimpleNamespace(seq=seq, role=role, content=content, tool_calls=tool_calls, tool_call_id=tool_call_id)
        )

    async def rows_after(self, sid, seq_excl):
        return self._rows_after

    async def save_summary(self, sid, summary, upto):
        self.saved = (summary, upto)


async def _default_invoke(_session, name, _args):
    return f"[{name} 结果]"


async def run_agent(
    monkeypatch,
    rounds,
    *,
    invoke=None,
    tools=None,
    window=None,
    rows_after=None,
    session=None,
    q="问题",
    session_id=None,
):
    """跑一次 answer_stream，返回 (events, repo)。mock 掉 LLM / skills / repo，全程不联网。

    传 session_id 走 resume 分支（service.py 会先 get_session 取已存在会话、load 注入的 window）。
    """
    import modules.agent.service as svc

    repo = FakeRepo(window=window, rows_after=rows_after, session=session)
    monkeypatch.setattr(svc, "chat_llm", ScriptedLLM(rounds))
    monkeypatch.setattr(svc, "AgentRepository", lambda _session: repo)
    monkeypatch.setattr(svc.skills_service, "tools", lambda: tools or [])
    monkeypatch.setattr(svc.skills_service, "invoke", invoke or _default_invoke)

    events = [ev async for ev in svc.agent_service.answer_stream(None, q, session_id=session_id)]
    return events, repo


async def run_agent_live(monkeypatch, q, *, invoke):
    """live 冒烟用：真 chat_llm（跑真 DeepSeek）+ 内存 repo + 真 tools，只替换 invoke（免 DB）。"""
    import modules.agent.service as svc

    repo = FakeRepo()
    monkeypatch.setattr(svc, "AgentRepository", lambda _session: repo)
    monkeypatch.setattr(svc.skills_service, "invoke", invoke)  # kb_search 用 canned、其余真跑
    events = [ev async for ev in svc.agent_service.answer_stream(None, q, session_id=None)]
    return events, repo


# ---------- 事件抽取 ----------


def tokens(events) -> str:
    return "".join(e["delta"] for e in events if e["type"] == "token")


def of_type(events, typ) -> list:
    return [e for e in events if e["type"] == typ]


# ---------- 不变量断言（每个场景都该调）----------


def assert_no_leak(text: str) -> None:
    assert "｜" not in text, f"泄漏 token ｜ 出现在答案里: {text!r}"


def assert_paired(rows) -> None:
    """每个带 tool_calls 的 assistant，后面必须紧跟它全部 tool_call 的 tool 结果。

    否则该会话 resume 时 DeepSeek 会 400（H1 那类会话毒化）。
    """
    i = 0
    while i < len(rows):
        r = rows[i]
        if r.role == "assistant" and r.tool_calls:
            n = len(r.tool_calls)
            following = rows[i + 1 : i + 1 + n]
            assert len(following) == n and all(x.role == "tool" for x in following), (
                f"assistant(tool_calls={n}) 后未紧跟 {n} 条配对 tool 结果，seq={r.seq}"
            )
            i += 1 + n
        else:
            i += 1


def tool_call(name: str, args_json: str, tid: str = "c1") -> dict:
    """构造一个 stream_step 累积后的 tool_call 结构。"""
    return {"id": tid, "type": "function", "function": {"name": name, "arguments": args_json}}
