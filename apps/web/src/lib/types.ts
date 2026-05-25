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

// 系列元信息：title / 描述 / 排序前缀，写在前端而不是后端（轻量、好维护）
export interface SeriesMeta {
  tag: string;       // 用作 tag filter 的字符串，如 'linux-series'
  title: string;     // 显示标题
  emoji_or_glyph?: string;  // 可选小图标（应该用 SVG 或 ASCII，避免 emoji）
  description: string;
  command_hint?: string; // 终端风格副标题，如 'man linux'
}

export interface Inspiration {
  id: number;
  content: string;
  mood: string | null;
  created_at: string;
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
