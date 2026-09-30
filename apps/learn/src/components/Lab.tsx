import { useState } from 'react';
import { FlaskConical, RotateCcw } from 'lucide-react';
import { LabKind } from '../data/course';
import {
  amdahl,
  kvGiB,
  roofline,
  schedule,
  softmax,
  speculate,
} from '../lib/math';
const titles: Record<LabKind, string> = {
  attention: 'Attention 权重实验',
  cache: 'KV Cache 容量实验',
  roofline: 'Roofline 性能下界',
  scheduler: 'Prefill 分块实验',
  speculation: '推测解码收益实验',
  amdahl: '端到端收益实验',
};
export { titles as labTitles };
function Slider({
  name,
  value,
  min,
  max,
  step = 1,
  unit = '',
  set,
}: {
  name: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  set: (v: number) => void;
}) {
  return (
    <label className="slider-label">
      <span>
        {name}
        <strong>
          {Number(value.toFixed(3))} {unit}
        </strong>
      </span>
      <input
        aria-label={name}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => set(+e.target.value)}
      />
    </label>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="lab-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
export function Lab({ kind }: { kind: LabKind }) {
  const [version, reset] = useState(0);
  return (
    <section className="lab-panel">
      <div className="lab-heading">
        <span>
          <FlaskConical size={18} />
          {titles[kind]}
        </span>
        <button
          className="icon-button"
          aria-label="重置实验参数"
          onClick={() => reset(version + 1)}
        >
          <RotateCcw size={16} />
        </button>
      </div>
      <p className="simulation-label">交互原理模型 · 非 GPU 实测</p>
      <LabBody key={`${kind}-${version}`} kind={kind} />
    </section>
  );
}
function LabBody({ kind }: { kind: LabKind }) {
  const [a, setA] = useState(
    kind === 'cache'
      ? 8192
      : kind === 'roofline'
        ? 200
        : kind === 'scheduler'
          ? 512
          : kind === 'speculation'
            ? 0.8
            : kind === 'amdahl'
              ? 0.1
              : 1,
  );
  const [b, setB] = useState(
    kind === 'cache'
      ? 8
      : kind === 'roofline'
        ? 4
        : kind === 'speculation'
          ? 4
          : kind === 'amdahl'
            ? 2
            : 0,
  );
  const [c, setC] = useState(
    kind === 'cache'
      ? 1
      : kind === 'roofline'
        ? 100
        : kind === 'speculation'
          ? 3
          : 0,
  );
  const [d, setD] = useState(kind === 'roofline' ? 2 : 12);
  const [mask, setMask] = useState(false);
  if (kind === 'attention') {
    const weights = softmax([a, b, c], mask);
    return (
      <>
        <div className="lab-controls">
          <Slider
            name="分数 · Key 1"
            value={a}
            min={-5}
            max={5}
            step={0.1}
            set={setA}
          />
          <Slider
            name="分数 · Key 2"
            value={b}
            min={-5}
            max={5}
            step={0.1}
            set={setB}
          />
          <Slider
            name="分数 · Key 3"
            value={c}
            min={-5}
            max={5}
            step={0.1}
            set={setC}
          />
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={mask}
            onChange={(e) => setMask(e.target.checked)}
          />
          屏蔽未来位置 Key 3
        </label>
        <div className="weight-bars">
          {weights.map((w, i) => (
            <div key={i}>
              <span>Key {i + 1}</span>
              <div>
                <i style={{ width: `${w * 100}%` }} />
              </div>
              <strong>{(w * 100).toFixed(1)}%</strong>
            </div>
          ))}
        </div>
        <p className="lab-explain">
          输入视为已经缩放的 logits。权重之和为{' '}
          {weights.reduce((x, y) => x + y, 0).toFixed(3)}；开启 mask
          后，第三项不参与归一化。
        </p>
      </>
    );
  }
  if (kind === 'cache')
    return (
      <>
        <div className="lab-controls">
          <Slider
            name="每请求缓存 token"
            value={a}
            min={1024}
            max={32768}
            step={1024}
            set={setA}
          />
          <Slider name="KV heads" value={b} min={1} max={32} set={setB} />
          <Slider name="同时驻留请求" value={c} min={1} max={32} set={setC} />
        </div>
        <div className="stat-grid">
          <Stat
            label="KV 主体容量"
            value={`${kvGiB(32, a, b, 128, 2, c).toFixed(2)} GiB`}
          />
          <Stat
            label="每 token / 每请求"
            value={`${((2 * 32 * b * 128 * 2) / 1024).toFixed(0)} KiB`}
          />
        </div>
        <code className="formula">
          2 × 32 层 × token × KV heads × 128 × 2 bytes × 请求数
        </code>
        <p className="lab-explain">
          固定 BF16、32 层、head_dim=128；标准 MHA/GQA 全部 KV
          的总容量，不是单卡分片容量。不含权重、激活、碎片、scale；不适用于
          MLA。
        </p>
      </>
    );
  if (kind === 'roofline') {
    const r = roofline(a, b, c, d);
    return (
      <>
        <div className="lab-controls">
          <Slider
            name="计算量"
            value={a}
            min={10}
            max={1000}
            step={10}
            unit="GFLOPs"
            set={setA}
          />
          <Slider
            name="HBM 搬运量"
            value={b}
            min={0.5}
            max={16}
            step={0.5}
            unit="GB"
            set={setB}
          />
          <Slider
            name="计算峰值"
            value={c}
            min={10}
            max={500}
            step={10}
            unit="TFLOP/s"
            set={setC}
          />
          <Slider
            name="内存带宽"
            value={d}
            min={0.5}
            max={8}
            step={0.5}
            unit="TB/s"
            set={setD}
          />
        </div>
        <div className="stat-grid">
          <Stat label="计算下界" value={`${r.computeMs.toFixed(2)} ms`} />
          <Stat label="访存下界" value={`${r.memoryMs.toFixed(2)} ms`} />
          <Stat label="理想总下界" value={`${r.boundMs.toFixed(2)} ms`} />
        </div>
        <p className="lab-explain">
          当前算术强度 {r.intensity.toFixed(1)} FLOPs/byte。
          {Math.abs(r.computeMs - r.memoryMs) < 0.001
            ? '两项下界相等。'
            : r.computeMs > r.memoryMs
              ? '模型显示计算受限。'
              : '模型显示带宽受限。'}{' '}
          使用十进制 GB/TB，假设计算与访存充分重叠，不含启动、同步或通信。
        </p>
      </>
    );
  }
  if (kind === 'scheduler') {
    const r = schedule(a);
    return (
      <>
        <Slider
          name="Prefill chunk"
          value={a}
          min={128}
          max={2048}
          step={128}
          unit="tokens"
          set={setA}
        />
        <div
          className="timeline"
          aria-label="调度时间线：橙色 Prefill，绿色 Decode，灰色调度开销"
        >
          {r.events.map((e, i) => (
            <span
              key={i}
              className={e.type}
              style={{ width: `${(e.duration / r.time) * 100}%` }}
              title={`${e.type} ${e.duration.toFixed(2)} ms`}
            />
          ))}
        </div>
        <div className="legend">
          <span>
            <i className="prefill" />
            Prefill
          </span>
          <span>
            <i className="decode" />
            Decode
          </span>
          <span>
            <i className="overhead" />
            调度开销
          </span>
        </div>
        <div className="stat-grid">
          <Stat
            label="Decode 最大间隔（含初次等待）"
            value={`${r.maxGap.toFixed(2)} ms`}
          />
          <Stat label="长 prompt 完成" value={`${r.promptEnd.toFixed(2)} ms`} />
          <Stat label="总模拟时长" value={`${r.time.toFixed(2)} ms`} />
        </div>
        <p className="lab-explain">
          合成工作负载：2048-token prompt + 16 个 decode 步骤；每轮先 prefill 再
          decode。Prefill 每 token 0.02 ms、decode 每步 1 ms、每轮开销 0.4
          ms。真实 GPU 成本并非线性。
        </p>
      </>
    );
  }
  if (kind === 'speculation') {
    const r = speculate(b, a, 10, c, d);
    return (
      <>
        <div className="lab-controls">
          <Slider
            name="条件接受概率"
            value={a}
            min={0}
            max={1}
            step={0.05}
            set={setA}
          />
          <Slider name="候选长度 k" value={b} min={1} max={8} set={setB} />
          <Slider
            name="每轮候选成本"
            value={c}
            min={1}
            max={30}
            unit="ms"
            set={setC}
          />
          <Slider
            name="每轮验证成本"
            value={d}
            min={2}
            max={50}
            unit="ms"
            set={setD}
          />
        </div>
        <div className="stat-grid">
          <Stat label="期望前进 token / 轮" value={r.expected.toFixed(2)} />
          <Stat
            label={r.speedup >= 1 ? '理论加速比' : '理论加速比 · 发生减速'}
            value={`${r.speedup.toFixed(2)}×`}
          />
        </div>
        <p className="lab-explain">
          基线固定为 10
          ms/token。E=1+a+…+aᵏ，假设各位置条件接受概率相同、每轮可额外产生一个
          token。候选/验证成本由你独立输入；忽略批内差异及调度，不承诺实测收益。
        </p>
      </>
    );
  }
  return (
    <>
      <div className="lab-controls">
        <Slider
          name="热点占总时间比例"
          value={a}
          min={0.05}
          max={1}
          step={0.05}
          set={setA}
        />
        <Slider
          name="热点加速倍数"
          value={b}
          min={1}
          max={20}
          step={0.5}
          set={setB}
        />
      </div>
      <div className="stat-grid">
        <Stat label="整体加速比" value={`${amdahl(a, b).toFixed(3)}×`} />
        <Stat
          label="整体耗时减少"
          value={`${((1 - 1 / amdahl(a, b)) * 100).toFixed(1)}%`}
        />
      </div>
      <code className="formula">S = 1 / ((1 − f) + f / s)</code>
      <p className="lab-explain">
        假设其余部分和工作负载不变、没有新开销。先确认关键路径占比，再决定是否值得投入算子优化。
      </p>
    </>
  );
}
