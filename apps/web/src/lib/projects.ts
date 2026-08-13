export interface Project {
  slug: string;
  command: string;
  title: string;
  summary: string;
  problem: string;
  approach: string;
  result: string;
  stack: string[];
  href: string;
  kind: 'internal' | 'external';
  accent: 'green' | 'cyan' | 'pink' | 'yellow';
}

export const GITHUB_URL = 'https://github.com/tenggouwa';
export const CONTACT_EMAIL = 'tenggouwa@gmail.com';
export const RSS_URL = '/feed.xml';

export const PROJECTS: Project[] = [
  {
    slug: 'agent-platform',
    command: 'cd projects/agent-platform',
    title: 'Agent Platform',
    summary: '一个可对话、可检索、可审批、可追溯的个人 Agent 实验平台。',
    problem: '把知识库问答、工具调用与私有执行能力放进同一套公开站点，同时守住访问和执行边界。',
    approach: '公开通道只开放 readonly 能力；私有通道经 TOTP 解锁。写入和执行默认审批，Pi 节点在 bwrap 沙箱中轮询执行。',
    result: '支持流式多轮对话、知识库引用、会话恢复、工具审批、MCP 与隔离节点；夜间真模型 smoke 持续验证关键链路。',
    stack: ['React', 'FastAPI', 'PostgreSQL', 'pgvector', 'SSE', 'bwrap'],
    href: '/agent/',
    kind: 'internal',
    accent: 'green',
  },
  {
    slug: 'perler-pattern',
    command: 'cd lab/perler-pattern',
    title: 'Perler Pattern Maker',
    summary: '把图片转换为可打印、可保存的拼豆图纸，计算留在浏览器本地完成。',
    problem: '大尺寸图像转图纸会带来密集像素计算和交互卡顿，同时项目文件不应依赖服务端保存。',
    approach: '使用 Web Worker 处理大网格计算，以 IndexedDB 保存项目；调色、网格、编号和打印在浏览器端完成。',
    result: '可处理大网格图纸，并提供 Mard 色卡、预览、导出和本地项目恢复，不上传用户图片。',
    stack: ['React', 'TypeScript', 'Web Worker', 'IndexedDB', 'Canvas'],
    href: '/lab/perler',
    kind: 'internal',
    accent: 'pink',
  },
  {
    slug: 'personal-site-ops',
    command: 'cd projects/site-ops',
    title: 'Personal Site Ops',
    summary: '将内容站、后台、Agent 与运行节点维护为一个可持续发布的 monorepo。',
    problem: '个人项目往往在功能增加后失去发布、SEO、质量与运行状态的统一控制。',
    approach: '使用 pnpm + uv monorepo，PR CI、静态预渲染、Web Vitals、自建分析、Cloudflare Pages/Tunnel 和 Docker Compose 组成发布链路。',
    result: '公开内容可预渲染并自动发布；后端发布有健康检查；后台集中查看内容、SEO、分析和运行状态。',
    stack: ['Vite', 'GitHub Actions', 'Cloudflare', 'Docker', 'FastAPI'],
    href: GITHUB_URL + '/Tenggouwa-site',
    kind: 'external',
    accent: 'cyan',
  },
];
