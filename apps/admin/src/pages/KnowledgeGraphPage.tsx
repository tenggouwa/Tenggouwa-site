import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Input, Message, Space, Table, Tag, Tabs, Typography } from '@arco-design/web-react';
import { http } from '../lib/api';
import type { GraphEdge, GraphFull, GraphReview } from '../lib/types';

function fmt(value: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
}

function ReviewTag({ status }: { status: GraphReview['status'] }) {
  const color = status === 'applied' ? 'green' : status === 'rejected' ? 'gray' : 'orange';
  const label = status === 'applied' ? '已生效' : status === 'rejected' ? '已驳回' : '待审核';
  return <Tag color={color}>{label}</Tag>;
}

export default function KnowledgeGraphPage() {
  const [graph, setGraph] = useState<GraphFull | null>(null);
  const [reviews, setReviews] = useState<GraphReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityId, setEntityId] = useState('');
  const [entityName, setEntityName] = useState('');
  const [relationId, setRelationId] = useState('');
  const [note, setNote] = useState('');

  const names = useMemo(() => new Map(graph?.nodes.map((node) => [node.id, node.name]) ?? []), [graph]);

  async function load() {
    setLoading(true);
    try {
      const [full, history] = await Promise.all([
        http.get('/api/public/kb/graph/full') as Promise<GraphFull>,
        http.get('/api/admin/kb/graph/reviews') as Promise<GraphReview[]>,
      ]);
      setGraph(full);
      setReviews(history);
    } catch {
      Message.error('图谱数据加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function propose(payload: Record<string, unknown>) {
    try {
      await http.post('/api/admin/kb/graph/reviews', payload);
      Message.success('已提交审核提案');
      setNote('');
      await load();
    } catch {
      // axios interceptor already gives the specific API message.
    }
  }

  async function resolve(id: number, decision: 'approve' | 'reject') {
    try {
      await http.post(`/api/admin/kb/graph/reviews/${id}/resolve`, { decision });
      Message.success(decision === 'approve' ? '审核已通过并生效' : '审核已驳回');
      await load();
    } catch {
      // axios interceptor already gives the specific API message.
    }
  }

  const relationRows = (graph?.edges ?? []).map((edge: GraphEdge) => ({
    ...edge,
    sourceName: names.get(edge.source) ?? `#${edge.source}`,
    targetName: names.get(edge.target) ?? `#${edge.target}`,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">知识图谱审核</h2>
          <p className="text-sm text-gray-500">所有纠错先留审计提案；批准后才会影响公开图谱与 Agent 查询。</p>
        </div>
        <Button loading={loading} onClick={load}>刷新</Button>
      </div>

      <Tabs defaultActiveTab="review">
        <Tabs.TabPane key="review" title={`审核队列 (${reviews.filter((item) => item.status === 'pending').length})`}>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
            <Card title="实体改名提案">
              <Space direction="vertical" className="w-full">
                <Input value={entityId} onChange={setEntityId} placeholder="实体 ID（下方节点表可查）" />
                <Input value={entityName} onChange={setEntityName} placeholder="新的展示名称" />
                <Input.TextArea value={note} onChange={setNote} placeholder="纠错依据（可选）" autoSize={{ minRows: 2, maxRows: 4 }} />
                <Button
                  type="primary"
                  disabled={!/^\d+$/.test(entityId) || !entityName.trim()}
                  onClick={() => propose({ target_kind: 'entity', target_id: Number(entityId), action: 'rename_entity', payload: { name: entityName.trim() }, note })}
                >
                  提交实体改名
                </Button>
              </Space>
            </Card>
            <Card title="错误关系下线提案">
              <Space direction="vertical" className="w-full">
                <Input value={relationId} onChange={setRelationId} placeholder="关系 ID（下方关系表可查）" />
                <Input.TextArea value={note} onChange={setNote} placeholder="为何这条关系错误（建议填写）" autoSize={{ minRows: 2, maxRows: 4 }} />
                <Button
                  status="danger"
                  disabled={!/^\d+$/.test(relationId)}
                  onClick={() => propose({ target_kind: 'relation', target_id: Number(relationId), action: 'disable_relation', payload: {}, note })}
                >
                  提交关系下线
                </Button>
              </Space>
            </Card>
          </div>
          <Card className="mt-4" title="审核记录">
            <Table
              loading={loading}
              rowKey="id"
              pagination={{ pageSize: 10, sizeCanChange: false }}
              data={reviews}
              columns={[
                { title: '状态', dataIndex: 'status', render: (status: GraphReview['status']) => <ReviewTag status={status} /> },
                { title: '动作', dataIndex: 'action' },
                { title: '目标', render: (_, row: GraphReview) => `${row.target_kind} #${row.target_id}` },
                { title: '内容', render: (_, row: GraphReview) => row.payload.name ?? row.note ?? '—' },
                { title: '提交时间', dataIndex: 'created_at', render: fmt },
                {
                  title: '处理',
                  render: (_, row: GraphReview) => row.status === 'pending' ? (
                    <Space><Button size="mini" type="primary" onClick={() => resolve(row.id, 'approve')}>通过</Button><Button size="mini" onClick={() => resolve(row.id, 'reject')}>驳回</Button></Space>
                  ) : row.resolved_by ?? '—',
                },
              ]}
            />
          </Card>
        </Tabs.TabPane>
        <Tabs.TabPane key="catalogue" title="图谱目录">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
            <Card title={`实体 (${graph?.nodes.length ?? 0})`}>
              <Table loading={loading} size="small" rowKey="id" pagination={{ pageSize: 8, sizeCanChange: false }} data={graph?.nodes ?? []} columns={[
                { title: 'ID', dataIndex: 'id', width: 70 }, { title: '名称', dataIndex: 'name' }, { title: '类型', dataIndex: 'type' }, { title: '关系', dataIndex: 'deg', width: 70 },
              ]} />
            </Card>
            <Card title={`关系 (${graph?.edges.length ?? 0})`}>
              <Table loading={loading} size="small" rowKey="id" pagination={{ pageSize: 8, sizeCanChange: false }} data={relationRows} columns={[
                { title: 'ID', dataIndex: 'id', width: 70 }, { title: '起点', dataIndex: 'sourceName' }, { title: '关系', dataIndex: 'type' }, { title: '终点', dataIndex: 'targetName' },
              ]} />
            </Card>
          </div>
        </Tabs.TabPane>
      </Tabs>
      <Typography.Paragraph type="secondary" className="text-xs mb-0">已下线关系保留原始溯源和审核记录，不会被删除；后续重新抽取不会自动恢复。</Typography.Paragraph>
    </div>
  );
}
