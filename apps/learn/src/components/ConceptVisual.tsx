import { useState } from 'react';

type Bar = { label: string; value: number; unit?: string };
function Bars({ rows, max }: { rows: Bar[]; max?: number }) {
  const upper = max ?? Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="visual-bars">
      {rows.map((row) => (
        <div key={row.label} className="visual-bar-row">
          <span>{row.label}</span>
          <div className="visual-track">
            <div
              style={{
                width: `${Math.max(0, Math.min(100, (row.value / upper) * 100))}%`,
              }}
            />
          </div>
          <strong>
            {Number(row.value.toFixed(2))} {row.unit}
          </strong>
        </div>
      ))}
    </div>
  );
}
function Tiles({
  count,
  capacity,
  width = 16,
}: {
  count: number;
  capacity: number;
  width?: number;
}) {
  return (
    <div
      className="visual-tiles"
      style={{ gridTemplateColumns: `repeat(${width}, minmax(0,1fr))` }}
      aria-label={`${count} 个已用槽，共 ${capacity} 个槽`}
    >
      {Array.from({ length: capacity }, (_, i) => (
        <span key={i} className={i < count ? 'filled' : ''} />
      ))}
    </div>
  );
}
export function ConceptVisual({ id }: { id: string }) {
  const [value, setValue] = useState(
    id === 'attention' ? 0 : id === 'softmax' ? 0 : 4,
  );
  const [toggle, setToggle] = useState(false);
  const [position, setPosition] = useState(0);
  const slider = (label: string, min: number, max: number, step = 1) => (
    <label className="visual-slider">
      {label}
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        onChange={(e) => setValue(+e.target.value)}
      />
      <output>{Math.min(max, Math.max(min, value))}</output>
    </label>
  );
  const switcher = (off: string, on: string) => (
    <button
      className="button secondary"
      aria-pressed={toggle}
      onClick={() => setToggle(!toggle)}
    >
      {toggle ? on : off}
    </button>
  );
  let body;
  switch (id) {
    case 'tensor': {
      const n = Math.max(1, value);
      body = (
        <>
          {slider('一起计算的 token 数', 1, 8)}
          <div className="visual-equation">
            <div>
              <Tiles count={n * 2} capacity={n * 2} width={2} />
              <b>X · {n}×2</b>
            </div>
            <span>×</span>
            <div>
              <Tiles count={6} capacity={6} width={3} />
              <b>W · 2×3</b>
            </div>
            <span>=</span>
            <div>
              <Tiles count={n * 3} capacity={n * 3} width={3} />
              <b>Y · {n}×3</b>
            </div>
          </div>
          <div className="visual-result">
            {12 * n} FLOPs <span>权重始终 6 个数</span>
          </div>
        </>
      );
      break;
    }
    case 'attention': {
      const scores = [0, value, 0];
      const ex = scores.map(Math.exp);
      const total = ex[0] + ex[1] + (toggle ? 0 : ex[2]);
      body = (
        <>
          {slider('第二个位置的匹配分数', -3, 3)}
          {switcher('屏蔽未来位置', '恢复未来位置')}
          <Bars
            rows={scores.map((_, i) => ({
              label: ['位置 0', '位置 1', '未来位置'][i],
              value: toggle && i === 2 ? 0 : (ex[i] / total) * 100,
              unit: '%',
            }))}
            max={100}
          />
          <div className="visual-result">
            权重总和 = 100%<span>柱长表示读取比例</span>
          </div>
        </>
      );
      break;
    }
    case 'kv-cache':
    case 'paged-kv': {
      const n = Math.max(1, value),
        blocks = Math.ceil(n / 16);
      body = (
        <>
          {slider('已处理 token 数', 1, 48)}
          <div className="visual-blocks">
            {Array.from({ length: blocks }, (_, i) => (
              <div key={i}>
                <span>块 {i + 1}</span>
                <Tiles
                  count={Math.min(16, n - i * 16)}
                  capacity={16}
                  width={8}
                />
              </div>
            ))}
          </div>
          <div className="visual-result">
            {n} 已用 / {blocks * 16} 槽位
            <span>
              {id === 'kv-cache'
                ? `${(n * 0.125).toFixed(3)} MiB 逻辑 KV · 128 KiB/token 示例`
                : `尾块空闲 ${blocks * 16 - n} 个槽`}
            </span>
          </div>
        </>
      );
      break;
    }
    case 'metrics': {
      const wait = value * 50;
      body = (
        <>
          {slider('首 token 等待档位（每档 50 ms）', 1, 10)}
          <div className="visual-timeline" aria-label="请求时间线">
            <div style={{ flex: wait }} className="waiting">
              等待 {wait} ms
            </div>
            <div style={{ flex: 100 }}>输出 100 ms</div>
          </div>
          <div className="visual-tokens">
            {[0, 30, 65, 100].map((v, i) => (
              <span key={v}>
                T{i + 1}
                <b>{wait + v} ms</b>
              </span>
            ))}
          </div>
          <Bars
            rows={[
              { label: 'TTFT', value: wait, unit: 'ms' },
              { label: 'TPOT', value: 100 / 3, unit: 'ms' },
            ]}
            max={500}
          />
          <small>4 token / 3 间隔；拖动等待，TPOT 不变。</small>
        </>
      );
      break;
    }
    case 'roofline': {
      const power = Math.max(1, value);
      body = (
        <>
          {slider('计算能力倍率', 1, 8)}
          <Bars
            rows={[
              { label: '计算下界', value: 4 / power, unit: 'ms' },
              { label: '搬运下界', value: 2, unit: 'ms' },
            ]}
            max={4}
          />
          <div className="visual-result">
            总下界 {Math.max(4 / power, 2)} ms
            <span>取较大值；假设可充分重叠</span>
          </div>
        </>
      );
      break;
    }
    case 'profiling': {
      body = (
        <>
          {switcher('加入设备完成同步', '去掉同步')}
          <div className="visual-trace">
            <div>
              <span>CPU</span>
              <b className="submit">提交 0.1 ms</b>
              {toggle && <b className="wait">等待 GPU</b>}
            </div>
            <div>
              <span>GPU</span>
              <b className="compute">执行 5 ms</b>
            </div>
          </div>
          <div className="visual-result">
            计时覆盖 {toggle ? '约 5.1' : '约 0.1'} ms
            <span>
              {toggle ? '等待设备完成后停止计时' : '只量到了提交'} · 串行示意
            </span>
          </div>
        </>
      );
      break;
    }
    case 'request-path': {
      const labels = ['输入', '入队', '分配预算', '模型执行', '输出 / 回收'];
      body = (
        <>
          <div className="visual-pipeline">
            {labels.map((label, i) => (
              <button
                key={label}
                aria-pressed={position === i}
                onClick={() => setPosition(i)}
              >
                <span>{i + 1}</span>
                {label}
              </button>
            ))}
          </div>
          <div className="visual-result">
            {
              [
                '文本 → token IDs',
                '请求等待执行机会',
                'Scheduler 决定本轮 token 数',
                'Runner 组织张量并计算',
                '继续生成，或完成后释放 KV',
              ][position]
            }
          </div>
          <button
            className="button secondary"
            onClick={() => setPosition((position + 1) % labels.length)}
          >
            让请求前进一步 →
          </button>
        </>
      );
      break;
    }
    case 'scheduling': {
      const chunks = [128, 256, 512, 1024, 2048],
        chunk = chunks[Math.min(4, value)],
        steps = Math.ceil(2048 / chunk);
      const first = 0.4 + chunk * 0.02 + 1;
      const end = 2048 * 0.02 + steps * 0.4 + Math.min(steps - 1, 16);
      body = (
        <>
          {slider('chunk 档位（128 → 2048）', 0, 4)}
          <div className="visual-timeline">
            <div className="waiting">prefill {chunk} token</div>
            <div>decode</div>
          </div>
          <Bars
            rows={[
              { label: '首次 decode', value: first, unit: 'ms' },
              { label: 'prefill 完成', value: end, unit: 'ms' },
            ]}
            max={70}
          />
          <small>每轮先 prefill 再 decode；固定成本教学模型。</small>
        </>
      );
      break;
    }
    case 'gpu-memory': {
      body = (
        <>
          {switcher('打开边界 mask', '关闭边界 mask')}
          <div className="visual-memory-grid">
            {Array.from({ length: 32 }, (_, i) => (
              <span
                key={i}
                className={i < 8 ? 'valid' : toggle ? 'masked' : 'invalid'}
              >
                {992 + i}
              </span>
            ))}
          </div>
          <div className="visual-result">
            {toggle ? '8 个有效位置允许读写' : '24 个位置存在越界风险'}
            <span>最后一组的末 32 项 · N=1000 · 淡色斜线为屏蔽</span>
          </div>
        </>
      );
      break;
    }
    case 'softmax': {
      const denom = 2 * Math.exp(-2) + (toggle ? 0 : 1);
      const valid = Math.exp(-2) / denom;
      body = (
        <>
          {switcher('把补齐值从 0 改为 −∞', '把补齐值从 −∞ 改为 0')}
          <Bars
            rows={[
              { label: '有效项 1', value: valid * 100, unit: '%' },
              { label: '有效项 2', value: valid * 100, unit: '%' },
              {
                label: '补齐项',
                value: toggle ? 0 : 100 - valid * 200,
                unit: '%',
              },
            ]}
            max={100}
          />
          <div className="visual-result">
            有效输出之和：{(valid * 2).toFixed(3)}
            <span>两个有效分数均为 −2</span>
          </div>
        </>
      );
      break;
    }
    case 'attention-kernels': {
      const percent = value * 10;
      body = (
        <>
          {slider('热点占比档位（每档 10%）', 1, 9)}
          <div className="visual-timeline">
            <div className="waiting" style={{ flex: 100 - percent }}>
              其他 {100 - percent}%
            </div>
            <div style={{ flex: percent }}>热点 {percent}%</div>
          </div>
          <Bars
            rows={[
              { label: '优化前', value: 100, unit: 'ms' },
              { label: '热点快 2 倍后', value: 100 - percent / 2, unit: 'ms' },
            ]}
            max={100}
          />
          <div className="visual-result">
            整体 {(100 / (100 - percent / 2)).toFixed(3)} 倍
            <span>其他工作不变</span>
          </div>
        </>
      );
      break;
    }
    case 'parallel': {
      body = (
        <>
          {switcher('当前：沿输入维切分 · 切换', '当前：沿输出维切分 · 切换')}
          <div className="visual-gpus">
            <div>
              GPU 0<strong>{toggle ? '5' : '[1,3]'}</strong>
            </div>
            <div>
              GPU 1<strong>{toggle ? '11' : '[4,8]'}</strong>
            </div>
          </div>
          <div className="visual-merge">
            ↓ {toggle ? '拼接输出列' : '对应元素相加'} ↓
          </div>
          <div className="visual-result">
            [5,11]<span>x=[1,2]，W=[[1,3],[2,4]]</span>
          </div>
        </>
      );
      break;
    }
    case 'moe': {
      const busy = Math.max(1, value) * 100;
      body = (
        <>
          {slider('第 4 张卡负载档位（每档 100）', 1, 7)}
          <Bars
            rows={[100, 100, 100, busy].map((n, i) => ({
              label: `rank ${i}`,
              value: n,
              unit: '分配',
            }))}
            max={700}
          />
          <div className="visual-result">
            最忙 {busy} / 平均 {(300 + busy) / 4}
            <span>同步可能等待最忙者 · 简化负载示例</span>
          </div>
        </>
      );
      break;
    }
    case 'speculation': {
      const verify = Math.max(1, value) * 5;
      body = (
        <>
          {slider('验证耗时档位（每档 5 ms）', 1, 10)}
          <Bars
            rows={[
              { label: '普通解码等量工作', value: 33.616, unit: 'ms' },
              { label: '候选 + 验证', value: 3 + verify, unit: 'ms' },
            ]}
            max={55}
          />
          <div className="visual-result">
            {(33.616 / (3 + verify)).toFixed(2)} 倍
            <span>k=4、a=0.8、每轮额外 1 token；候选 3 ms</span>
          </div>
        </>
      );
      break;
    }
    case 'hypothesis': {
      body = (
        <>
          {switcher('再看其他轮次', '只看第一轮')}
          <Bars
            rows={(toggle ? [100, 97, 96, 102, 104, 99] : [100, 97]).map(
              (n, i) => ({
                label: `${i % 2 ? '候选 B' : '基线 A'} · ${Math.floor(i / 2) + 1}`,
                value: n,
                unit: 'ms',
              }),
            )}
            max={110}
          />
          <div className="visual-result">
            {toggle ? 'B 并非每轮都更快' : '单轮看起来快 3%'}
            <span>虚构数据；多轮交错比较，避免挑最好的一次</span>
          </div>
        </>
      );
      break;
    }
    case 'patch': {
      const cap = value * 64;
      const grant = Math.min(2048, 504, cap || 2048);
      body = (
        <>
          {slider('prefill cap 档位（每档 64，0=关闭限制）', 0, 10)}
          <Bars
            rows={[
              { label: 'decode 预留', value: 8, unit: 'token' },
              { label: 'prefill 分配', value: grant, unit: 'token' },
              { label: '剩余可用', value: 504 - grant, unit: 'token' },
            ]}
            max={512}
          />
          <div className="visual-result">
            8 + {grant} + {504 - grant} = 512
            <span>remaining=2048；预算不被突破</span>
          </div>
        </>
      );
      break;
    }
    case 'capstone': {
      const limit = 1 + value * 0.1;
      body = (
        <>
          {slider('长请求上限档位（1.0 s + 每档 0.1 s）', 0, 10)}
          <Bars
            rows={[
              { label: '预设上限', value: limit, unit: 's' },
              { label: '候选结果', value: 1.5, unit: 's' },
            ]}
            max={2}
          />
          <div className="visual-result">
            {1.5 <= limit ? '这一项达到上限要求' : '这一项未通过'}
            <span>
              虚构候选数据；正式实验必须事先确定上限，不可事后移动门槛
            </span>
          </div>
        </>
      );
      break;
    }
  }
  return (
    <div className="concept-visual" aria-label="可操作的概念图">
      {body}
    </div>
  );
}
