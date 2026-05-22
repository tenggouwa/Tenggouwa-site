---
slug: tool-use
title: Tool Use / Function Calling：模型怎么学会"打电话给真实世界"
summary: AI 系列第 14 篇。RAG 让模型能查资料，tool use 让模型能**做事**——查天气、订机票、跑 SQL、发邮件。这一篇讲 function calling 的协议层、训练层、和工程层，并解释为什么 2024 之后 tool use 是从"玩具"变成"基础设施"的拐点。
tags: [ai, tool-use, function-calling, agent, ai-series]
published_at: 2026-06-04
---

> AI 系列第 14 篇。上一篇给模型外挂了"知识硬盘"。这一篇给它装"手脚"。

## 0. 从"会说话"到"会做事"

ChatGPT 刚出时有个尴尬：

```
你: "明天北京天气怎么样？"
ChatGPT: "对不起，我无法访问实时数据。"

你: "帮我订一张明早的高铁。"
ChatGPT: "对不起，我无法操作外部系统。"
```

这就是纯 LLM 的天花板——它知道很多，但什么都做不了。

**Tool use**（也叫 function calling）解决这事。它让模型在需要时**调用外部函数**：查天气、跑 SQL、发邮件、点开 URL、执行 shell 命令——任何代码能做的事。

```
你: "明天北京天气怎么样？"
LLM: [调用 get_weather(city="北京", date="2026-05-23")]
工具返回: {"temp": 22, "condition": "晴"}
LLM: "明天北京晴天，22 度。"
```

这看似简单的一来一回，背后是 LLM 应用范式的根本转变。

---

## 1. 协议层：模型怎么"说"它要调用工具？

LLM 输出是文本。怎么让它表达"我要调函数"这件事？

### 早期方案：纯 prompt（ReAct, 2022）

```
prompt:
  你可以调用以下工具：
  - get_weather(city, date)
  - send_email(to, subject, body)
  
  使用格式：
  Thought: [你的想法]
  Action: [函数名]
  Action Input: [参数 JSON]

  问题: 明天北京天气怎么样？
↓
模型输出:
  Thought: 我需要查询天气。
  Action: get_weather
  Action Input: {"city": "北京", "date": "2026-05-23"}
```

应用层解析输出 → 执行函数 → 把结果塞回 prompt → 模型继续。

这就是 **ReAct（Reasoning + Acting）**——2022 年 Google 论文提出，今天还是 agent 的基础范式。

**缺陷**：纯 prompt 协议很脆弱。模型偶尔会写错格式、把 reasoning 混进 action、加多余的解释。

### 2023+：原生 function calling API

**2023 年 6 月**，OpenAI 推出 `functions` 参数（后改名 `tools`）。模型经过专门训练，懂得用一种**结构化输出**表达 tool call。

```python
tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get current weather for a city",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {"type": "string"},
                "date":  {"type": "string", "format": "date"}
            },
            "required": ["city"]
        }
    }
}]

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "明天北京天气怎么样？"}],
    tools=tools
)

# 模型不返回文本，而是返回结构化的 tool_calls:
response.choices[0].message.tool_calls
# → [{"name": "get_weather", "arguments": '{"city": "北京", "date": "2026-05-23"}'}]
```

应用代码执行 `get_weather`，把结果塞回对话：

```python
messages.append({
    "role": "tool",
    "tool_call_id": call_id,
    "content": '{"temp": 22, "condition": "晴"}'
})

# 再调一次 LLM，让它根据 tool 结果给出最终回答
final = client.chat.completions.create(model="gpt-4o", messages=messages, tools=tools)
# → "明天北京晴天，22 度。"
```

Claude、Gemini、Llama 3+、Qwen 2+ 都支持类似 API。

---

## 2. 训练层：模型怎么"学会"调用工具？

function calling 不是 prompt trick，是**训练时塞进去的能力**。

### 训练数据

OpenAI / Anthropic 在 SFT 和 RLHF 阶段加入大量这种数据：

