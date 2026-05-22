#!/usr/bin/env node
// 部署后通知搜索引擎：把变更过的 URL push 给 IndexNow / 百度链接提交。
// 在 GitHub Actions 的 deploy job 之后跑。
//
// 环境变量：
//   SITE_ORIGIN       https://tenggouwa.com  正版根域名
//   SITEMAP_PATH      sitemap.xml 路径，默认 cf-dist/sitemap.xml（本地）
//                     CI 里给出的是 ${{ vars.SITE_ORIGIN }}/sitemap.xml
//   CHANGED_URLS      可选，换行分隔；不传则用 sitemap 全量
//   INDEXNOW_KEY      32+ 位 hex 字符串；不配则跳过
//   BAIDU_SITE        e.g. tenggouwa.com；不配则跳过
//   BAIDU_TOKEN       百度站长 push token；不配则跳过
//
// 静默跳过：缺 secret 就不推那个渠道，不报错。

import fs from 'node:fs';
import path from 'node:path';

const ORIGIN = (process.env.SITE_ORIGIN ?? 'https://tenggouwa.com').replace(/\/$/, '');
const HOST = new URL(ORIGIN).host;

function collectUrls() {
  if (process.env.CHANGED_URLS) {
    return process.env.CHANGED_URLS.split('\n').map((s) => s.trim()).filter(Boolean);
  }
  const sitemapPath = process.env.SITEMAP_PATH ?? path.resolve('cf-dist/sitemap.xml');
  if (fs.existsSync(sitemapPath)) {
    const xml = fs.readFileSync(sitemapPath, 'utf-8');
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  }
  console.error(`sitemap not found at ${sitemapPath}`);
  return [];
}

async function pingIndexNow(urls) {
  const key = process.env.INDEXNOW_KEY;
  if (!key) {
    console.log('• IndexNow: skip (no INDEXNOW_KEY)');
    return;
  }
  const safe = key.replace(/[^a-zA-Z0-9]/g, '');
  const body = {
    host: HOST,
    key: safe,
    keyLocation: `${ORIGIN}/${safe}.txt`,
    urlList: urls,
  };
  const res = await fetch('https://api.indexnow.org/IndexNow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  console.log(`• IndexNow: ${res.status} (${urls.length} urls)`);
  if (!res.ok) {
    const t = await res.text();
    console.log(`  ${t.slice(0, 200)}`);
  }
}

async function pingBaidu(urls) {
  const site = process.env.BAIDU_SITE;
  const token = process.env.BAIDU_TOKEN;
  if (!site || !token) {
    console.log('• Baidu push: skip (no BAIDU_SITE/BAIDU_TOKEN)');
    return;
  }
  const url = `http://data.zz.baidu.com/urls?site=${encodeURIComponent(site)}&token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: urls.join('\n'),
  });
  const text = await res.text();
  console.log(`• Baidu push: ${res.status} ${text.slice(0, 200)}`);
}

async function main() {
  const urls = collectUrls();
  if (!urls.length) {
    console.log('no urls to push');
    process.exit(0);
  }
  console.log(`==> notifying for ${urls.length} urls`);
  await pingIndexNow(urls);
  await pingBaidu(urls);
}

main().catch((e) => {
  console.error(e);
  // 推送失败不阻塞部署
  process.exit(0);
});
