# Agent / Mail 运维备注

## 自定义 HTTP skill

- 请求目标会在服务端解析一次并固定到已验证的公网 IP；不跟随重定向，避免 DNS rebinding 绕过 SSRF 边界。
- `Authorization`、`X-API-Key`、`Cookie` 等敏感请求头不接受保存的值。页面里的“密钥请求头”只填环境变量名，例如：
  `Authorization: CUSTOM_SKILL_SECRET_GITHUB`。
- 在后端运行环境中配置对应变量的**完整 header 值**（例如 `Bearer …`）；变量名必须以 `CUSTOM_SKILL_SECRET_` 开头。
- 旧 skill 若已把密钥直接写进 `config.headers`，需先在提供商侧轮换密钥，再按上述方式更新 skill。

## 临时邮箱保留

- `MAIL_TTL_HOURS` 可设 1–168，默认 24 小时。
- 服务启动后每天 UTC 02:15 清理过期邮件；日志只记录删除数量，不记录邮箱内容。

## Agent runs

私有 `/agent/` 的 `runs` 面板保存执行摘要：模型、状态、耗时、token 和调用过的工具名。它刻意不保存或返回
prompt、回答、工具参数、工具输出或自定义 skill 密钥。
