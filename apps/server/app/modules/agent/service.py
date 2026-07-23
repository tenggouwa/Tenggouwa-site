"""agent 编排：多轮 tool-calling 循环 + 会话记忆 + 极简 compaction。

流程（见 docs/agent/agent-v2-design.md）：
- 载入会话历史（summary + 近若干轮）→ 拼成 messages；
- LLM(带 tools) 决定是否调 skill → 执行、把结果回填 → 循环直到不再调工具；
- 再流式生成最终答案；全程 append-only 落库，供多轮 resume。

消息装配铁律（§2 prompt cache）：system + tools 恒定在前、变动在后，保住前缀缓存。
终止 = 模型不再 tool_call（§5），MAX_STEPS / 预算只是兜底防死循环。
"""

import asyncio
import json
import logging
import os
import re
from collections.abc import AsyncIterator

from db.models import AgentMessageRow
from sqlalchemy.ext.asyncio import AsyncSession

from ..kb.provider import chat_llm
from ..mcp.manager import mcp_manager
from ..memory.store import MemoryStore, current_owner
from ..skills.permissions import is_parallel_safe, requires_approval
from ..skills.service import LOAD_TOOLS, skills_service
from ..skills.shell_exec import SHELL_SKILL, stream_exec
from ..skills.subagent import SUBAGENT_SKILL
from ..skills.subagent import stream_run as subagent_run
from .repository import AgentRepository

logger = logging.getLogger(__name__)

# 铁律：**SYSTEM 只讲策略（意图），永远不点名具体工具**——「什么时候用我」是各 skill 自己
# description 的职责（工具列表才是权威）。
# 为什么：以前这里点名了 11 个 skill，代价有三——① 每加一个 skill 就得改提示词，O(n) 膨胀还打断
# prompt cache；② description 形同虚设，被这里覆盖（kb_graph 上线后死活选不中，就是被这里那句
# 「先用 kb_search」盖掉的）；③ 提示词和注册表两处真相，迟早不同步。
# 加新 skill 的正确姿势：写好它的 description，注册即可，**不要回来改这里**。
SYSTEM = (
    "你是 tenggouwa 个人站点的 AI 助手，同时也是一个通用智能助手。\n"
    "- 涉及本站内容、作者本人、站内文章或项目时，**先查站内知识库再作答**，别凭印象答；"
    "用到某条资料就把它的来源用工具返回的 markdown 链接（[《标题》](链接)）在正文里回引出来，方便用户点回原文。\n"
    "- 知识库没有相关内容时，不要拒答——改用你自己的通用知识正常回答（必要时说明这不是来自本站资料）。\n"
    "- 需要外部实时信息就上网查；需要用户在若干明确选项间做选择或澄清关键信息时，抛带选项的问题让其点选"
    "（别用一长串文字罗列问题）；确实需要多步的任务先列出步骤计划。\n"
    "- 确实不知道再说不知道，不编造。用简体中文、简洁作答。"
)

# 私有模式（TOTP 解锁）追加的「做事」引导：作为**独立第二条 system 消息**追加，让上面的 SYSTEM
# 保持逐字不变——公开/私有共享同一段首块 prompt cache 前缀（§2）。私有会话恒带此块、公开恒不带，各自稳定。
PRIVATE_SYSTEM = (
    "【私有模式·已授权动手】你有一个 Linux 沙箱工作区（隔离、可写、默认断网），能读写文件、跑命令——"
    "你是个能真正干活的 agent，不是只会答话：\n"
    "- 需要多步就自己拆解、动手做到底再汇报结果，别把该做的事只列成建议丢回给用户。\n"
    "- 写类操作有副作用，会走审批或在自动模式下直接执行；失败了看报错自行修正重试。"
)

