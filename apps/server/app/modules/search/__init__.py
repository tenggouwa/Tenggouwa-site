"""全局搜索模块。

GET /api/public/search?q=xxx&limit=20
  - 同时搜 post（title/summary/tags/content）+ inspiration（content）
  - Postgres trigram (pg_trgm) 匹配 + similarity() 排序，对中文友好不需要分词
  - 返回结果带高亮 snippet，应用层提取（ts_headline 对中文支持差）
"""
