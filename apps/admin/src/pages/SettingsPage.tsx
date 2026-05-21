import { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Message, Popconfirm, Tag } from '@arco-design/web-react';
import { QRCodeSVG } from 'qrcode.react';
import { http } from '../lib/api';
import type {
  TotpEnrollStartResp,
  TotpStatusResp,
} from '../lib/types';

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">站点设置</h2>
      <TotpSection />
    </div>
  );
}

function TotpSection() {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [enrolling, setEnrolling] = useState<TotpEnrollStartResp | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const data = (await http.get('/api/admin/auth/totp/status')) as unknown as TotpStatusResp;
    setEnrolled(data.enrolled);
  }
  useEffect(() => {
    refresh();
  }, []);

  async function startEnroll() {
    setBusy(true);
    try {
      const data = (await http.post(
        '/api/admin/auth/totp/enroll/start',
      )) as unknown as TotpEnrollStartResp;
      setEnrolling(data);
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  async function verifyEnroll() {
    if (code.length !== 6) {
      Message.error('请输入 6 位验证码');
      return;
    }
    setBusy(true);
    try {
      await http.post('/api/admin/auth/totp/enroll/verify', { code });
      Message.success('TOTP 已启用，本设备已记 7d 信任');
      setEnrolling(null);
      setCode('');
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await http.post('/api/admin/auth/totp/disable');
      Message.success('TOTP 已关闭');
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function logoutTrust() {
    setBusy(true);
    try {
      await http.post('/api/admin/auth/logout-trust');
      Message.success('已清除本设备信任 cookie，下次登录需要重新输 TOTP');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={
        <div className="flex items-center gap-2">
          <span>两步验证（TOTP）</span>
          {enrolled === true && <Tag color="green">已启用</Tag>}
          {enrolled === false && <Tag color="gray">未启用</Tag>}
        </div>
      }
    >
      {enrolled === false && !enrolling && (
        <div className="space-y-3">
          <Alert
            type="info"
            content={
              <span>
                启用后：登录除了密码还要 Google Authenticator 的 6 位码；
                每台设备首次验证后种 <code>tg_trust</code> cookie，7 天内免输。
              </span>
            }
          />
          <Button type="primary" onClick={startEnroll} loading={busy}>
            启用 TOTP
          </Button>
        </div>
      )}

      {enrolling && (
        <div className="space-y-4">
          <Alert
            type="warning"
            content="用 Google Authenticator / 1Password / Authy 扫码，再输入 6 位码验证。验证通过才会正式保存。"
          />
          <div className="flex flex-col items-center gap-3 py-4 bg-gray-50 rounded">
            <QRCodeSVG value={enrolling.provisioning_uri} size={192} />
            <div className="text-xs text-gray-500">
              扫不了码？手动输入 secret：
              <code className="ml-1 px-1 bg-gray-200 rounded select-all">
                {enrolling.secret_b32}
              </code>
            </div>
          </div>
          <Input
            value={code}
            onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            placeholder="6 位动态码"
            maxLength={6}
            style={{
              letterSpacing: '0.5em',
              textAlign: 'center',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 20,
            }}
            onPressEnter={verifyEnroll}
          />
          <div className="flex gap-2">
            <Button type="primary" onClick={verifyEnroll} loading={busy}>
              验证并启用
            </Button>
            <Button onClick={() => setEnrolling(null)}>取消</Button>
          </div>
        </div>
      )}

      {enrolled === true && (
        <div className="space-y-3">
          <Alert type="success" content="TOTP 已启用。本设备应该有 7 天信任 cookie。" />
          <div className="flex gap-2 flex-wrap">
            <Button onClick={logoutTrust} loading={busy}>
              清除本设备 7 天信任
            </Button>
            <Popconfirm
              title="关掉 TOTP 后任何人有你密码就能登录，确认？"
              onOk={disable}
            >
              <Button status="danger" loading={busy}>
                关闭 TOTP
              </Button>
            </Popconfirm>
          </div>
        </div>
      )}
    </Card>
  );
}
