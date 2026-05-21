import { useState } from 'react';
import { Button, Form, Input, Message } from '@arco-design/web-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { http } from '../lib/api';
import { useAuth } from '../lib/auth';

interface LoginValues {
  username: string;
  password: string;
}

interface LoginResp {
  token: string;
}

export default function Login() {
  const [form] = Form.useForm<LoginValues>();
  const [loading, setLoading] = useState(false);
  const setToken = useAuth((s) => s.setToken);
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? '/posts';

  async function submit(values: LoginValues) {
    setLoading(true);
    try {
      const data = (await http.post('/api/admin/auth/login', values)) as unknown as LoginResp;
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
        <Form form={form} onSubmit={submit} layout="vertical">
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
      </div>
    </div>
  );
}