```
[
  {"role": "user", "content": "明天北京天气？"},
  {"role": "assistant", "tool_calls": [{"name": "get_weather", "arguments": {...}}]},
  {"role": "tool", "content": "{\"temp\": 22}"},
  {"role": "assistant", "content": "明天 22 度。"}
]
```

成千上万条这种对话喂进去，模型学会：

1. **什么时候**该调工具（不知道答案 / 需要实时数据 / 需要执行操作）
2. **调哪个**工具
3. **传什么参数**
4. 拿到结果后**怎么续上**

### Constrained Decoding 保证格式

模型生成 tool_calls 时，后端用 constrained decoding 强制输出符合 schema。这就是为什么现代 function calling 几乎不会出格式错误。

---

## 3. 工程层：从"能调工具"到"调好工具"

API 层简单，工程层有一堆坑。

### 坑 1：工具描述写不好

```
❌ 模糊: "get_weather: 获取天气"
✅ 具体: "get_weather: 返回指定城市在指定日期的天气预报。
         city 必须用中文城市名，date 用 ISO 格式 (YYYY-MM-DD)。
         只能查 7 天内的预报。"
```

模型怎么知道什么时候调工具？看 description。description 越精确，调用越准。

### 坑 2：参数 schema 不严

```
❌ "city": {"type": "string"}
✅ "city": {
      "type": "string",
      "description": "中国城市的中文名，如 '北京'、'上海'。不接受拼音或英文。",
      "examples": ["北京", "上海", "广州"]
   }
```

模型在不确定时会"猜"。给约束 + 例子降低猜错率。

### 坑 3：工具数量太多

如果你给 LLM 100 个工具，它的选择质量会下降。原因：

1. token 占用太多（每个 schema 都要塞 prompt）
2. 注意力分散
3. 名字相近的工具容易混

**经验法则**：单次调用不超过 20 个工具。需要更多时用**两层路由**——先让一个 LLM 选工具类别，再让另一个调具体工具。

### 坑 4：并行 vs 串行调用

GPT-4o 起支持 parallel tool calls：

```python
# 模型一次返回多个 tool_calls
response.tool_calls = [
    {"name": "get_weather", "arguments": {"city": "北京"}},
    {"name": "get_weather", "arguments": {"city": "上海"}},
    {"name": "get_stock", "arguments": {"ticker": "AAPL"}}
]
```

应用代码可以**并行**执行这三个，省时间。但如果工具之间有依赖（call A 的结果要传给 B），还是要串行。模型一般能识别依赖关系。

### 坑 5：错误处理

工具失败了怎么办？

```python
messages.append({
    "role": "tool",
    "content": '{"error": "city not found", "message": "未找到城市 '火星'"}'
})
```

把错误结构化返回。**模型看到 error 后通常会自己解释**，或者尝试纠正（"对不起，'火星' 不是地球上的城市，您是要查哪里？"）。

### 坑 6：成本爆炸

每次 tool call 都是一次完整的 LLM 调用 + tool 执行 + 又一次 LLM 调用。

```
single tool call: 2× LLM call + 1× tool
multi-step: 5-10× LLM calls
```

复杂任务可能跑十几个 LLM call，账单飞起。**用便宜模型做工具选择**（Haiku、4o-mini），**用贵模型做最终回答**。

---

## 4. 工具设计的哲学：让 LLM 觉得"自然"

LLM 用工具像人用手机——**接口越像人能直觉理解的，用得越对**。

### 原则 1：单一职责

```
❌ "manage_user(action='create' | 'update' | 'delete' | 'list', ...)"
✅ "create_user(...)" / "update_user(...)" / "delete_user(...)" / "list_users(...)"
```

LLM 看到具体函数名比看 action 参数好理解。

### 原则 2：能用自然语言就别用 ID

```
❌ "delete_user(user_id=12345)"  ← 模型怎么知道这个 ID？
✅ "delete_user_by_email(email='foo@bar.com')"
```

