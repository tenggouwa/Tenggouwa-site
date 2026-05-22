"""SEO 模块：

- public POST /api/public/vitals  → 接收前端 Web Vitals beacon
- admin  GET  /api/admin/seo/vitals    → 真实用户性能 p75 聚合
- admin  GET  /api/admin/seo/search    → 搜索引擎收录 / 流量快照（GSC / 百度 / Bing）
- admin  GET  /api/admin/seo/keywords  → top queries 汇总
- admin  GET  /api/admin/seo/indexing  → 收录状态

GSC / 百度 / Bing 的拉取由定时任务驱动（service.fetch_*），密钥从环境变量读。
"""