MAX_STEPS = 16  # 兜底防死循环，非常规上限（对齐 Codex/Claude「没有小硬上限」）
STEP_TOKEN_BUDGET = 40_000  # 本轮工具往返累计 token 预算，超了强制收尾
COMPACT_TOKENS = 24_000  # 载入历史超此阈值触发 compaction（deepseek-chat 64K 上下文，留足输出）
KEEP_TURNS = 3  # compaction 至少保留最近 N 个 user 轮原文（在其之前才摘要）
MAX_TOOL_RESULT_CHARS = 8_000  # 单个 tool 结果上限（对齐 Codex exec_command 截断）；超出尾部替换成提示

PLAN_SKILL = "update_plan"
ASK_SKILL = "ask_user"  # 抛选择题给用户，触发后结束本轮、等用户点选下一轮续上

# 深度思考模式用的推理模型（返回 reasoning_content 思维链，仍支持 tools）；env 可覆盖。
REASONER_MODEL = os.environ.get("KB_LLM_REASONER_MODEL") or "deepseek-reasoner"

# 反思模式（evaluator-optimizer）：答完让一个「评审者」按标准打分，不过关就把评审喂回、改写一版。
MAX_REFLECT_ROUNDS = 2  # 评审→改写最多几轮（防无限自我打磨 + 控成本）
EVAL_SYSTEM = (
    "你是严格的回答评审员。针对下面的【问题】和【待评审回答】，按四条审：准确、完整、直接回应问题、无编造。\n"
    "- 回答已经足够好、无需改进：**第一行只输出 PASS**，不要多说。\n"
    "- 否则：**第一行输出 REVISE**，随后用要点列出具体、可操作的改进项（指出缺了什么/哪里不对，别替它重写答案）。\n"
    "简体中文，简洁，对事不对人。"
)
REVISE_PROMPT = (
    "以下是对你上一条回答的评审意见。据此给出**改进后的完整回答**，只输出最终答案本身，"
    "不要复述评审、不要说“好的我来改”之类的话：\n\n{critique}"
)

MAX_SUBAGENTS_PER_TURN = 2  # 每个用户轮最多派几个子代理，防主代理狂开（实测会一口气开 4 个）
MAX_PARALLEL_TOOLS = 6  # 同一批 parallel-safe 工具的并发上限（对齐 Codex max_threads=6）
_SEARCH_SKILLS = {"web_search", "kb_search"}  # 按 query 去重的检索类工具，挡反复换措辞搜同一件事
MAX_SEARCHES_PER_TURN = 6  # 每轮不同检索的硬上限——归一化去重挡不住的换角度重搜，靠它兜底（实测能搜 13 次）

LEAK_TOKEN = "｜"  # ｜ DeepSeek tool-call 特殊 token 分隔符；正常文本/代码不会出现，用作泄漏起点


def _est_tokens(text: str) -> int:
    """粗估 token：中英文混排按 ~2 char/token（够 compaction 触发判断用，不求精确）。"""
    return len(text) // 2


def _truncate_tool_result(text: str) -> str:
    """截断过大的 tool 结果，防单个工具输出撑爆上下文。web_fetch 已自截，此为所有 skill 的兜底。"""
    if len(text) <= MAX_TOOL_RESULT_CHARS:
        return text
    return text[:MAX_TOOL_RESULT_CHARS] + f"\n…[输出过长，已截断，共 {len(text)} 字]"


_USAGE_KEYS = (
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "prompt_cache_hit_tokens",
    "prompt_cache_miss_tokens",
)


def _accumulate_usage(total: dict, u: dict) -> None:
    """把一次 stream_step 的 usage 累加进 total（一轮可能多次 LLM 调用）。"""
    for k in _USAGE_KEYS:
        if u.get(k) is not None:
            total[k] = total.get(k, 0) + u[k]


def _tc_name(tc: dict) -> str:
    return tc.get("function", {}).get("name", "")


def _tc_args(tc: dict) -> dict:
    try:
        return json.loads(tc.get("function", {}).get("arguments") or "{}")
    except json.JSONDecodeError:
        return {}


