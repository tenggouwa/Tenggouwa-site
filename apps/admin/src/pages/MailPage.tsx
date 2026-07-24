import { useState } from 'react';
import { Button, Input, Message, Space, Table, Tag, Typography } from '@arco-design/web-react';
import { http } from '../lib/api';
import type { MailLatestCode, MailMessageItem } from '../lib/types';

// 收信域名：*@MAIL_DOMAIN 都会进一次性收件箱（CF Email Routing catch-all）。
const MAIL_DOMAIN = 'tenggouwa.com';

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    Message.success('已复制');
  } catch {
    Message.error('复制失败，请手动选中');
  }
}

function fmt(ts: string | null): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

export default function MailPage() {
  const [mailbox, setMailbox] = useState('');
  const [messages, setMessages] = useState<MailMessageItem[]>([]);
  const [latest, setLatest] = useState<MailLatestCode | null>(null);
  const [loading, setLoading] = useState(false);
  const [waiting, setWaiting] = useState(false);

  const box = mailbox.trim().toLowerCase();

  async function loadMessages() {
    if (!box) {
      Message.warning('先填收件箱名（@ 前那段）');
      return;
    }
    setLoading(true);
    try {
      const data = (await http.get(
        `/api/admin/mail/${encodeURIComponent(box)}/messages?limit=50`,
      )) as unknown as MailMessageItem[];
      setMessages(data);
      const firstWithCode = data.find((m) => m.code);
      setLatest(
        firstWithCode
          ? {
              code: firstWithCode.code,
              message_id: null,
              subject: firstWithCode.subject,
              received_at: firstWithCode.received_at,
            }
          : null,
      );
    } finally {
      setLoading(false);
    }
  }

  // 只等「点击之后」到达的新码：since=now，最多等 25s
  async function waitForCode() {
    if (!box) {
      Message.warning('先填收件箱名（@ 前那段）');
      return;
    }
    setWaiting(true);
    const since = new Date().toISOString();
    try {
      const data = (await http.get(
        `/api/admin/mail/${encodeURIComponent(box)}/latest-code?wait=25&since=${encodeURIComponent(since)}`,
      )) as unknown as MailLatestCode;
      if (data.code) {
        setLatest(data);
        Message.success('收到新验证码');
        loadMessages();
      } else {
        Message.info('25 秒内没等到新验证码');
      }
    } finally {
      setWaiting(false);
    }
  }

  const columns = [
    { title: '时间', dataIndex: 'received_at', width: 180, render: (v: string) => fmt(v) },
    {
      title: '发件人',
      dataIndex: 'from_address',
      ellipsis: true,
      render: (v: string | null) => v ?? '-',
    },
    { title: '主题', dataIndex: 'subject', ellipsis: true, render: (v: string | null) => v ?? '-' },
    {
      title: '验证码',
      dataIndex: 'code',
      width: 160,
      render: (v: string | null) =>
        v ? (
          <Space>
            <Tag color="green" style={{ fontFamily: 'monospace', fontSize: 14 }}>
              {v}
            </Tag>
            <Button size="mini" onClick={() => copy(v)}>
              复制
            </Button>
          </Space>
        ) : (
          <span className="text-gray-400">-</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold">一次性收件箱 · 接码</h2>
      </div>

      <Space wrap>
        <Input
          style={{ width: 320 }}
          value={mailbox}
          onChange={setMailbox}
          onPressEnter={loadMessages}
          placeholder="收件箱名（@ 前那段），如 netflix"
          addAfter={`@${MAIL_DOMAIN}`}
          allowClear
        />
        <Button type="primary" loading={loading} onClick={loadMessages}>
          查收件箱
        </Button>
        <Button loading={waiting} onClick={waitForCode}>
          等新验证码（25s）
        </Button>
      </Space>

      {latest?.code && (
        <div className="rounded border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-4">
          <div>
            <div className="text-xs text-gray-500">最近验证码</div>
            <div className="text-2xl font-mono font-bold tracking-widest text-green-700">
              {latest.code}
            </div>
          </div>
          <Button size="small" type="primary" onClick={() => copy(latest.code!)}>
            复制
          </Button>
          <Typography.Text type="secondary" className="text-xs">
            {latest.subject ?? ''} · {fmt(latest.received_at)}
          </Typography.Text>
        </div>
      )}

      <Table
        rowKey="id"
        loading={loading}
        data={messages}
        columns={columns}
        pagination={false}
        noDataElement={<div className="py-8 text-gray-400">填收件箱名后点「查收件箱」</div>}
      />
    </div>
  );
}
