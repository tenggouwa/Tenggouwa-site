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

// ---------- Google Indexing API ----------
// Google 官方只承诺 JobPosting/BroadcastEvent，但 BlogPosting 实际也能加速抓取。
// 用 service account JWT 兑换 access token，再 POST urlNotifications:publish。
// 无外部依赖：手撸 OAuth2 JWT bearer flow（RS256）。

import crypto from 'node:crypto';

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getGoogleAccessToken(saJson) {
  const sa = typeof saJson === 'string' ? JSON.parse(saJson) : saJson;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/indexing',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = base64url(signer.sign(sa.private_key));
  const jwt = `${signingInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`oauth token endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function pingGoogleIndexing(urls) {
  const saJson = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!saJson) {
    console.log('• Google Indexing: skip (no GSC_SERVICE_ACCOUNT_JSON)');
    return;
  }
  let token;
  try {
    token = await getGoogleAccessToken(saJson);
  } catch (e) {
    console.log(`• Google Indexing: skip (oauth failed: ${e.message})`);
    return;
  }
  // 只推文章详情页（/posts/<slug>/），列表/标签页价值不大且占配额（200/day）
  const articleUrls = urls.filter((u) => /\/posts\/[^/]+\/?$/.test(u));
  let ok = 0;
  for (const url of articleUrls) {
    const res = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url, type: 'URL_UPDATED' }),
    });
    if (res.ok) ok += 1;
    else {
      const text = await res.text();
      console.log(`  ! ${url}: ${res.status} ${text.slice(0, 120)}`);
    }
  }
  console.log(`• Google Indexing: ${ok}/${articleUrls.length} pushed`);
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
  await pingGoogleIndexing(urls);
}

main().catch((e) => {
  console.error(e);
  // 推送失败不阻塞部署
  process.exit(0);
});
