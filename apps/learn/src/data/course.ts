import { chapters } from './chapters.generated';

export type LabKind =
  | 'attention'
  | 'cache'
  | 'roofline'
  | 'scheduler'
  | 'speculation'
  | 'amdahl';
export interface Lesson {
  id: string;
  stage: number;
  prerequisites: string[];
  title: string;
  subtitle: string;
  minutes: number;
  outcome: string;
  body: string;
  code?: string;
  experiment: string[];
  acceptance: string[];
  quiz: {
    question: string;
    options: string[];
    answer: number;
    explanation: string;
    section: string;
  };
  sources: string[];
  lab?: LabKind;
  download?: string;
}
export const sources: Record<
  string,
  { title: string; url: string; note: string }
> = {
  cs336: {
    title: 'Stanford CS336 · Language Modeling from Scratch',
    url: 'https://cs336.stanford.edu/spring2025/',
    note: '2025 存档课程；模型实现与 Systems 作业',
  },
  architecture: {
    title: 'vLLM · Architecture Overview',
    url: 'https://docs.vllm.ai/en/latest/design/arch_overview/',
    note: '动态文档；阅读时匹配自己的引擎 commit',
  },
  v1: {
    title: 'vLLM · V1 Guide',
    url: 'https://github.com/vllm-project/vllm/blob/main/docs/usage/v1_guide.md',
    note: 'V1 调度与运行时设计',
  },
  triton: {
    title: 'Triton · 官方 GPU 编程教程',
    url: 'https://triton-lang.org/main/getting-started/tutorials/',
    note: '向量加法、Softmax、矩阵乘法和 Attention',
  },
  nsight: {
    title: 'NVIDIA · Nsight Systems User Guide',
    url: 'https://docs.nvidia.com/nsight-systems/UserGuide/',
    note: '系统时间线与 CPU/GPU 执行关联',
  },
  compute: {
    title: 'NVIDIA · Nsight Compute Profiling Guide',
    url: 'https://docs.nvidia.com/nsight-compute/ProfilingGuide/',
    note: 'Kernel 性能、访存和 Roofline 分析',
  },
  ep: {
    title: 'vLLM · Expert Parallel Deployment',
    url: 'https://docs.vllm.ai/en/latest/serving/expert_parallel_deployment/',
    note: 'MoE 专家分布、通信和负载均衡',
  },
  dp: {
    title: 'vLLM · Data Parallel Deployment',
    url: 'https://docs.vllm.ai/en/latest/serving/data_parallel_deployment/',
    note: '推理 DP 与 MoE 组合语义',
  },
  speculative: {
    title: 'Decoding Speculative Decoding',
    url: 'https://arxiv.org/abs/2402.01528',
    note: '候选生成成本与接受情况对收益的影响',
  },
  flash: {
    title: 'FlashAttention: Fast and Memory-Efficient Exact Attention',
    url: 'https://arxiv.org/abs/2205.14135',
    note: 'IO-aware Attention 与分块计算',
  },
  paged: {
    title: 'Efficient Memory Management for LLM Serving with PagedAttention',
    url: 'https://arxiv.org/abs/2309.06180',
    note: '分页 KV 与服务调度的原始论文',
  },
  torch: {
    title: 'PyTorch · Profiler',
    url: 'https://docs.pytorch.org/docs/stable/profiler.html',
    note: '算子时间、形状和内存分析 API',
  },
};
export const stages = [
  {
    title: '读懂模型的计算',
    en: 'MODEL FOUNDATIONS',
    summary: '从张量形状出发，理解一个 token 如何产生。',
    deliverable: '带 KV Cache 的注意力参考实现',
    span: '建议 2–3 周',
    color: '#247669',
  },
  {
    title: '建立性能直觉',
    en: 'PERFORMANCE THINKING',
    summary: '用测量解释时间、显存和尾延迟。',
    deliverable: '可复现的性能基线与瓶颈报告',
    span: '建议 2–3 周',
    color: '#38779b',
  },
  {
    title: '走进推理引擎',
    en: 'ENGINE INTERNALS',
    summary: '追踪请求，理解调度、缓存和模型执行。',
    deliverable: '请求职责与缓存生命周期地图',
    span: '建议 3–4 周',
    color: '#7864a4',
  },
  {
    title: '编写 GPU 算子',
    en: 'GPU PROGRAMMING',
    summary: '从访存和数值正确性走向 kernel 优化。',
    deliverable: '经校验的 Triton Softmax 实验',
    span: '建议 3–4 周',
    color: '#ab683b',
  },
  {
    title: '理解并行与推测',
    en: 'DISTRIBUTED INFERENCE',
    summary: '把 DP、TP、EP、MTP 变成可解释的设计。',
    deliverable: 'MoE 或推测解码的对照实验',
    span: '建议 3–4 周',
    color: '#936277',
  },
  {
    title: '完成定制化优化',
    en: 'ENGINEERING PRACTICE',
    summary: '以一个真实瓶颈为起点，交付可验证的改动。',
    deliverable: '带证据、回退开关和适用边界的引擎 patch',
    span: '建议 3–5 周',
    color: '#516c44',
  },
];
export const lessons: Lesson[] = [
  {
    id: 'tensor',
    prerequisites: [],
    stage: 0,
    title: '从张量开始读模型',
    subtitle: '把模型结构翻译成形状、计算和字节',
    minutes: 35,
    outcome: '能手算 Linear 的输出形状、FLOPs 和权重大小。',
    body: chapters['tensor'],
    experiment: [
      '基础：手写 X=[2,4,8]、W=[8,24] 时 Y 的形状、FLOPs 和 BF16 权重字节数。',
      '迁移：保持 D=8、O=24，将 B=2,T=4 改为 B=1,T=8，比较 FLOPs 与权重大小；完整模型耗时为何不能仅据此判断？',
      '用本地 PyTorch 验证形状；未安装时可先完成手算，后续在隔离环境安装。',
    ],
    acceptance: [
      '能解释 batch、sequence、hidden 三个维度。',
      '笔记中留下两组形状、FLOPs 与权重字节数。',
    ],
    quiz: {
      section: '一次 Linear，逐个数字看懂',
      question: '[B,T,D] 乘 [D,4D] 的结果是？',
      options: ['[B,T,4D]', '[B,4T,D]', '[B,T,D,D]'],
      answer: 0,
      explanation: '收缩的是公共维度 D；B 和 T 保留，最后一维变为 4D。',
    },
    sources: ['cs336'],
  },
  {
    id: 'attention',
    prerequisites: ['tensor'],
    stage: 0,
    title: 'Attention 如何读取上下文',
    subtitle: '亲手改变 Q、K、V，观察注意力权重',
    minutes: 45,
    outcome: '能解释缩放点积、causal mask 和 Softmax 的作用。',
    lab: 'attention',
    download: 'attention_reference.py',
    body: chapters['attention'],
    experiment: [
      '将三个分数设为相等，确认权重各为 1/3。',
      '提高第二个分数，记录权重变化；打开 causal mask，观察未来位置的权重。',
      '基础：运行正文的单头实现或下载脚本，检查 causal_error 接近 0；缓存等价性留到下一课解释。',
    ],
    acceptance: [
      '能手算两项 Softmax 并解释 mask。',
      '记录 causal_error（或未来位置权重为零的断言）与因果性检查结果。',
    ],
    quiz: {
      section: '数值稳定与一个最小实现',
      question: '为什么 Softmax 前可以减去整行最大值？',
      options: [
        '这样会让结果总是变成 one-hot',
        '分子分母共同乘上同一个常数，比例不变',
        '这样就不需要 causal mask',
      ],
      answer: 1,
      explanation:
        'exp(x-c)=exp(x)exp(-c)，共同因子在归一化中约去；有限精度下还能改善稳定性。',
    },
    sources: ['cs336', 'flash'],
  },
  {
    id: 'kv-cache',
    prerequisites: ['attention'],
    stage: 0,
    title: '实现增量推理与 KV Cache',
    subtitle: '为什么缓存 K/V，而不是缓存整个输出',
    minutes: 50,
    outcome: '能验证缓存推理正确，并估算标准 MHA/GQA 的 KV 容量。',
    lab: 'cache',
    download: 'attention_reference.py',
    body: chapters['kv-cache'],
    experiment: [
      '用交互计算器验证上面的 1 GiB 例子，再把 KV 头数从 8 改成 32。',
      '运行参考脚本，阅读 full_attention 与 cached_attention 的对应关系。',
      '改动 seed、输入长度、head_dim，至少保留三组误差；逐 token 比较，避免只看最后一步。',
    ],
    acceptance: [
      '解释为什么历史 K/V 可以复用、历史 Attention 读取不能完全省略。',
      '记录三组数值误差与 KV 估算；明确 MLA 不在此公式适用范围内。',
    ],
    quiz: {
      section: '从元素数推导 KV 显存',
      question:
        '标准 GQA 中，其他条件不变，KV heads 从 8 变成 4，KV 主体大小如何变化？',
      options: ['不变', '约减半', '约变成四分之一'],
      answer: 1,
      explanation: '公式对 KV 头数线性；这里不包含固定开销和碎片。',
    },
    sources: ['cs336', 'paged'],
  },
  {
    id: 'metrics',
    prerequisites: ['kv-cache'],
    stage: 1,
    title: '先定义一份可信的基线',
    subtitle: 'TTFT、ITL、吞吐与排队，分别回答什么',
    minutes: 40,
    outcome: '能设计一个有固定输入、版本与口径的性能对照实验。',
    download: 'analyze_benchmark.py',
    body: chapters['metrics'],
    experiment: [
      '下载分析脚本，先用 --demo 学会字段口径；示例是合成数据，不是设备实测。',
      '用自己的请求日志准备 JSONL：id、ttft_ms、latency_ms、output_tokens、success。',
      '传入包含完整测量窗口的 --duration-s；对比三轮报告并写出无法比较的条件。',
    ],
    acceptance: [
      '基线记录包含版本、工作负载、缓存状态和失败率。',
      '能区分端到端 TTFT、引擎耗时和排队时间。',
    ],
    quiz: {
      section: '用一组时间戳算清指标',
      question:
        '请求在 0 ms 发出，4 个 token 在 200、230、265、300 ms 到达。TPOT 是多少？',
      options: ['75 ms/token', '33.33 ms/token', '25 ms/token'],
      answer: 1,
      explanation:
        'TPOT=(300−200)/(4−1)=33.33。75 用总延迟除 token 数，混入首 token 前等待；25 把三个间隔误除以四个 token。',
    },
    sources: ['nsight', 'torch'],
  },
  {
    id: 'roofline',
    prerequisites: ['tensor', 'metrics'],
    stage: 1,
    title: '计算受限，还是带宽受限',
    subtitle: '用一个简单模型形成可以被推翻的预测',
    minutes: 45,
    outcome: '能用算术强度和设备上限估算性能下界。',
    lab: 'roofline',
    body: chapters['roofline'],
    experiment: [
      '设置 200 GFLOPs、4 GB、100 TFLOP/s、2 TB/s，验证 2 ms。',
      '分别将计算量和数据量减半，先预测再操作。',
      '为自己的模型某一层粗估 F/Q，写出忽略了哪些读写，之后用 profiler 验证。',
    ],
    acceptance: [
      '能写出 max(F/P,Q/BW) 并说明是乐观下界。',
      '笔记包含一次受限类型预测和需要验证的证据。',
    ],
    quiz: {
      section: '用反例检查你的推理',
      question: 'Roofline 估算为 2 ms，而实测 5 ms，最合理的判断是？',
      options: [
        '实测一定错了',
        '下界不是预测值，需检查访存、启动、通信等开销',
        'GPU 坏了',
      ],
      answer: 1,
      explanation: '理论峰值和完美重叠通常不可达，差距本身是进一步分析的入口。',
    },
    sources: ['compute'],
  },
  {
    id: 'profiling',
    prerequisites: ['metrics', 'roofline'],
    stage: 1,
    title: '读懂第一份执行时间线',
    subtitle: '将性能现象定位到 CPU、GPU 与通信',
    minutes: 50,
    outcome: '能从 trace 提出一个具体、可验证的瓶颈假设。',
    download: 'torch_profile.py',
    body: chapters['profiling'],
    experiment: [
      '运行 python3 labs/torch_profile.py --device cpu，保存 trace 与终端输出。',
      '进阶（需 NVIDIA GPU）：使用 --device cuda 重跑，比较 aten::mm 与 CUDA kernel；无设备时先完成 CPU trace。',
      '挑一个占比最高的操作，记录 shape、耗时占比与一个备选原因；设计一次单变量验证。',
    ],
    acceptance: [
      '留下 trace 路径和三条观察，不仅是 profiler 截图。',
      '解释异步计时，并提出一个能够被实验否定的假设。',
    ],
    quiz: {
      section: 'CPU 提交完成，不等于 GPU 工作完成',
      question:
        '只用 time.time() 包住一次 CUDA 调用且不等待完成，主要可能测到什么？',
      options: ['设备完整计算时间', 'CPU 提交工作的时间', 'HBM 容量'],
      answer: 1,
      explanation: 'CUDA 异步执行，必须明确计时边界及同步语义。',
    },
    sources: ['torch', 'nsight', 'compute'],
  },
  {
    id: 'request-path',
    prerequisites: ['kv-cache', 'profiling'],
    stage: 2,
    title: '追踪一次请求穿过引擎',
    subtitle: '把抽象架构映射到你固定的源码版本',
    minutes: 45,
    outcome: '能画出一次请求从进入到返回 token 的调用链。',
    body: chapters['request-path'],
    experiment: [
      '在本地实验 checkout 固定 vLLM commit；这些 rg 命令需要在引擎仓库执行。',
      '找出五个职责对应的文件和函数，每个写一句输入/输出。',
      '追踪一个正常完成请求，再追踪取消请求，观察 KV 释放位置。',
    ],
    acceptance: [
      '笔记有固定 commit 与五个源码入口。',
      '能解释请求完成/取消后状态和 KV 谁来清理。',
    ],
    quiz: {
      section: '五个职责，分别带着什么问题去找',
      question:
        '你要按某请求剩余 prefill token 数限制本轮分配，最先应该检查哪一层？',
      options: [
        '只接收局部矩阵指针的 Attention kernel',
        '持有请求状态并分配 token 预算的 Scheduler',
        '只负责将文本转为 token ID 的 Tokenizer',
      ],
      answer: 1,
      explanation:
        'Scheduler 掌握请求进度和本轮预算，是查找策略入口的起点；kernel 通常缺少请求级状态，Tokenizer 负责输入转换。实际修改还要核对 KV 分配和执行后端约束。',
    },
    sources: ['architecture', 'v1'],
  },
  {
    id: 'scheduling',
    prerequisites: ['metrics', 'request-path'],
    stage: 2,
    title: '连续批处理与分块 Prefill',
    subtitle: '理解吞吐和交互延迟之间的权衡',
    minutes: 50,
    outcome: '能解释长请求如何影响短请求，并设计调度对照。',
    lab: 'scheduler',
    download: 'scheduler_reference.py',
    body: chapters['scheduling'],
    experiment: [
      '在交互中调整 chunk，观察 decode 的最大等待间隔与长 prompt 完成时间。',
      '运行参考脚本，比较 chunk=128 与 2048 的逻辑时间结果。',
      '进阶（需引擎实验环境）：在固定版本中找到预算分配点，添加抽样统计；本课只观测默认行为；策略实现留到第 17 课。',
    ],
    acceptance: [
      '写出 chunk 变小的收益与至少一个代价。',
      '提交一份混合负载实验设计，同时衡量长短请求。',
    ],
    quiz: {
      section: '用本页模型手算两种调度',
      question: '本课 toy 模型将 chunk 从 2048 改为 128，哪个预测符合手算？',
      options: [
        'decode 更早完成第一步，长 prefill 完成时间也必然更早',
        'decode 更早完成第一步，但长 prefill 完成时间更晚',
        '总轮数必然增加 16 倍',
      ],
      answer: 1,
      explanation:
        '第一次 decode 从 42.36 ms 提前到 3.96 ms；prefill 从 41.36 ms 延后到 62.36 ms。两组总轮数都由 16 步 decode 限制，不能用切块数量直接推断总轮数。',
    },
    sources: ['v1', 'architecture'],
  },
  {
    id: 'paged-kv',
    prerequisites: ['kv-cache', 'scheduling'],
    stage: 2,
    title: '分页 KV、共享与回收',
    subtitle: '从逻辑 token 位置走到物理缓存块',
    minutes: 45,
    outcome: '能解释 block table、内部碎片和 prefix cache 的命中条件。',
    lab: 'cache',
    body: chapters['paged-kv'],
    experiment: [
      '手算长度为 15、16、17、33 的请求各占几个 16-token 块。',
      '在源码中找到 allocate/free/cache-hit 的位置，画出两请求共享一块的引用关系。',
      '基础：为取消、空间不足和共享释放写出预期状态；进阶：在引擎实验环境运行并保存日志，第 17 课将其用于回归。',
    ],
    acceptance: [
      '笔记包含碎片计算和共享块生命周期。',
      '能说明显存占用下降后还要验证哪些输出与回收行为。',
    ],
    quiz: {
      section: '手工走一次块分配',
      question: '块大小为 16，长度为 33 的独立序列需要多少块？',
      options: ['2', '3', '33'],
      answer: 1,
      explanation: 'ceil(33/16)=3，最后一个块只使用 1 个槽位。',
    },
    sources: ['paged', 'architecture'],
  },
  {
    id: 'gpu-memory',
    prerequisites: ['tensor', 'roofline'],
    stage: 3,
    title: 'GPU 执行与访存模型',
    subtitle: '从 CPU 循环思维转向并行数据布局',
    minutes: 45,
    outcome: '能解释合并访存、tiling 和寄存器压力。',
    lab: 'roofline',
    body: chapters['gpu-memory'],
    experiment: [
      '基础：手算正文向量加法的索引和 mask；GPU 实践：完成 Triton 官方 vector addition，改变 BLOCK_SIZE 并记录正确性。',
      '用长度 1000、1024、1025 检查 mask；避免越界读取和写入。',
      '解释连续访问与 stride 访问差异，用 profiler 看吞吐而非只猜 occupancy。',
    ],
    acceptance: [
      '解释 HBM、shared memory、register 三者角色。',
      '记录至少三个 block 配置和尾部边界检查；无 GPU 时只记手算，实测验收保留待完成。',
    ],
    quiz: {
      section: 'Tiling 如何增加数据复用',
      question: '增加 block 大小后性能下降，哪种原因值得检查？',
      options: [
        '寄存器压力和并行驻留限制',
        '模型参数自动增加',
        'KV heads 自动变多',
      ],
      answer: 0,
      explanation:
        '更大的 tile 可能提高复用，也可能消耗更多片上资源，需要实测权衡。',
    },
    sources: ['triton', 'compute'],
  },
  {
    id: 'softmax',
    prerequisites: ['attention', 'gpu-memory'],
    stage: 3,
    title: '写一个融合 Softmax',
    subtitle: '正确性、数值稳定与带宽收益一起验证',
    minutes: 55,
    outcome: '能运行并修改一个有边界测试的 Triton kernel。',
    download: 'triton_softmax.py',
    body: chapters['softmax'],
    experiment: [
      '在独立 NVIDIA CUDA 环境安装兼容的 PyTorch 与 Triton；Mac 可先阅读源码。',
      '运行下载脚本，保存每种 shape/dtype 的误差、Torch 时间和 Triton 时间。',
      '改变 num_warps，先重新检查正确性，再解释收益为什么依赖 shape。',
    ],
    acceptance: [
      '至少四种 shape 通过数值比较。',
      '写明未获加速或发生退化的 shape，不能只保留赢家。',
    ],
    quiz: {
      section: '填充值错了，会产生什么结果',
      question:
        '有效分数均为 -2，行尾补齐位置却填了 0，而且参与 Softmax 分母。有效输出之和会怎样？',
      options: [
        '小于 1，因为无效位置也分走了权重',
        '仍为 1，因为减去最大值会自动忽略无效位置',
        '大于 1，因为有效分数全是负数',
      ],
      answer: 0,
      explanation:
        '补齐的 0 经 exp 后仍贡献 1，侵占有效元素的概率质量。减最大值只改变共同尺度，不会删除无效项；读入填 -inf 且写回加 mask 才能正确排除补齐位置。',
    },
    sources: ['triton', 'compute'],
  },
  {
    id: 'attention-kernels',
    prerequisites: ['attention', 'roofline', 'softmax'],
    stage: 3,
    title: '从小算子走向 Attention 与量化',
    subtitle: '理解 IO 优化，避免把“更少字节”当作万能答案',
    minutes: 50,
    outcome: '能区分算法等价的执行优化与会改变数值的近似。',
    lab: 'amdahl',
    body: chapters['attention-kernels'],
    experiment: [
      '在 Amdahl 交互中比较热点占比 10% 与 70% 的情况。',
      '阅读 FlashAttention 论文的 IO 思路，手写在线 max 变化时旧累积量如何缩放。',
      '选一个量化模式，列出存储格式、scale、kernel 与质量验证四项证据。',
    ],
    acceptance: [
      '能解释 FlashAttention 为什么仍是标准 Attention 的计算目标。',
      '用端到端占比估算一次算子优化的收益上限。',
    ],
    quiz: {
      section: 'Amdahl 定律帮你决定是否值得做',
      question: '占总时间 10% 的算子速度翻倍，整体大约加速多少？',
      options: ['2 倍', '1.053 倍', '10 倍'],
      answer: 1,
      explanation: '新耗时为 90%+10%/2=95%，总加速约 1/0.95。',
    },
    sources: ['flash', 'compute'],
  },
  {
    id: 'parallel',
    prerequisites: ['tensor', 'profiling'],
    stage: 4,
    title: 'DP、TP 与通信的代价',
    subtitle: '先画权重与张量的分布，再读启动参数',
    minutes: 50,
    outcome: '能描述一个并行方案中的复制、分片与同步点。',
    body: chapters['parallel'],
    experiment: [
      '为一个两层 toy 网络画出 DP=2 和 TP=2 的权重/输入分布。',
      '标出必须发生通信的位置，并区分 all-reduce 与 all-to-all。',
      '在自己的设备上记录拓扑，比较一个小消息和大消息 collective 的时间；不要启动未授权的生产测试。',
    ],
    acceptance: [
      '有一张 rank 到权重/请求的映射。',
      '解释增加 GPU 后速度不线性增加的至少两个原因。',
    ],
    quiz: {
      section: '用数字区别“拼接”和“求和”',
      question:
        'x=[1,2]、W=[[1,3],[2,4]] 沿输入维分到两卡，局部结果 [1,3] 与 [4,8] 应如何合并？',
      options: [
        '对应元素求和，得到 [5,11]',
        '拼接为 [1,3,4,8]',
        '取平均，得到 [2.5,5.5]',
      ],
      answer: 0,
      explanation:
        '沿输入维切分时，每张卡计算的是同一输出的部分和，所以相加。沿输出维切分才形成不同输出列；求平均则无故缩小结果。',
    },
    sources: ['dp', 'ep'],
  },
  {
    id: 'moe',
    prerequisites: ['parallel'],
    stage: 4,
    title: 'MoE 路由与 Expert Parallel',
    subtitle: '从选专家到 dispatch、计算、combine',
    minutes: 55,
    outcome: '能区分总参数量、激活参数量和实际运行成本。',
    body: chapters['moe'],
    experiment: [
      '手算 top-2 路由时 100 token 最多产生多少条专家分配。',
      '构造均匀与偏斜两组路由负载，比较最忙 rank 与平均值。',
      '按固定引擎版本记录专家映射、通信 backend 和硬件拓扑，设计一次布局 A/B。',
    ],
    acceptance: [
      '笔记包含每 rank 分布与 dispatch/compute/combine 分解。',
      '指出至少三种 MoE 正确性边界。',
    ],
    quiz: {
      section: '一个四卡偏斜例子',
      question: '四个 rank 负载 [100,100,100,400]，只看平均 175 为什么不够？',
      options: [
        '同步路径可能受最忙 rank 限制',
        '平均值计算错误',
        'EP 没有任何同步',
      ],
      answer: 0,
      explanation: '平均负载隐藏了尾部等待，要按 rank 分析关键路径。',
    },
    sources: ['ep', 'dp'],
  },
  {
    id: 'speculation',
    prerequisites: ['kv-cache', 'metrics', 'roofline'],
    stage: 4,
    title: 'MTP 与推测解码的收益账本',
    subtitle: '接受率只是收益的一部分',
    minutes: 50,
    outcome: '能根据候选成本、验证成本和前进 token 数判断收益。',
    lab: 'speculation',
    body: chapters['speculation'],
    experiment: [
      '把接受概率设为 0，观察候选成本为何可能让执行更慢。',
      '在接受概率不变时增加验证时间，找出加速比跌破 1 的位置。',
      '真实实验只改变候选长度，比较低/高负载，并按实现验证 greedy 等价或采样分布。',
    ],
    acceptance: [
      '能用一组数据算出收益，并列出简化假设。',
      '对照实验同时记录接受数与候选/验证成本。',
    ],
    quiz: {
      section: '完整算一笔账，再看反例',
      question: '接受率提高了，但总吞吐下降，可能吗？',
      options: [
        '不可能',
        '可能，候选和验证成本可能增长得更快',
        '只有 tokenizer 出错才会',
      ],
      answer: 1,
      explanation:
        '吞吐由总前进 token 数与整轮成本共同决定，接受率不是唯一指标。',
    },
    sources: ['speculative'],
  },
  {
    id: 'hypothesis',
    download: 'optimization-report.md',
    prerequisites: ['metrics', 'profiling', 'scheduling'],
    stage: 5,
    title: '把一个现象写成优化假设',
    subtitle: '为你的第一个引擎 patch 选择明确边界',
    minutes: 40,
    outcome: '能写出问题、证据、方案与失败条件。',
    lab: 'amdahl',
    body: chapters['hypothesis'],
    experiment: [
      '从已有实验笔记选一个现象，写成可被推翻的假设。',
      '列出两个其他解释和各自的验证方法。',
      '下载 optimization-report.md，填写第 1–3 节：问题与目标、环境与复现、假设与反证。',
    ],
    acceptance: [
      '有一份包含反证条件的提案。',
      '成功标准涵盖正确性、性能、失败率与退化场景。',
    ],
    quiz: {
      section: '在动手前定义什么叫成功',
      question: '基线波动 8%，候选一次快 3%，最合适的下一步？',
      options: [
        '立即宣布成功',
        '重复交错 A/B 并分析波动与控制条件',
        '删除较慢的记录',
      ],
      answer: 1,
      explanation: '变化必须与噪声区分，且应保留所有有效实验结果。',
    },
    sources: ['nsight', 'architecture'],
  },
  {
    id: 'patch',
    prerequisites: ['request-path', 'paged-kv', 'hypothesis'],
    stage: 5,
    title: '交付一个可验证的引擎改动',
    subtitle: '从观测 patch 到策略 patch',
    minutes: 50,
    outcome: '能组织一个默认行为不变、有测试和回退路径的补丁。',
    body: chapters['patch'],
    experiment: [
      '基础：运行 prefill_budget.py，并手算默认 504、cap=128 时分配 128；进阶：接入固定引擎，用默认关闭的开关验证基线兼容。',
      '添加能捕获真实边界 bug 的测试，而不是复制实现逻辑。',
      '交错跑至少三轮 A/B，保存原始数据和所有失败案例。',
    ],
    acceptance: [
      'patch 可独立关闭，且边界测试和项目检查通过。',
      '有原始 A/B 数据、版本与可复现命令。',
    ],
    quiz: {
      section: '一个可以完整看懂的策略函数',
      question:
        'remaining=2048、token_budget=512、decode_tokens=8。cap=0 与 cap=128 时，prefill 分别获多少预算？',
      options: ['512 和 128', '504 和 128', '0 和 128'],
      answer: 1,
      explanation:
        '先预留 decode：512−8=504。cap=0 表示关闭限制，仍可分配 504；cap=128 时再取 min(2048,504,128)=128。0 不是禁止 prefill，512 则遗漏了 decode 预留。',
    },
    download: 'prefill_budget.py',
    sources: ['architecture', 'torch'],
  },
  {
    id: 'capstone',
    prerequisites: ['hypothesis', 'patch'],
    stage: 5,
    title: '毕业项目：用证据说明你的优化',
    subtitle: '把“我调快了”变成别人能复现的工程成果',
    minutes: 45,
    outcome: '形成一份包含代码、性能、正确性与边界的完整交付。',
    download: 'optimization-report.md',
    body: chapters['capstone'],
    experiment: [
      '填写并保存毕业报告，把 patch、命令与原始证据放在同一实验目录。',
      '用全新环境或干净 checkout 复现关键结果；记录缺失依赖。',
      '在本课笔记填写五个答辩问题的回答，最后自评验收。',
    ],
    acceptance: [
      '完整交付包含可复现 patch、正确性结果、三轮 A/B 和退化边界。',
      '能独立回答五个问题，并演示回退；没有把 toy 结果当生产结论。',
    ],
    quiz: {
      section: '用一个虚构对照表学习怎样下结论',
      question:
        '候选将短请求 P99 ITL 从 120 降到 75 ms，但长请求 P99 TTFT 从 1.2 升到 1.5 s；预设长请求上限是 1.4 s。如何结论？',
      options: [
        '已通过，因为短请求改善 37.5%',
        '未通过当前目标，应保留结果并调整方案或适用范围',
        '改用 1.6 s 作门槛，就可以按原目标宣布成功',
      ],
      answer: 1,
      explanation:
        '候选改善短请求却违反预先约定的长请求上限，不能宣布通过当前目标。可以重新讨论需求并启动新的评估，但不能事后移动门槛来美化原实验。',
    },
    sources: ['architecture', 'nsight', 'compute'],
  },
];
export const glossary = [
  ['Prefill', '对输入 prompt 执行计算并建立初始 KV Cache 的阶段。', 'kv-cache'],
  [
    'Decode',
    '基于历史状态逐步生成后续 token 的过程；标准全注意力仍需读取历史 KV。',
    'kv-cache',
  ],
  [
    'KV Cache',
    '按层保留历史 key/value（或架构特定状态），避免重复计算；不是生成文本缓存。',
    'kv-cache',
  ],
  ['TTFT', 'Time to First Token；必须标明客户端或服务端计时起点。', 'metrics'],
  [
    'ITL / TPOT',
    '相邻 token 延迟 / 平均每输出 token 时间；chunk 不一定等于 token。',
    'metrics',
  ],
  [
    'Roofline',
    '用峰值计算吞吐、内存带宽与算术强度估计吞吐上限的模型。',
    'roofline',
  ],
  [
    'Continuous batching',
    '在迭代边界动态移出完成请求并加入新请求。',
    'scheduling',
  ],
  [
    'Chunked prefill',
    '把长 prompt 的计算切分到多轮，改善调度粒度。',
    'scheduling',
  ],
  [
    'PagedAttention',
    '通过块映射访问非连续物理 KV 的设计；与 FlashAttention 解决的问题不同。',
    'paged-kv',
  ],
  [
    'FlashAttention',
    '通过分块与在线 Softmax 减少 Attention 中间数据的 HBM 读写。',
    'attention-kernels',
  ],
  [
    'DP / TP / PP',
    '请求/副本并行、层内张量并行、跨层流水线并行；组合语义需看实现。',
    'parallel',
  ],
  ['EP', 'Expert Parallelism；把 MoE 专家分布到不同设备。', 'moe'],
  [
    'MTP',
    'Multi-Token Prediction；可用于提供多个候选，实际推理需结合相应验证方案。',
    'speculation',
  ],
  [
    'GQA / MLA',
    'GQA 让 query heads 共享 KV heads；MLA 用压缩 latent 等机制减少 KV 开销。',
    'kv-cache',
  ],
  [
    'CUDA Graph',
    '记录并重放一组 GPU 操作以降低提交开销；受形状和地址等约束。',
    'profiling',
  ],
  [
    'Kernel fusion',
    '把多个操作合并以减少中间访存或启动次数；收益需端到端验证。',
    'softmax',
  ],
  [
    'All-reduce / All-to-all',
    '前者归约后把结果分发给各 rank；后者让各 rank 向其他 rank 交换不同数据。',
    'parallel',
  ],
  [
    'Amdahl 定律',
    '整体收益受未优化部分限制：S=1/((1-f)+f/s)。',
    'attention-kernels',
  ],
];