def _load_tools(args: dict, state: dict) -> str:
    """渐进披露：把选中的 MCP 工具 schema 加进本轮 tools（下一步重算 tools 时生效）。

    它本身不执行任何外部动作，只是「把说明书翻开」——所以无需审批；真调用时该工具自己的
    risk/auto 判定照常生效。
    """
    names = [str(n) for n in (args.get("names") or [])]
    known = {t["name"] for t in mcp_manager.catalog()}
    ok = sorted(set(names) & known)
    bad = sorted(set(names) - known)
    if not ok:
        return f"（没有这些工具：{'、'.join(bad) or '(空)'}。请从清单里挑。）"
    state["loaded"].update(ok)
    msg = f"（已加载：{'、'.join(ok)}，现在可以直接调用了。）"
    return msg + (f"（忽略未知：{'、'.join(bad)}）" if bad else "")


def _norm_query(q: str) -> str:
    """归一化检索 query：小写 + 去标点/空白，让「大模型省显存?」和「大模型 省显存」算同一个。

    \\W 在 str 上默认按 Unicode 判定，CJK 属 word 字符会保留，被删的只是标点和空白。
    """
    return re.sub(r"[\W_]+", "", q.lower())


def _turn_cap(name: str, args: dict, state: dict) -> str | None:
    """本轮收敛闸：返回非 None 表示这次工具调用被拦（子代理超限 / 检索重复或超量），用返回文案当结果、不真执行。"""
    if name == SUBAGENT_SKILL and state["subagents"] >= MAX_SUBAGENTS_PER_TURN:
        return f"（本轮子代理已达上限 {MAX_SUBAGENTS_PER_TURN} 个，别再派了，用现有信息直接作答。）"
    if name == SUBAGENT_SKILL:
        state["subagents"] += 1  # 计数后穿过下面的检索/浏览器判定（都不匹配）到末尾 return None
    if name in _SEARCH_SKILLS:
        q = _norm_query(str(args.get("query", "")))
        if not q:
            return None
        if q in state["searched"]:
            return "（这个查询本轮已经搜过了，别重复搜同一件事；用已有结果，或换一个实质不同的角度。）"
        if len(state["searched"]) >= MAX_SEARCHES_PER_TURN:
            return f"（本轮检索已达上限 {MAX_SEARCHES_PER_TURN} 次，别再搜了，用已经拿到的结果作答。）"
        state["searched"].add(q)
    if name == "browser" and str(args.get("action", "")).strip() == "navigate":
        # 同一 URL 本轮别反复 navigate：浏览器连续没响应通常是 Pi 网络在抖，重试同一页只是烧 token。
        url = str(args.get("url", "")).strip().lower()
        nav = state.setdefault("navigated", set())
        if url and url in nav:
            return (
                "（这个页面本轮已经用浏览器试过打开了。浏览器没响应多半是 Pi 出网在抖，别反复重试同一个——"
                "改用 web_fetch 抓这个 URL，或如实告诉用户浏览器暂时不可用。）"
            )
        if url:
            nav.add(url)
    return None


def _strip_leak(text: str) -> str:
    """砍掉 DeepSeek 泄漏的 tool-call 文本：首个 ｜ 及之后全丢，并去掉悬空的 '<'。

    统一流式循环里 tools 一直带着、走结构化 tool_calls，正常不会泄漏；此函数作为防御兜底。
    """
    idx = text.find(LEAK_TOKEN)
    if idx == -1:
        return text
    return text[:idx].rstrip("<").rstrip()


