# 共享接码门户

## 本次范围

- `/mail/` 是独立页面，不显示网站导航或管理功能；无需用户名或注册。
- 一个共用密码，所有持有者可查看全部未过期邮件，包括启用前收到且尚未过期的邮件。
- 收件箱总览、按邮箱查询、50 封分页、25 秒等新码、取消等待、复制验证码。
- 只返回发件人、主题、验证码、时间；不提供正文、附件、写邮件或删除操作。
- 不增加账号、邮箱分配、第三方短信服务、Worker 投递重试。

## 认证边界

`/api/mail/login` 校验 bcrypt 哈希；每 IP 每分钟最多 6 次尝试，全局最多 30 次。
通过后签发 8 小时 HttpOnly Cookie，仅发送到 `/api/mail`。生产 Cookie 使用 Secure + SameSite=Lax。
签名密钥通过 HMAC 从服务端 JWT secret 与密码哈希派生，独立于管理员签名密钥。
接码凭证无法用于 admin、终端或私有 Agent；其他已有公开接口的开放状态不改变。
改密码哈希并重启服务后，旧 Cookie 失效；清空配置即关闭访问。退出登录会清除当前浏览器 Cookie。
POST 要求 `X-Mail-Portal: 1`，跨域浏览器请求必须经过现有 CORS 白名单预检。
API 禁用缓存，访问日志不记录 `/api/mail` 请求参数。

所有邮件查询（包括现有 admin）按数据库当前时间过滤过期记录；每日定时任务仍负责物理删除。
等码请求前端允许 35 秒，后端最多等待 25 秒；返回前再次校验会话。

## 配置和发布

后端 `.env` 新增 `MAIL_PORTAL_PASSWORD_HASH`，只放 bcrypt 哈希，不放明文，不提交真实值。
没有配置时，接码 API 返回 503「接码入口尚未启用」，不会默认开放。
本地生成哈希（交互输入，不把明文放进命令历史）：

```bash
cd apps/server
uv run python -c 'import bcrypt,getpass; print(bcrypt.hashpw(getpass.getpass("访问密码: ").encode(), bcrypt.gensalt()).decode())'
```

`.env` 中哈希值使用单引号包裹，避免 `$` 插值。密码使用不超过 72 UTF-8 字节的随机长密码。
生产密码/权限配置变更需站主确认；配置后按现有 `pnpm deploy:server` 发布后端。
前端随 Pages 流水线发布，无新增数据库迁移或 Worker 部署。

主入口为 `https://tenggouwa.com/mail/`。开发入口为 `http://127.0.0.1:5173/mail/`，使用 Vite API 反代。
GitHub Pages 镜像与 API 跨站，SameSite=Lax 不携带接码 Cookie；分享主域名入口，不使用镜像登录。

## 验证与上线检查

- 后端 HTTP 测试：未登录拒绝、密码错误/限流、Cookie 标记、登出、过期/伪造/错误 audience、改密撤销、管理员凭证隔离。
- 查询测试检查三个读取查询均带过期过滤；原 mail 模块测试继续运行。
- 前端测试：登录查看、登出清屏、401 清屏、取消等码；typecheck 和生产构建。
- 合并前对照上述范围与 CI；启用后再验证真实收信、25 秒等待、不同浏览器共用密码访问。
- 回滚开放：清空 `MAIL_PORTAL_PASSWORD_HASH` 并重启后端即可，原 admin 接码不受影响。