如果业务允许，让 LLM 直接传自然语言可理解的标识。

### 原则 3：错误信息要"指导性"

```
❌ "Error: invalid input"
✅ "Error: city must be a Chinese city name like '北京'. Got '火星'.
    Hint: check the spelling or try a different city."
```

错误是 LLM 的反馈信号。给得清楚它就能自我纠正。

### 原则 4：拒绝 vs 等待

某些操作有副作用（删除数据、发邮件、扣款）。两种处理方式：

```
方式 A: 直接执行 → LLM 误调就完蛋
方式 B: 返回 "需要人类确认" → 应用层显示确认按钮 → 人确认后再执行
```

生产系统几乎都选 B（"human in the loop"）。把 LLM 的输出当**建议**，不是**指令**。

---

## 5. 几个真实生产场景

### 场景 1：搜索 + 总结

```
工具: web_search(query)
LLM 流程:
  1. 看 query 决定要搜什么
  2. 调 web_search
  3. 读结果
  4. 综合总结
```

这就是 ChatGPT browsing、Perplexity 的核心。

### 场景 2：代码执行（Code Interpreter）

```
工具: run_python(code: str) → returns stdout + plots
LLM 流程:
  1. 用户说"画一下这份 CSV 的趋势"
  2. LLM 生成 pandas + matplotlib 代码
  3. 调 run_python
  4. 看 stdout / 图片
  5. 给用户解释
```

这是 GPT-4 Code Interpreter 的核心机制。可以做数据分析、画图、解方程。

### 场景 3：Computer use（2024+）

Anthropic 在 Claude 3.5 推出 **computer use**：

```
工具: 
  - screenshot() → returns image
  - click(x, y)
  - type_text(text)
  - scroll(direction)

LLM 流程:
  1. 截屏
  2. 看截屏决定下一步操作
  3. 执行操作
  4. 再截屏
  5. 循环
```

这让 LLM **像人一样操作电脑**——浏览网页、填表单、用 Excel。是 agent 的一种极端形式。

### 场景 4：数据库查询

```
工具: run_sql(query: str)
LLM 流程:
  1. 用户问"上个月销售最好的产品"
  2. LLM 生成 SQL
  3. 执行
  4. 用结果回答
```

这就是 Text-to-SQL 的现代实现，比传统 ML 模型准确度高出一截。

---

## 6. Tool Use 为什么是 2024 的拐点？

2023 function calling 出来时，大家觉得是个 feature。2024 之后大家意识到：**tool use 是 LLM 应用从"chatbot"到"agent"的分水岭**。

### 原因 1：把 LLM 从"信息生成器"变成"行动决策者"

聊天框 → 自动化助手。

### 原因 2：让 LLM 突破训练数据边界

不用重训，每加一个工具就增加一类能力。

### 原因 3：可组合

工具能套工具：搜索 → 总结 → 翻译 → 写邮件。任意串。

### 原因 4：可监控

每个 tool call 都是可观测、可审计的事件。生产环境里你能看见模型"干了什么"。

> 一句你可以拿去吹的话：
> **没有 tool use 的 LLM 只能"说"，有了 tool use 才能"做"。从 chatbot 到 agent 的最重要的一道分界，不是 reasoning，是 tool use。**

---

## 7. 给你的小作业

1. **设计 3 个工具的 schema：搜索网页、发邮件、查数据库。要符合"单一职责"和"自然参数"原则。**
2. **解释 ReAct 范式和原生 function calling API 的区别。**
3. **想一个"工具必须串行"和"工具可以并行"的实际场景，各举一例。**

> **下一篇钩子**：tool use 让模型能"调一次工具"。
> 但更进一步——让模型**自主规划一个任务，分多步执行，遇到错误自我纠正，直到完成**——这就是 **Agent**。
> 下一篇我们看 ReAct → Plan-and-Execute → Tree of Thoughts 等几种 agent 范式，
> 以及 "agent" 这个词为什么是 2025-2026 年最被滥用的词。