class AgentService:
    async def answer_stream(
        self,
        session: AsyncSession,
        q: str,
        *,
        session_id: str | None = None,
        approvals: dict | None = None,
        privileged: bool = False,
        auto_approve: bool = False,
        owner: str | None = None,
        deep: bool = False,
        reflect: bool = False,
    ) -> AsyncIterator[dict]:
        repo = AgentRepository(session)
        current_owner.set(owner)  # 让 remember/forget 拿到本轮 owner（skill handler 签名不带 owner，走 ContextVar）
        model = REASONER_MODEL if deep else None  # 深度思考 → 换推理模型（带 reasoning_content 思维链）
        existing = await repo.get_session(session_id) if session_id else None
        # owner 隔离：只续自己名下的会话；owner 不匹配（公开想读私有 / 跨 owner / 陈旧 id）→ 当作新会话，绝不泄漏历史。
        if existing is not None and existing.owner != owner:
            existing = None
        sid = existing.id if existing else await repo.create_session(q or "（审批）", owner=owner)
        yield {"type": "session", "session_id": sid}

        usage_total: dict = {}  # 累计本轮 token 用量，收尾发 event: usage
        # 本轮状态：收敛闸（子代理计数 + 检索去重）+ 渐进披露已加载的 MCP 工具名
        turn_state: dict = {"subagents": 0, "searched": set(), "loaded": set()}

        # 组装初始 messages + seq：C2 审批续跑（消费 pending、按 approvals 执行）vs 正常提问
        resume_asked = False  # 续跑批里若含 ask_user，执行完也要停（等用户点选），别继续生成
        if approvals is not None:
            if existing is None or not existing.pending:
                # 审批续跑但 pending 已消费/过期（重复提交、会话丢失）→ 不伪造空 user 轮，直接收尾
                yield {"type": "done"}
                return
            window = await repo.load_window(sid)
            seq = window.next_seq
            messages = self._seed(window, privileged)  # system + summary + 历史
            pending = existing.pending
            content, tool_calls = pending.get("content", ""), pending.get("tool_calls", [])
            messages.append({"role": "assistant", "content": content, "tool_calls": tool_calls})
            await repo.append(sid, seq, "assistant", content, tool_calls=tool_calls)
            seq += 1
            async for ev in self._execute_batch(
                session, repo, sid, seq, content, tool_calls, messages, approvals, privileged, turn_state
            ):
                yield ev
            seq += len(tool_calls)
            await repo.set_pending(sid, None)  # 消费完清 pending
            resume_asked = any(_tc_name(tc) == ASK_SKILL for tc in tool_calls)
        else:
            if not q.strip():
                yield {"type": "done"}  # 正常请求但 q 空 → 无可答，直接收尾（不落空 user 轮）
                return
            if existing is not None and existing.pending:
                await repo.set_pending(sid, None)  # 用户改问了别的 → 放弃上次待批
            await self._maybe_compact(repo, sid)
            await repo.touch(sid)  # 顶 updated_at → 「最近会话」列表按最后活跃排序
            window = await repo.load_window(sid)
            seq = window.next_seq
            await repo.append(sid, seq, "user", q)
            seq += 1
            messages = self._seed(window, privileged)
            await self._inject_memories(session, messages, privileged, owner, q)
            messages.append({"role": "user", "content": q})

        # 统一流式循环：每轮都带 tools 流式跑——正文实时显示、tool_calls 从结构化 delta 解析执行。
        # tools 每步重算：渐进披露下 load_tools 会把 MCP schema 加进来（原生工具恒定在前，核心前缀不受影响）
        budget_warned = False  # 预算提示只发一次，别每轮重复 append
        answered = resume_asked  # 本轮是否已产出最终答案（无 tool_calls）/ 以 ask_user 收尾 / 以审批收尾
        for _ in range(MAX_STEPS):
            if answered:  # resume 批已以 ask_user 收尾 → 跳过主循环，也别触发 M2 强制作答
                break
            content, tool_calls = "", []
            leaked = False  # 防御：见到 ｜ 泄漏 token 后，本轮后续 content 全部丢弃
            tools = skills_service.tools(privileged=privileged, loaded=turn_state["loaded"])
            async for ev in chat_llm.stream_step(messages, tools=tools, model=model):
                if ev["type"] == "reasoning":  # 深度思考的思维链：实时转发给前端单独展示，不进正文/不落库
                    yield {"type": "reasoning", "delta": ev["delta"]}
                elif ev["type"] == "content":
                    if leaked:
                        continue
                    piece = ev["delta"]
                    if LEAK_TOKEN in piece:  # 单 codepoint、不跨 delta，扫本段即可
                        piece = _strip_leak(piece)
                        leaked = True
                    if piece:
                        content += piece
                        yield {"type": "token", "delta": piece}
                elif ev["type"] == "tool_calls":
                    tool_calls = ev["tool_calls"]
                elif ev["type"] == "usage":
                    _accumulate_usage(usage_total, ev["usage"])

            if not tool_calls:
                # 无工具调用：本轮正文即最终答案（已流式发出）
                final_answer = content
                if reflect and content.strip() and q.strip():
                    # 反思：评审当前答案 → 不过关就改写；初稿+评审作为过程发给前端，落库存最终版
                    async for ev in self._reflect(messages, q, content):
                        if ev["type"] == "final":
                            final_answer = ev["content"]
                        elif ev["type"] == "usage":
                            _accumulate_usage(usage_total, ev["usage"])
                        else:
                            yield ev
                await repo.append(sid, seq, "assistant", final_answer)
                seq += 1
                answered = True
                break

            # C2 权限闸（仅私有通道、非 auto 模式）：这批含需批准的工具（write 原生 / 非 auto MCP）→ 暂停，
            # 存 pending（不落 assistant 以免孤儿 tool_call），发 approval 事件收尾，等用户批/拒后带 approvals 续跑。
            # auto 模式：用户在沙箱里选了自动执行 → 不暂停、直接跑（沙箱 bwrap 是安全边界）。
            # 公开通道压根不暴露高危工具，审批是私有通道概念；即便模型幻觉出高危名，invoke 也会拒执行。
            gate = privileged and not auto_approve
            need = [tc for tc in tool_calls if requires_approval(_tc_name(tc))] if gate else []
            if need:
                await repo.set_pending(sid, {"content": content, "tool_calls": tool_calls})
                yield {
                    "type": "approval",
                    "requests": [{"id": tc.get("id"), "name": _tc_name(tc), "args": _tc_args(tc)} for tc in need],
                }
                answered = True
                break

            # 全部无需批准 → 落 assistant + 执行这批
            messages.append({"role": "assistant", "content": content, "tool_calls": tool_calls})
            await repo.append(sid, seq, "assistant", content, tool_calls=tool_calls)
            seq += 1
            asked = any(_tc_name(tc) == ASK_SKILL for tc in tool_calls)
            async for ev in self._execute_batch(
                session, repo, sid, seq, content, tool_calls, messages, None, privileged, turn_state
            ):
                yield ev
            seq += len(tool_calls)

            if asked:  # 抛完选择题即停，等用户点选（此前已把所有 tool_call 配上结果）
                answered = True
                break
            if not budget_warned and sum(_est_tokens(m.get("content") or "") for m in messages) > STEP_TOKEN_BUDGET:
                messages.append({"role": "system", "content": "预算已尽，请基于现有信息直接作答，不要再调用工具。"})
                budget_warned = True

        # M2：MAX_STEPS 耗尽仍在调工具、始终没产出最终答案 —— 强制一次不带 tools 的收尾作答
        if not answered:
            final, leaked = "", False
            async for ev in chat_llm.stream_step(messages, tools=None):
                if ev["type"] == "content" and not leaked:
                    piece = ev["delta"]
                    if LEAK_TOKEN in piece:
                        piece = _strip_leak(piece)
                        leaked = True
                    if piece:
                        final += piece
                        yield {"type": "token", "delta": piece}
                elif ev["type"] == "usage":
                    _accumulate_usage(usage_total, ev["usage"])
            await repo.append(sid, seq, "assistant", final)
            seq += 1

        if usage_total:
            yield {"type": "usage", **usage_total}
        yield {"type": "done"}

    @staticmethod
    def _seed(window, privileged: bool = False) -> list[dict]:
        """初始 messages：system(+私有做事引导) + 早前摘要 + 历史窗口。"""
        messages: list[dict] = [{"role": "system", "content": SYSTEM}]
        if privileged:  # 私有通道追加做事引导（独立第二条，保 SYSTEM 首块缓存前缀不变）
            messages.append({"role": "system", "content": PRIVATE_SYSTEM})
        if window.summary:
            messages.append({"role": "system", "content": f"[早前对话摘要]\n{window.summary}"})
        messages.extend(window.messages)
        return messages

    @staticmethod
    async def _inject_memories(session, messages: list[dict], privileged: bool, owner: str | None, q: str) -> None:
        """私有会话：召回该 owner 与本轮问题相关的长期记忆，作为一条 system 备注注入。

        位置在稳定缓存前缀（SYSTEM+tools）之后、与 summary/历史同属动态区，不破 prompt cache。
        召回失败不该拖垮回答——记忆是加分项，吞掉异常继续。
        """
        if not (privileged and owner):
            return
        try:
            mems = await MemoryStore(session).recall(owner, q)
        except Exception:  # noqa: BLE001 —— 记忆召回失败只记日志，正常作答
            logger.exception("记忆召回失败，跳过注入")
            return
        if not mems:
            return
        note = (
            "[关于当前用户，你此前记住的]\n"
            + "\n".join(f"- {m}" for m in mems)
            + "\n（这些是你的长期记忆，仅供参考、可能过时；与当前对话冲突时以对话为准。）"
        )
        messages.append({"role": "system", "content": note})

    @staticmethod
    async def _evaluate(question: str, answer: str) -> dict:
        """评审者：给回答打分，返回 {verdict: pass|revise, text}。用非流式 complete 拿一整段评审。"""
        out = await chat_llm.complete(
            [
                {"role": "system", "content": EVAL_SYSTEM},
                {"role": "user", "content": f"【问题】\n{question}\n\n【待评审回答】\n{answer}"},
            ],
            tools=None,
        )
        text = (out.get("content") or "").strip()
        verdict = "pass" if text.lstrip().upper().startswith("PASS") else "revise"
        return {"verdict": verdict, "text": text}

    async def _reflect(self, messages: list[dict], question: str, draft: str) -> AsyncIterator[dict]:
        """evaluator-optimizer 循环：评审当前答案 → 不过关就把评审喂回改写一版，最多 MAX_REFLECT_ROUNDS 轮。

        yield：reflect（每轮评审）/ token（改写的流式正文）/ usage / 最后一条 final（最终答案，供落库）。
        改写用不带 tools 的纯文本精炼——反思是打磨措辞与完整性，不是再去调工具。
        """
        answer = draft
        for i in range(MAX_REFLECT_ROUNDS):
            critique = await self._evaluate(question, answer)
            yield {"type": "reflect", "round": i + 1, "verdict": critique["verdict"], "critique": critique["text"]}
            if critique["verdict"] == "pass":
                break
            revise_messages = messages + [
                {"role": "assistant", "content": answer},
                {"role": "user", "content": REVISE_PROMPT.format(critique=critique["text"])},
            ]
            revised, leaked = "", False
            async for ev in chat_llm.stream_step(revise_messages, tools=None):
                if ev["type"] == "content" and not leaked:
                    piece = ev["delta"]
                    if LEAK_TOKEN in piece:
                        piece = _strip_leak(piece)
                        leaked = True
                    if piece:
                        revised += piece
                        yield {"type": "token", "delta": piece}
                elif ev["type"] == "usage":
                    yield ev
            answer = revised
        yield {"type": "final", "content": answer}

    async def run_proactive(self, session: AsyncSession, owner: str, prompt: str, title: str) -> int:
        """主动/定时：让 agent 自主完成一个目标，产出投进 owner 收件箱——「从被动应答到主动行动」的落点。

        由调度器（或手动触发）调用，没有现场用户。`privileged=False`：自主运行只用只读工具，
        绝不在无人看管下做写操作。收集流式正文当作产出。
        """
        answer = ""
        async for ev in self.answer_stream(session, prompt, privileged=False, owner=owner):
            if ev.get("type") == "token":
                answer += ev.get("delta") or ""
        answer = answer.strip() or "（本次没有产出内容。）"
        return await AgentRepository(session).add_inbox(owner, title, answer)

    async def _exec_one(self, session, name, args, tid, approvals, privileged, turn_state, emit) -> str:
        """跑一个 tool_call 拿结果字符串；流式增量经 emit 回调发出（并发时由队列汇总回主流）。

        任何异常都收敛成结果文案——单个 skill 炸了不该毒化会话，更不能带崩同批并发的兄弟任务。
        """
        if name == LOAD_TOOLS:
            return _load_tools(args, turn_state)
        capped = _turn_cap(name, args, turn_state)  # 收敛闸：超限/重复检索直接给提示、不真执行
        if capped is not None:
            return capped
        if approvals is not None and requires_approval(name) and not approvals.get(tid, False):
            return "（用户拒绝执行此操作。）"
        streamed = await self._exec_streaming(session, name, args, tid, privileged, emit)
        if streamed is not None:
            return streamed
        try:
            return await skills_service.invoke(session, name, args, privileged=privileged)
        except Exception as e:  # noqa: BLE001 —— skill 失败不该毒化会话
            logger.exception("skill %s failed", name)
            return f"（skill {name} 执行失败：{e}）"

    async def _exec_streaming(self, session, name, args, tid, privileged, emit) -> str | None:
        """边跑边出的两个特判（shell / 子代理）：返回结果字符串；不是这两个 → None，交回普通 invoke。"""
        if name == SHELL_SKILL and privileged:
            # shell 输出流式：chunk 实时发前端做终端实时输出，final 作工具结果回灌 LLM
            result = "（无输出）"
            try:
                async for ev in stream_exec(args):
                    if "chunk" in ev:
                        emit({"type": "tool_output", "id": tid, "name": name, "delta": ev["chunk"]})
                    else:
                        result = ev["result"]
            except Exception as e:  # noqa: BLE001 —— skill 失败不该毒化会话
                logger.exception("shell_exec stream failed")
                result = f"（shell_exec 执行失败：{e}）"
            return result
        if name == SUBAGENT_SKILL:
            # 子代理：把每步调的工具当 tool_output 流给前端（复用 shell 的实时框），结论回灌 LLM
            result = "（子代理无输出）"
            try:
                async for ev in subagent_run(session, args.get("task", "")):
                    if "progress" in ev:
                        emit({"type": "tool_output", "id": tid, "name": name, "delta": ev["progress"] + "\n"})
                    else:
                        result = ev["result"]
            except Exception as e:  # noqa: BLE001 —— skill 失败不该毒化会话
                logger.exception("run_subagent failed")
                result = f"（子代理执行失败：{e}）"
            return result
        return None

    async def _execute_batch(
        self, session, repo, sid, start_seq, content, tool_calls, messages, approvals, privileged, turn_state
    ):
        """执行一批 tool_calls：发 plan/ask/tool 事件、按 approvals 决定执行/拒绝、落库、回填 messages。

        approvals=None：这批全部无需审批（pause 已在上游拦过），全执行。
        approvals=dict：resume 路径，被拒的需批准工具回"用户拒绝"，其余执行。
        privileged：透传给 skills_service.invoke，公开通道拒执行 write/MCP 工具（纵深兜底）。
        turn_state：本轮收敛闸（子代理计数 + 检索去重），挡主代理狂开子代理 / 反复搜同一件事。

        **并发（E2）**：整批都是 parallel-safe（原生 readonly/控制类）时并发跑，上限 MAX_PARALLEL_TOOLS；
        含 write 工具则退回串行（limit=1）——见 is_parallel_safe。两条路共用同一套队列汇流，
        串行只是 limit=1 的特例，流式事件实时性不变。
        每个 tool_call → 恰好一条 tool 结果、按原下标顺序落库（保 H1 配对 + seq 对齐）。
        """
        calls = [(_tc_name(tc), _tc_args(tc), tc.get("id")) for tc in tool_calls]
        # 先按序把「要调什么」announce 出去：并发时用户能一次看到全部工具行，输出随后各自流回
        for name, args, tid in calls:
            if name == PLAN_SKILL:
                yield {"type": "plan", "plan": args.get("plan", [])}
            elif name == ASK_SKILL:
                yield {"type": "ask", "intro": content, "questions": args.get("questions", [])}
            else:
                yield {"type": "tool", "name": name, "args": args, "id": tid}

        limit = MAX_PARALLEL_TOOLS if len(calls) > 1 and all(is_parallel_safe(n) for n, _, _ in calls) else 1
        queue: asyncio.Queue = asyncio.Queue()
        results: dict[int, str] = {}
        sem = asyncio.Semaphore(limit)

        async def _one(i: int, name: str, args: dict, tid) -> None:
            async with sem:
                results[i] = await self._exec_one(
                    session, name, args, tid, approvals, privileged, turn_state, queue.put_nowait
                )

        runner = asyncio.gather(*(_one(i, n, a, t) for i, (n, a, t) in enumerate(calls)))
        try:
            while True:  # 汇流：任一子任务推来的流式事件实时转发，直到全部跑完
                getter = asyncio.ensure_future(queue.get())
                done, _ = await asyncio.wait({getter, runner}, return_when=asyncio.FIRST_COMPLETED)
                if getter in done:
                    yield getter.result()
                else:
                    getter.cancel()
                if runner.done():
                    while not queue.empty():  # 收尾把残余事件吐干净
                        yield queue.get_nowait()
                    break
            await runner  # 传播 gather 自身异常（单 skill 异常已在 _exec_one 内收敛）
        finally:
            if not runner.done():
                runner.cancel()

        # 按原顺序回填：每个 tool_call 恰好一条 tool 结果（H1），seq 与下标对齐
        for i, (_n, _a, tid) in enumerate(calls):
            result = _truncate_tool_result(results.get(i, "（无结果）"))
            messages.append({"role": "tool", "tool_call_id": tid, "content": result})
            await repo.append(sid, start_seq + i, "tool", result, tool_call_id=tid)

    async def _maybe_compact(self, repo: AgentRepository, sid: str) -> None:
        """历史超阈值时，把最近 KEEP_TURNS 个 user 轮之前的消息摘要成一条 note（§4）。

        只做 Claude 五层 compaction 的最顶层：不做 budget/snip/microcompact/collapse。
        边界钉在 user 消息上，保证 reload 窗口不以孤儿 tool 消息开头（否则 API 报错）。
        """
        row = await repo.get_session(sid)
        if row is None:
            return
        rows = await repo.rows_after(sid, row.summarized_upto_seq)
        if sum(_est_tokens(r.content) for r in rows) <= COMPACT_TOKENS:
            return
        user_seqs = [r.seq for r in rows if r.role == "user"]
        if len(user_seqs) <= KEEP_TURNS:
            return  # 轮数太少，切了不安全，跳过
        boundary = user_seqs[-KEEP_TURNS]  # 保留从这个 user 轮起的原文
        drop = [r for r in rows if r.seq < boundary]
        if not drop:
            return
        summary = await self._summarize(row.summary, drop)
        await repo.save_summary(sid, summary, boundary - 1)
        logger.info("agent compact %s: 摘要掉 %d 条，边界 seq=%d", sid, len(drop), boundary)

    @staticmethod
    async def _summarize(prev_summary: str | None, rows: list[AgentMessageRow]) -> str:
        transcript = "\n".join(f"{r.role}: {r.content}" for r in rows if r.content)
        head = f"[已有摘要]\n{prev_summary}\n\n" if prev_summary else ""
        prompt = (
            "把以下对话浓缩成不超过 500 字的要点，保留用户关注的实体、结论、待办；"
            f"若已有摘要，合并去重。\n\n{head}[新对话]\n{transcript}"
        )
        msg = await chat_llm.complete([{"role": "user", "content": prompt}], max_tokens=600, temperature=0.2)
        return (msg.get("content") or prev_summary or "").strip()


agent_service = AgentService()
