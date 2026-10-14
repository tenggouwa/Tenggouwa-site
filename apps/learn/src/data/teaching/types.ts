export type MathHelp =
  | 'multiply'
  | 'power'
  | 'exp'
  | 'root'
  | 'ceil'
  | 'ratio'
  | 'minmax'
  | 'mean';
export interface TeachingStep {
  title: string;
  text: string;
  lines: string[];
  takeaway: string;
  question: string;
  options: [string, string];
  answer: number;
  explanation: string;
  math?: MathHelp;
}
export interface TeachingPath {
  bridge: string;
  analogy: string;
  mapping: [string, string][];
  boundary: string;
  steps: TeachingStep[];
  tryThis: string;
  next: string;
}
export function step(
  title: string,
  text: string,
  lines: string[],
  takeaway: string,
  question: string,
  options: [string, string],
  answer: number,
  explanation: string,
  math?: MathHelp,
): TeachingStep {
  return {
    title,
    text,
    lines,
    takeaway,
    question,
    options,
    answer,
    explanation,
    math,
  };
}
export const mathHelp: Record<MathHelp, { title: string; lines: string[] }> = {
  multiply: {
    title: '乘法、数组和形状分别是什么？',
    lines: [
      '3×2 可以读成 3 组、每组 2 个，共 6 个。',
      '[3,2] 是数组形状：3 行、每行 2 个数，不是乘法结果。',
      '矩阵乘法是按行、列配对相乘再求和；不能把两个矩阵对应位置直接相乘当作同一运算。',
    ],
  },
  power: {
    title: '指数、零次方与负指数',
    lines: [
      '2³=2×2×2=8；上角的 3 表示连续乘 3 次。',
      '非零数的零次方为 1：2⁰=1。',
      '负指数表示取倒数：2⁻²=1/(2×2)=1/4，不是 −4。',
      '0.8²=0.8×0.8=0.64；连续两次、每次条件成功率为 0.8，联合成功率就是 0.64。',
    ],
  },
  exp: {
    title: 'exp 和 e 是什么？',
    lines: [
      'e 是约等于 2.718 的固定数；exp(x) 就是 eˣ。',
      'exp(0)=1，exp(1)≈2.718，exp(−1)=1/e≈0.368。',
      '负分数取 exp 后仍是正数。Softmax 再除以总和，才得到比例。',
      '分数越来越小，exp 越接近 0；exp(−∞)=0 是这个极限的简写。',
    ],
  },
  root: {
    title: '平方根为什么叫“根”？',
    lines: [
      '平方是一个数乘自己：4²=4×4=16。',
      '平方根反过来问：哪个非负数乘自己等于 16？答案是 4，所以 √16=4。',
      '√2≈1.414，不是 2÷2。注意力用 √d 缩放点积分数。',
    ],
  },
  ceil: {
    title: '向上取整 ceil',
    lines: [
      '33÷16=2.0625。若每箱装 16 件，不能只拿 2 箱。',
      'ceil(2.0625)=3：取不小于它的最小整数。',
      '恰好装满时不用多拿一箱：ceil(32/16)=2。',
    ],
  },
  ratio: {
    title: '比例、百分比和倍数',
    lines: [
      '部分÷整体得到比例：20÷100=0.2=20%。',
      '从 100 ms 降到 80 ms，耗时下降 (100−80)/100=20%。',
      '同样工作量的加速倍数是 100/80=1.25 倍。耗时下降百分比与速度提升百分比不能混用。',
    ],
  },
  minmax: {
    title: 'min 与 max',
    lines: [
      'min(8,5,3)=3，取最小值：多个上限同时限制时听最严格的。',
      'max(8,5,3)=8，取最大值：必须等所有并行工作完成时，看最慢的那个。',
      '先判断实际关系，再选运算；串行的两段耗时通常相加。',
    ],
  },
  mean: {
    title: '平均数与尾部',
    lines: [
      '平均数=总和÷数量。[1,1,1,9] 的平均数是 12÷4=3。',
      '平均为 3，不代表每个人都只等了 3；仍有人等了 9。',
      'P99 描述按某种分位数规则得到的高位延迟，需要足够样本和一致口径。它不是最大值。',
    ],
  },
};
