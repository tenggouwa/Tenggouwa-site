import { useState } from 'react';
import { Button, Form, Input, Message } from '@arco-design/web-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { http } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { LoginResp, TotpVerifyResp } from '../lib/types';

interface LoginValues {
  username: string;
  password: string;
}

type Stage = 'credentials' | 'totp';

export default function Login() {
  const [stage, setStage] = useState<Stage>('credentials');
  const [stepToken, setStepToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm<LoginValues>();
  const setToken = useAuth((s) => s.setToken);
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? '/analytics';

  async function submitCredentials(values: LoginValues) {
    setLoading(true);
    try {
      const data = (await http.post('/api/admin/auth/login', values)) as unknown as LoginResp;
      if (data.requires_totp) {
        setStepToken(data.step_token);
        setStage('totp');
        Message.info('请输入 Google Authenticator 6 位码');
      } else if (data.token) {
        setToken(data.token);
        Message.success('登录成功');
        nav(from, { replace: true });
      }
    } finally {
      setLoading(false);
    }
  }

  async function submitTotp() {
    if (!stepToken || code.length !== 6) {
      Message.error('请输入 6 位验证码');
      return;
    }
    setLoading(true);
    try {
      const data = (await http.post('/api/admin/auth/totp/verify', {
        step_token: stepToken,
        code,
      })) as unknown as TotpVerifyResp;
      setToken(data.token);
      Message.success('登录成功');
      nav(from, { replace: true });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
      <div className="w-[360px] rounded-lg bg-white shadow-lg p-8">
        <h1 className="text-xl font-bold text-center mb-6">tenggouwa · admin</h1>

        {stage === 'credentials' && (
          <Form form={form} onSubmit={submitCredentials} layout="vertical">
            <Form.Item
              field="username"
              label="账号"
              rules={[{ required: true, message: '请输入账号' }]}
            >
              <Input placeholder="username" autoComplete="username" />
            </Form.Item>
            <Form.Item
              field="password"
              label="密码"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password placeholder="password" autoComplete="current-password" />
            </Form.Item>
            <Button long type="primary" htmlType="submit" loading={loading}>
              登录
            </Button>
          </Form>
        )}

        {stage === 'totp' && (
          <div className="space-y-4">
            <div className="text-sm text-gray-600 leading-relaxed">
              密码已通过。请打开
              <strong className="mx-1">Google Authenticator</strong>
              查看 6 位动态码：
            </div>
            <Input
              size="large"
              value={code}
              onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              maxLength={6}
              style={{
                letterSpacing: '0.6em',
                textAlign: 'center',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 22,
              }}
              autoFocus
              onPressEnter={submitTotp}
            />
            <Button long type="primary" loading={loading} onClick={submitTotp}>
              验证并登录
            </Button>
            <Button long type="text" size="small" onClick={() => setStage('credentials')}>
              ← 返回输入账号密码
            </Button>
            <div className="text-xs text-gray-400 leading-relaxed">
              首次验证通过后会种 7 天信任设备 cookie，期间不再需要输 TOTP。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
