# 部署模板

## GitHub Pages（前端）

`.github/workflows/deploy-pages.yml` 自动跑：

1. 安装 pnpm 依赖
2. 跑 `scripts/build-pages.sh` 构建 web + admin 到 `pages-dist/`
3. 通过 `actions/deploy-pages` 发布

仓库设置：

- Settings → Pages → Source 选 `GitHub Actions`
- 首次部署后访问：`https://<user>.github.io/<repo>/`

## 阿里云服务器（后端）

### 一次性准备

```bash
ssh openclaw
# 安装 uv（如果还没有）
curl -LsSf https://astral.sh/uv/install.sh | sh

# 让 user systemd 在登出后保持运行
sudo loginctl enable-linger $USER

# 部署 systemd unit
mkdir -p ~/.config/systemd/user
cp ~/apps/Tenggouwa-server/deploy/systemd/tenggouwa-server.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable tenggouwa-server.service

# 配置 nginx + 申请证书
sudo cp deploy/nginx/tenggouwa.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/tenggouwa.conf /etc/nginx/sites-enabled/
sudo certbot --nginx -d your-api-domain
sudo nginx -t && sudo systemctl reload nginx
```

### 日常发布

本地执行：

```bash
pnpm deploy:server
```

会 rsync 代码 → `uv sync` → systemd 重启。
