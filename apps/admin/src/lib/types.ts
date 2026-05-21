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
