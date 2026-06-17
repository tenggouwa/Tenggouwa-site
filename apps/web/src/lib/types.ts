export interface Post {
  id: number;
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  content: string;
  published_at: string;
}

export interface PostSummary {
  id: number;
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  published_at: string;
}

export interface PostListPage {
  items: PostSummary[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

// 单篇文章累计阅读量，列表页画热力条用
export interface PostHeat {
  slug: string;
  pv: number;
}

// 树莓派实时状态，/pi 面板用
export interface PiHistoryPoint {
  ts: string;
  cpu_temp_c: number | null;
  load1: number | null;
}

export interface PiStatus {
  online: boolean;
  last_seen: string | null;
  age_seconds: number | null;
  hostname: string | null;
  model: string | null;
  metrics: Record<string, number> | null;
  history: PiHistoryPoint[];
}

// 系列元信息：title / 描述 / 排序前缀，写在前端而不是后端（轻量、好维护）
export interface SeriesMeta {
  tag: string;       // 用作 tag filter 的字符串，如 'linux-series'
  title: string;     // 显示标题
  emoji_or_glyph?: string;  // 可选小图标（应该用 SVG 或 ASCII，避免 emoji）
  description: string;
  command_hint?: string; // 终端风格副标题，如 'man linux'
  // 完整路线图：未发布的稿子也在里面，前端展示"已发 / 排队中"双状态。
  // 顺序就是系列阅读顺序（第 1 篇在最前）。
  roadmap?: SeriesEpisode[];
}

export interface SeriesEpisode {
  slug: string;
  title: string;
  published_at: string;  // YYYY-MM-DD（前端按当前时间判定 published）
  part?: string;         // 可选分组标签，如 "Part 1 — 是什么 / 从哪来"
}

export interface Inspiration {
  id: number;
  content: string;
  mood: string | null;
  created_at: string;
}

export interface InspirationListPage {
  items: Inspiration[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface SearchHit {
  type: 'post' | 'inspiration';
  id: number;
  title: string;
  url: string;
  snippet: string; // 含 <mark>关键词</mark> 高亮的 HTML
  score: number;
  tags: string[];
  timestamp: string | null;
}

export interface SearchResponse {
  query: string;
  took_ms: number;
  total: number;
  hits: SearchHit[];
}
