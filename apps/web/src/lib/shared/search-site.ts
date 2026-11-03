import { z } from "zod";

export const SearchSiteSchema = z.object({
  query: z.string().trim().min(1).max(200),
  sessionId: z.string().max(100).optional(),
  visitorId: z.string().max(100).optional(),
});

export type SearchSiteParams = z.infer<typeof SearchSiteSchema>;

export interface SearchSitePostItem {
  slug: string;
  title: string;
  excerpt: string | null;
  titleHighlight?: string;
  excerptHighlight?: string | null;
}

export interface SearchSiteProjectItem {
  id: number;
  slug: string;
  title: string;
  description: string;
}

export interface SearchSiteTagItem {
  slug: string;
  name: string;
  description: string | null;
}

export interface SearchSiteCategoryItem {
  id: number;
  slug: string;
  name: string;
  fullSlug: string;
  description: string | null;
}

export interface SearchSitePhotoItem {
  slug: string;
  name: string;
  description: string | null;
  imageUrl: string;
}

export interface SearchSiteResult {
  query: string;
  posts: SearchSitePostItem[];
  projects: SearchSiteProjectItem[];
  tags: SearchSiteTagItem[];
  categories: SearchSiteCategoryItem[];
  photos: SearchSitePhotoItem[];
  counts: {
    posts: number;
    projects: number;
    tags: number;
    categories: number;
    photos: number;
    total: number;
  };
}
