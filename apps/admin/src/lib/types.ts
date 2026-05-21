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
