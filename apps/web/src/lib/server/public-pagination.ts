import "server-only";

import { unstable_cache } from "next/cache";

import {
  countPublicCategoryPosts,
  findCategoryByPath,
} from "@/lib/server/category-utils";
import { LISTABLE_POST_PUBLISHED_WHERE } from "@/lib/server/post-access";
import prisma from "@/lib/server/prisma";

type CollectionKind = "posts" | "tags" | "categories";

/**
 * Resolve the valid last page for a public collection.
 * Counts are cached without a scheduled TTL, and invalidate with content changes.
 */
const getCollectionPostCount = unstable_cache(
  async (kind: CollectionKind, slug: string): Promise<number> => {
    if (kind === "posts") {
      return prisma.post.count({ where: LISTABLE_POST_PUBLISHED_WHERE });
    }

    if (kind === "tags") {
      return prisma.post.count({
        where: {
          ...LISTABLE_POST_PUBLISHED_WHERE,
          tags: { some: { slug } },
        },
      });
    }

    const category = await findCategoryByPath(slug.split("/").filter(Boolean));
    return category ? countPublicCategoryPosts(category.id) : 0;
  },
  ["public-collection-pagination-count"],
  {
    tags: ["posts/list", "tags/list", "categories/list"],
    revalidate: false,
  },
);

export function getCollectionKindFromTemplate(
  template: string,
): CollectionKind | null {
  if (!template.endsWith("/page/:page")) return null;
  if (template === "/posts/page/:page") return "posts";
  if (template.startsWith("/tags/")) return "tags";
  if (template.startsWith("/categories/")) return "categories";
  return null;
}

export async function isValidPublicCollectionPage(
  template: string,
  slug: string | undefined,
  page: number,
  pageSize: number,
): Promise<boolean> {
  if (!Number.isSafeInteger(page) || page < 1) return false;

  const kind = getCollectionKindFromTemplate(template);
  if (!kind) return true; // Custom pagination can use a different data source.
  if (kind !== "posts" && !slug) return false;

  const count = await getCollectionPostCount(kind, slug ?? "");
  return page <= Math.max(1, Math.ceil(count / pageSize));
}
