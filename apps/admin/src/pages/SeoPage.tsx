import { useEffect, useState } from 'react';
import { Card, Empty, Radio, Spin, Statistic, Tabs, Table, Tag } from '@arco-design/web-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { http } from '../lib/api';
import type {
  IndexingStatus,
  KeywordStat,
  SearchChannelOverview,
  VitalsMetricSummary,
  VitalsOverview,
} from '../lib/types';

const RANGES = [
  { label: '7 天', value: 7 },
  { label: '30 天', value: 30 },
  { label: '90 天', value: 90 },
];

const CHANNELS = [
  { label: 'Google', value: 'google' },
  { label: 'Bing', value: 'bing' },
  { label: '百度', value: 'baidu' },
];

// Web Vitals 阈值（Google 推荐）
const VITALS_THRESHOLD: Record<string, { good: number; poor: number; unit: string; better: 'low' }> = {
  LCP: { good: 2500, poor: 4000, unit: 'ms', better: 'low' },
  INP: { good: 200, poor: 500, unit: 'ms', better: 'low' },
  CLS: { good: 0.1, poor: 0.25, unit: '', better: 'low' },
  FCP: { good: 1800, poor: 3000, unit: 'ms', better: 'low' },
  TTFB: { good: 800, poor: 1800, unit: 'ms', better: 'low' },
};

export default function SeoPage() {
  const [days, setDays] = useState(30);
  const [channel, setChannel] = useState<'google' | 'bing' | 'baidu'>('google');

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold">SEO 监控</h2>
        <Radio.Group type="button" value={days} onChange={setDays} options={RANGES} />
      </div>

      <Tabs defaultActiveTab="vitals" type="rounded">
        <Tabs.TabPane key="vitals" title="Web Vitals">
          <VitalsPanel days={days} />
        </Tabs.TabPane>
        <Tabs.TabPane key="search" title="搜索表现">
          <SearchPanel days={days} channel={channel} setChannel={setChannel} />
        </Tabs.TabPane>
        <Tabs.TabPane key="keywords" title="关键词">
          <KeywordsPanel days={days} channel={channel} setChannel={setChannel} />
        </Tabs.TabPane>
        <Tabs.TabPane key="indexing" title="收录状态">
          <IndexingPanel days={days} />
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
}

// ---------- Web Vitals ----------

