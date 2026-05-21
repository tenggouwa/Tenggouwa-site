# PostgreSQL 部署 / 运维

## 本地开发

```bash
cd apps/server
docker compose up -d postgres        # 起 postgres:16-alpine，仅监听 127.0.0.1
cp -n .env.sample .env               # 含 POSTGRES_DEFAULT_PASSWORD
source .venv/bin/activate
alembic upgrade head                 # 跑迁移
cd app && python main.py             # 启服务
```

销库重来：

```bash
cd apps/server
docker compose down -v               # 注意 -v 会删数据卷
```

## 阿里云 ubuntu 生产部署

只监听本机回环，让 FastAPI 进程通过 `127.0.0.1:5432` 连，绝不开公网。

```bash
ssh openclaw

# 1. 安装
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql

# 2. 创建用户和库（在 postgres 系统账号下）
sudo -u postgres psql <<'SQL'
CREATE USER tenggouwa WITH PASSWORD '改成强密码';
CREATE DATABASE tenggouwa OWNER tenggouwa;
SQL

# 3. 确认只听本机
sudo grep -E "^listen_addresses" /etc/postgresql/*/main/postgresql.conf
# 期望：listen_addresses = 'localhost'（默认就是）
```

把密码塞到 systemd unit 里：

```ini
# ~/.config/systemd/user/tenggouwa-server.service 追加
Environment=POSTGRES_DEFAULT_PASSWORD=改成强密码
```

或者写到 `apps/server/.env`（rsync 时记得别覆盖远端的 `.env`，`deploy-server.sh`
已经 `--exclude .env`）。

首次部署后跑迁移：

```bash
ssh openclaw
cd ~/apps/Tenggouwa-server
source .venv/bin/activate   # 或 uv run
export ENV=prod
export POSTGRES_DEFAULT_PASSWORD=改成强密码
alembic upgrade head
systemctl --user restart tenggouwa-server.service
```

后续每次发布如果有迁移：

```bash
# 本地把代码推上去
pnpm deploy:server   # 自动 rsync + uv sync + systemctl restart

# 远端跑迁移（手动一步，避免脚本误升）
ssh openclaw
cd ~/apps/Tenggouwa-server && source .venv/bin/activate && \
  ENV=prod alembic upgrade head
systemctl --user restart tenggouwa-server.service
```

## 备份

最简方案：cron 跑 `pg_dump`，往本机 / OSS 各推一份。

```bash
# crontab -e
0 4 * * * pg_dump -U tenggouwa tenggouwa | gzip > ~/backups/tenggouwa-$(date +\%F).sql.gz
```

恢复：`gunzip -c xxx.sql.gz | psql -U tenggouwa tenggouwa`。

## 常用排查

```bash
# 看连接
sudo -u postgres psql -c "select pid,usename,application_name,state,query from pg_stat_activity;"

# 看表大小
sudo -u postgres psql tenggouwa -c "
  select relname, pg_size_pretty(pg_total_relation_size(relid))
  from pg_catalog.pg_statio_user_tables order by pg_total_relation_size(relid) desc;"

# 看慢查询（先在 postgresql.conf 打开 log_min_duration_statement = 200ms）
sudo tail -f /var/log/postgresql/postgresql-16-main.log
```
