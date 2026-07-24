import { Layout, Menu, Button } from '@arco-design/web-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const Sider = Layout.Sider;
const Header = Layout.Header;
const Content = Layout.Content;
const MenuItem = Menu.Item;

const MENU = [
  { key: 'analytics', label: '站点分析' },
  { key: 'seo', label: 'SEO 监控' },
  { key: 'posts', label: '文章管理' },
  { key: 'inspirations', label: '小灵感' },
  { key: 'terminal', label: '终端' },
  { key: 'mail', label: '接码' },
  { key: 'settings', label: '站点设置' },
];

export default function Shell() {
  const loc = useLocation();
  const nav = useNavigate();
  const setToken = useAuth((s) => s.setToken);
  const active = loc.pathname.split('/').filter(Boolean)[0] ?? 'posts';

  return (
    <Layout className="h-full">
      <Sider collapsible breakpoint="lg" width={220} theme="dark">
        <div className="text-center text-white text-lg font-bold py-5 tracking-wide">
          tenggouwa · admin
        </div>
        <Menu
          theme="dark"
          selectedKeys={[active]}
          onClickMenuItem={(key) => nav(`/${key}`)}
        >
          {MENU.map((m) => (
            <MenuItem key={m.key}>{m.label}</MenuItem>
          ))}
        </Menu>
      </Sider>
      <Layout>
        <Header className="flex items-center justify-end px-6 border-b border-gray-200 bg-white">
          <NavLink to="/" target="_blank" className="text-xs text-gray-500 mr-4">
            预览站点 ↗
          </NavLink>
          <Button
            type="text"
            size="small"
            onClick={() => {
              setToken(null);
              nav('login');
            }}
          >
            退出登录
          </Button>
        </Header>
        <Content className="p-6 bg-gray-50">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