function VitalsPanel({ days }: { days: number }) {
  const [data, setData] = useState<VitalsOverview | null>(null);

  useEffect(() => {
    setData(null);
    http.get(`/api/admin/seo/vitals?days=${days}`).then((d) => setData(d as unknown as VitalsOverview));
  }, [days]);

  if (!data) return <Spin tip="加载 Web Vitals..." />;

  if (data.samples_total === 0) {
    return (
      <Empty
        description={
          <div>
            <div>暂无真实用户性能上报</div>
            <div className="text-xs text-gray-500 mt-2">
              前端集成 web-vitals 后，访问 prod 站点会自动上报；本地 dev 不上报
            </div>
          </div>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {(['LCP', 'INP', 'CLS', 'FCP', 'TTFB'] as const).map((m) => {
          const summary = data.by_metric.find((x) => x.metric === m);
          return <VitalCard key={m} metric={m} data={summary} />;
        })}
      </div>

      <Card title={`p75 趋势（${days} 天）`}>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={data.trend} margin={{ left: 0, right: 16, top: 8, bottom: 0 }}>
              <CartesianGrid stroke="#e5e6eb" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis yAxisId="ms" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="cls" orientation="right" tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Line yAxisId="ms" type="monotone" dataKey="p75_lcp" name="LCP (ms)" stroke="#57c7ff" strokeWidth={2} dot={false} />
              <Line yAxisId="ms" type="monotone" dataKey="p75_inp" name="INP (ms)" stroke="#ff6ac1" strokeWidth={2} dot={false} />
              <Line yAxisId="cls" type="monotone" dataKey="p75_cls" name="CLS" stroke="#5af78e" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="text-xs text-gray-500">
        总样本：{data.samples_total.toLocaleString()} · 移动端占比{' '}
        {(data.mobile_ratio * 100).toFixed(0)}%
      </div>
    </div>
  );
}

function VitalCard({ metric, data }: { metric: string; data: VitalsMetricSummary | undefined }) {
  const th = VITALS_THRESHOLD[metric];
  if (!data) {
    return (
      <Card>
        <Statistic title={metric} value="—" />
        <div className="text-xs text-gray-400 mt-1">无样本</div>
      </Card>
    );
  }
  const value = data.p75;
  let color: 'green' | 'orange' | 'red' = 'green';
  if (value > th.poor) color = 'red';
  else if (value > th.good) color = 'orange';
  const display = metric === 'CLS' ? value.toFixed(3) : `${Math.round(value)}${th.unit}`;
  return (
    <Card>
      <Statistic title={`${metric} (p75)`} value={display} />
      <div className="mt-1 flex items-center gap-2">
        <Tag color={color} size="small">
          {color === 'green' ? 'good' : color === 'orange' ? 'needs improvement' : 'poor'}
        </Tag>
        <span className="text-xs text-gray-500">
          good {(data.good_ratio * 100).toFixed(0)}% · {data.samples.toLocaleString()}
        </span>
      </div>
    </Card>
  );
}

// ---------- 搜索表现 ----------

function SearchPanel({
  days,
  channel,
  setChannel,
}: {
  days: number;
  channel: 'google' | 'bing' | 'baidu';
  setChannel: (c: 'google' | 'bing' | 'baidu') => void;
}) {
  const [data, setData] = useState<SearchChannelOverview | null>(null);

  useEffect(() => {
    setData(null);
    http
      .get(`/api/admin/seo/search?channel=${channel}&days=${days}`)
      .then((d) => setData(d as unknown as SearchChannelOverview));
  }, [days, channel]);

  return (
    <div className="space-y-4">
      <Radio.Group type="button" value={channel} onChange={setChannel} options={CHANNELS} />
      {!data ? (
        <Spin tip="加载搜索数据..." />
      ) : data.snapshot_date == null ? (
        <Empty
          description={
            <div>
              <div>暂无 {channel} 搜索数据</div>
              <div className="text-xs text-gray-500 mt-2">
                需要先在 Search Console / 百度站长配好 API 鉴权，定时任务会每日拉取
              </div>
            </div>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <Statistic title="展示" value={data.impressions_total} groupSeparator />
            </Card>
            <Card>
              <Statistic title="点击" value={data.clicks_total} groupSeparator />
            </Card>
            <Card>
              <Statistic
                title="CTR"
                value={`${(data.ctr_avg * 100).toFixed(2)}%`}
              />
            </Card>
            <Card>
              <Statistic title="平均排名" value={data.position_avg.toFixed(1)} />
            </Card>
          </div>
          <Card title={`Top URLs · ${data.snapshot_date}`}>
            <Table
              rowKey="url"
              size="small"
              pagination={false}
              data={data.top_urls}
              columns={[
                {
                  title: 'URL',
                  dataIndex: 'url',
                  render: (v: string) => <code className="text-xs">{v}</code>,
                },
                { title: '展示', dataIndex: 'impressions', width: 80, align: 'right' as const },
                { title: '点击', dataIndex: 'clicks', width: 80, align: 'right' as const },
                {
                  title: 'CTR',
                  dataIndex: 'ctr',
                  width: 80,
                  align: 'right' as const,
                  render: (v: number) => `${(v * 100).toFixed(1)}%`,
                },
                {
                  title: '排名',
                  dataIndex: 'position',
                  width: 80,
                  align: 'right' as const,
                  render: (v: number) => v.toFixed(1),
                },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}

// ---------- 关键词 ----------

function KeywordsPanel({
  days,
  channel,
  setChannel,
}: {
  days: number;
  channel: 'google' | 'bing' | 'baidu';
  setChannel: (c: 'google' | 'bing' | 'baidu') => void;
}) {
  const [data, setData] = useState<KeywordStat[] | null>(null);

  useEffect(() => {
    setData(null);
    http
      .get(`/api/admin/seo/keywords?channel=${channel}&days=${days}&limit=50`)
      .then((d) => setData(d as unknown as KeywordStat[]));
  }, [days, channel]);

  return (
    <div className="space-y-4">
      <Radio.Group type="button" value={channel} onChange={setChannel} options={CHANNELS} />
      {!data ? (
        <Spin tip="加载关键词..." />
      ) : data.length === 0 ? (
        <Empty description="暂无关键词数据（等 GSC / 百度 数据接入）" />
      ) : (
        <Card>
          <Table
            rowKey="query"
            size="small"
            pagination={{ pageSize: 20, hideOnSinglePage: true }}
            data={data}
            columns={[
              { title: '关键词', dataIndex: 'query' },
              {
                title: '出现次数',
                dataIndex: 'occurrences',
                width: 120,
                align: 'right' as const,
              },
            ]}
          />
        </Card>
      )}
    </div>
  );
}

// ---------- 收录状态 ----------

function IndexingPanel({ days }: { days: number }) {
  const [data, setData] = useState<IndexingStatus[] | null>(null);

  useEffect(() => {
    setData(null);
    http
      .get(`/api/admin/seo/indexing?days=${days}`)
      .then((d) => setData(d as unknown as IndexingStatus[]));
  }, [days]);

  if (!data) return <Spin tip="加载收录状态..." />;
  if (data.length === 0) return <Empty description="暂无收录数据（等 GSC / 百度 数据接入）" />;

  return (
    <Card>
      <Table
        rowKey="url"
        size="small"
        pagination={{ pageSize: 30, hideOnSinglePage: true }}
        data={data}
        columns={[
          {
            title: 'URL',
            dataIndex: 'url',
            render: (v: string) => <code className="text-xs">{v}</code>,
          },
          {
            title: 'Google',
            dataIndex: 'google_indexed',
            width: 100,
            render: (v: boolean) =>
              v ? <Tag color="green">已收录</Tag> : <Tag color="gray">未收录</Tag>,
          },
          {
            title: 'Bing',
            dataIndex: 'bing_indexed',
            width: 100,
            render: (v: boolean) =>
              v ? <Tag color="green">已收录</Tag> : <Tag color="gray">未收录</Tag>,
          },
          {
            title: '百度',
            dataIndex: 'baidu_indexed',
            width: 100,
            render: (v: boolean) =>
              v ? <Tag color="green">已收录</Tag> : <Tag color="gray">未收录</Tag>,
          },
          { title: '最近检查', dataIndex: 'last_checked', width: 120 },
        ]}
      />
    </Card>
  );
}
