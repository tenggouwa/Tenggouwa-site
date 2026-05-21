import { useEffect, useState } from 'react';
import { Card, Radio, Spin, Statistic, Table, Tag } from '@arco-design/web-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { http } from '../lib/api';
import type {
  AnalyticsOverview,
  CountryStat,
  DeviceStats,
  TopPage,
  TopReferrer,
} from '../lib/types';

const RANGES = [
  { label: '7 天', value: 7 },
  { label: '30 天', value: 30 },
  { label: '90 天', value: 90 },
];

const PIE_COLORS = ['#5af78e', '#57c7ff', '#ff6ac1', '#f3f99d', '#8a9199', '#a78bfa', '#fbbf24'];

interface Bundle {
  overview: AnalyticsOverview;
  topPages: TopPage[];
  topRefs: TopReferrer[];
  countries: CountryStat[];
  devices: DeviceStats;
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Bundle | null>(null);

  useEffect(() => {
    setData(null);
    Promise.all([
      http.get(`/api/admin/analytics/overview?days=${days}`) as unknown as Promise<AnalyticsOverview>,
      http.get(`/api/admin/analytics/top-pages?days=${days}&limit=10`) as unknown as Promise<TopPage[]>,
      http.get(`/api/admin/analytics/top-referrers?days=${days}&limit=10`) as unknown as Promise<TopReferrer[]>,
      http.get(`/api/admin/analytics/countries?days=${days}&limit=20`) as unknown as Promise<CountryStat[]>,
      http.get(`/api/admin/analytics/devices?days=${days}`) as unknown as Promise<DeviceStats>,
    ]).then(([overview, topPages, topRefs, countries, devices]) => {
      setData({ overview, topPages, topRefs, countries, devices });
    });
  }, [days]);

  if (!data) {
    return (
      <div className="py-20 text-center">
        <Spin tip="加载分析数据..." />
      </div>
    );
  }
  const { overview, topPages, topRefs, countries, devices } = data;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold">站点分析</h2>
        <Radio.Group
          type="button"
          value={days}
          onChange={setDays}
          options={RANGES}
        />
      </div>

      {/* 顶部 4 个 KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <Statistic title="今日 PV" value={overview.pv_today} groupSeparator />
        </Card>
        <Card>
          <Statistic title="今日 UV" value={overview.uv_today} groupSeparator />
        </Card>
        <Card>
          <Statistic title={`累计 PV`} value={overview.pv_total} groupSeparator />
        </Card>
        <Card>
          <Statistic title={`累计 UV`} value={overview.uv_total} groupSeparator />
        </Card>
      </div>

      {/* 每日趋势 */}
      <Card title={`每日 PV / UV (${days} 天)`}>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <AreaChart data={overview.daily} margin={{ left: 0, right: 16, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="pvFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#57c7ff" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#57c7ff" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="uvFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5af78e" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#5af78e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e5e6eb" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Area type="monotone" dataKey="pv" name="PV" stroke="#57c7ff" fill="url(#pvFill)" strokeWidth={2} />
              <Area type="monotone" dataKey="uv" name="UV" stroke="#5af78e" fill="url(#uvFill)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Top 页面 + Top 来源 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Top 页面">
          <Table
            rowKey="path"
            size="small"
            pagination={false}
            data={topPages}
            columns={[
              {
                title: 'Path',
                dataIndex: 'path',
                render: (v: string) => <code className="text-xs">{v}</code>,
              },
              { title: 'PV', dataIndex: 'pv', width: 80, align: 'right' as const },
              { title: 'UV', dataIndex: 'uv', width: 80, align: 'right' as const },
            ]}
          />
        </Card>
        <Card title="Top 来源">
          <Table
            rowKey="referrer"
            size="small"
            pagination={false}
            data={topRefs}
            columns={[
              {
                title: 'Referrer',
                dataIndex: 'referrer',
                render: (v: string) =>
                  v === '(direct)' ? (
                    <Tag color="gray">(direct)</Tag>
                  ) : (
                    <span className="text-xs break-all">{v}</span>
                  ),
              },
              { title: 'PV', dataIndex: 'pv', width: 80, align: 'right' as const },
            ]}
          />
        </Card>
      </div>

      {/* 国家 + 设备 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="国家分布（CF-IPCountry）">
          <Table
            rowKey="country"
            size="small"
            pagination={false}
            data={countries}
            columns={[
              {
                title: '国家',
                dataIndex: 'country',
                render: (c: string) => (
                  <span>
                    {c === '?' ? '未知' : c} {c !== '?' && countryFlag(c)}
                  </span>
                ),
              },
              { title: 'PV', dataIndex: 'pv', width: 80, align: 'right' as const },
            ]}
          />
        </Card>

        <Card
          title={`设备分布 (移动端占比 ${(devices.mobile_ratio * 100).toFixed(0)}%)`}
        >
          <div className="grid grid-cols-2 gap-2">
            <DevicePie title="浏览器" data={devices.browsers} />
            <DevicePie title="操作系统" data={devices.os} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function DevicePie({ title, data }: { title: string; data: { name: string; pv: number }[] }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1 text-center">{title}</div>
      <div style={{ width: '100%', height: 180 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="pv" nameKey="name" outerRadius={60} label>
              {data.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function countryFlag(code: string): string {
  // 两位 ISO 国家码 → emoji flag
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 - 65 + c.charCodeAt(0)));
}
