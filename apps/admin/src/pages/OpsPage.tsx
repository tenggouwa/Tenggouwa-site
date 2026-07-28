import { useEffect, useState } from 'react';
import { Button, Card, Descriptions, Spin, Statistic, Tag } from '@arco-design/web-react';
import { http } from '../lib/api';
import type { OpsOverview, OpsScheduler } from '../lib/types';

function fmt(ts: string | null): string {
  return ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '—';
}

function StateTag({ ok, children }: { ok: boolean; children: string }) {
  return <Tag color={ok ? 'green' : 'orangered'}>{children}</Tag>;
}

function SchedulerCard({ title, scheduler }: { title: string; scheduler: OpsScheduler }) {
  return (
    <Card title={title} extra={<StateTag ok={scheduler.running}>{scheduler.running ? '运行中' : '未运行'}</StateTag>}>
      {scheduler.jobs.length === 0 ? (
        <span className="text-sm text-gray-400">未登记任务</span>
      ) : (
        <Descriptions
          column={1}
          size="small"
          layout="inline-horizontal"
          data={scheduler.jobs.map((job) => ({ label: <code>{job.id}</code>, value: `下次：${fmt(job.next_run)}` }))}
        />
      )}
    </Card>
  );
}

export default function OpsPage() {
  const [data, setData] = useState<OpsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = (await http.get('/api/admin/ops/overview')) as unknown as OpsOverview;
      setData(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载运行状态失败';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading && !data) {
    return <div className="py-20 text-center"><Spin tip="读取运行状态..." /></div>;
  }

  if (error && !data) {
    return (
      <div className="py-20 text-center space-y-3" role="alert">
        <p className="text-red-600">{error}</p>
        <Button type="primary" onClick={load}>重试</Button>
      </div>
    );
  }

  if (!data) return null;
  const healthy = data.agent_scheduler.running && data.mail_scheduler.running && data.pi.online;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="text-lg font-bold">运行状态</h2>
          <p className="text-sm text-gray-500">仅展示安全摘要；不含配置、密钥、邮件或对话内容。</p>
        </div>
        <Button loading={loading} onClick={load}>刷新</Button>
      </div>

      <Card>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Statistic title="运行环境" value={data.environment} />
          <Statistic title="数据库 Revision" value={data.alembic_revision ?? '未知'} />
          <Statistic title="MCP 已连接" value={data.mcp.connected.length} suffix={`/ ${data.mcp.configured}`} />
          <div>
            <div className="text-sm text-gray-500 mb-2">总体状态</div>
            <StateTag ok={healthy}>{healthy ? '核心服务正常' : '需要关注'}</StateTag>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SchedulerCard title="Agent Scheduler" scheduler={data.agent_scheduler} />
        <SchedulerCard title="Mail Scheduler" scheduler={data.mail_scheduler} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Pi 节点" extra={<StateTag ok={data.pi.online}>{data.pi.online ? '在线' : '离线'}</StateTag>}>
          <Descriptions
            column={1}
            size="small"
            layout="inline-horizontal"
            data={[
              { label: '最后上报', value: fmt(data.pi.last_seen) },
              { label: '延迟', value: data.pi.age_seconds === null ? '—' : `${data.pi.age_seconds}s` },
            ]}
          />
        </Card>
        <Card title="MCP Bridge">
          <Descriptions
            column={1}
            size="small"
            layout="inline-horizontal"
            data={[
              { label: '已暴露工具', value: data.mcp.tool_count },
              { label: '已连接服务', value: data.mcp.connected.join(', ') || '—' },
            ]}
          />
        </Card>
      </div>

      {error && <p className="text-sm text-orange-600" role="alert">刷新失败，当前显示上次成功数据：{error}</p>}
    </div>
  );
}
