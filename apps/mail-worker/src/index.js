import PostalMime from 'postal-mime';

// 收到 *@<你的域名> 的邮件 → 解析 → 抽验证码 → HMAC 签名后 POST 给后端 ingest。
// 后端存库，admin 后台「接码」页查看。
//
// 需要两个绑定（见 wrangler.toml / README）：
//   - env.INGEST_URL          （var）后端 ingest 地址，如 https://api.tenggouwa.com/api/ingest/mail
//   - env.MAIL_INGEST_SECRET  （secret）与后端同值的 HMAC 密钥
// 两者任一缺失 → 回退成只打日志（方便还没配密钥时先观察）。
const MAX_BODY = 32 * 1024; // 正文上限，控体积 / 防大附件文本

export default {
  async email(message, env, ctx) {
    let parsed;
    try {
      parsed = await new PostalMime().parse(message.raw);
    } catch (e) {
      console.log(`[mail] parse-failed to=${message.to} from=${message.from} err=${e}`);
      return;
    }

    const subject = parsed.subject ?? '';
    const text = parsed.text ?? '';
    const body = (text || htmlToText(parsed.html ?? '')).slice(0, MAX_BODY);
    const code = extractCode(subject, body);
    const messageId = parsed.messageId || (await fallbackId(message, subject, body));

    if (!env.INGEST_URL || !env.MAIL_INGEST_SECRET) {
      console.log(`[mail] (log-only, 未配 ingest) to=${message.to} code=${code ?? '-'} subject=${JSON.stringify(subject)}`);
      return;
    }

    const payload = {
      message_id: messageId,
      to: message.to,
      from: message.from,
      subject,
      body,
      code,
      sent_at: parsed.date ?? null,
    };
    const bodyStr = JSON.stringify(payload);
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = await hmacHex(env.MAIL_INGEST_SECRET, `${ts}.${bodyStr}`);

    const post = fetch(env.INGEST_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // 该 zone 的 CF 规则会拦非浏览器 UA（1010），带上正常 UA 免得被挡
        'user-agent': 'Mozilla/5.0 (compatible; tenggouwa-mail-worker)',
        'X-Mail-Timestamp': ts,
        'X-Mail-Signature': `sha256=${sig}`,
      },
      body: bodyStr,
    })
      .then((r) => console.log(`[mail] posted to=${message.to} code=${code ?? '-'} status=${r.status}`))
      .catch((e) => console.log(`[mail] post-failed to=${message.to} err=${e}`));

    ctx.waitUntil(post);
  },
};

async function hmacHex(secret, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 邮件缺 Message-ID 时兜底生成一个稳定 id，避免后端幂等键为空。
async function fallbackId(message, subject, body) {
  const raw = `${message.from}|${message.to}|${subject}|${body.slice(0, 200)}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `gen-${hex}`;
}

// 纯 HTML 邮件去标签取可读文本：删 style/script，标签换空格，解基本实体，压空白。
function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/\s+/g, ' ')
    .trim();
}

// 与后端 extract.py 同款启发式：关键词上下文优先，纯数字兜底。
function extractCode(subject, text) {
  const hay = `${subject}\n${text}`;
  const patterns = [
    /(?:验证码|校验码|动态码|口令)[^0-9A-Za-z]{0,8}([0-9]{4,8})/,
    /([0-9]{4,8})[^0-9A-Za-z]{0,8}(?:验证码|校验码|动态码)/,
    /(?:verification|verify|security|one[- ]?time|login|auth|OTP|code|passcode|PIN)\D{0,12}([0-9]{4,8})/i,
    /\bG-([0-9]{6})\b/,
  ];
  for (const re of patterns) {
    const m = hay.match(re);
    if (m) return m[1];
  }
  const fallback = hay.match(/\b([0-9]{4,8})\b/);
  return fallback ? fallback[1] : null;
}
