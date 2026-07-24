export interface Post {
  id: number;
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  content: string;
  published_at: string;
}

export interface PostCreate {
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  content: string;
}

export interface Inspiration {
  id: number;
  content: string;
  mood: string | null;
  created_at: string;
}

export interface InspirationCreate {
  content: string;
  mood?: string | null;
}

export interface PostAdminPage {
  items: Post[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface InspirationListPage {
  items: Inspiration[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface DailyPoint {
  date: string;
  pv: number;
  uv: number;
}

export interface AnalyticsOverview {
  pv_total: number;
  uv_total: number;
  pv_today: number;
  uv_today: number;
  daily: DailyPoint[];
}

export interface TopPage {
  path: string;
  pv: number;
  uv: number;
}

export interface TopReferrer {
  referrer: string;
  pv: number;
}

export interface CountryStat {
  country: string;
  pv: number;
}

export interface NameCount {
  name: string;
  pv: number;
}

export interface DeviceStats {
  browsers: NameCount[];
  os: NameCount[];
  mobile_ratio: number;
}

export interface LoginResp {
  requires_totp: boolean;
  token: string | null;
  expires_in: number | null;
  step_token: string | null;
}

export interface TotpVerifyResp {
  token: string;
  expires_in: number;
}

export interface TotpStatusResp {
  enrolled: boolean;
}

export interface TotpEnrollStartResp {
  secret_b32: string;
  provisioning_uri: string;
}

export interface AgentInfo {
  id: number;
  name: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  online: boolean;
}

export interface AgentIssueResp {
  id: number;
  name: string;
  token: string;
  base_url: string;
}

export interface TerminalSessionLog {
  id: number;
  agent_id: number;
  opened_at: string;
  closed_at: string | null;
  bytes_in: number;
  bytes_out: number;
  unlock_method: string;
  voice_transcript: string | null;
  client_ip: string | null;
}

export interface VitalsMetricSummary {
  metric: 'LCP' | 'CLS' | 'INP' | 'FCP' | 'TTFB';
  p75: number;
  p95: number;
  good_ratio: number;
  samples: number;
}

export interface VitalsTrendPoint {
  date: string;
  p75_lcp: number | null;
  p75_cls: number | null;
  p75_inp: number | null;
}

export interface VitalsOverview {
  by_metric: VitalsMetricSummary[];
  trend: VitalsTrendPoint[];
  mobile_ratio: number;
  samples_total: number;
}

export interface SearchUrlStat {
  url: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
}

export interface SearchChannelOverview {
  channel: 'google' | 'bing' | 'baidu';
  snapshot_date: string | null;
  impressions_total: number;
  clicks_total: number;
  ctr_avg: number;
  position_avg: number;
  indexed_count: number;
  top_urls: SearchUrlStat[];
}

export interface KeywordStat {
  query: string;
  occurrences: number;
}

export interface IndexingStatus {
  url: string;
  google_indexed: boolean;
  bing_indexed: boolean;
  baidu_indexed: boolean;
  last_checked: string | null;
}

export interface MailMessageItem {
  id: number;
  from_address: string | null;
  subject: string | null;
  code: string | null;
  received_at: string;
}

export interface MailLatestCode {
  code: string | null;
  message_id: string | null;
  subject: string | null;
  received_at: string | null;
}
