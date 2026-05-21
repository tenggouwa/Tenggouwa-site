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

export interface Inspiration {
  id: number;
  content: string;
  mood: string | null;
  created_at: string;
}
