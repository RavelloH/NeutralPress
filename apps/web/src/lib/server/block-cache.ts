import "server-only";

import { getBlockDefinition } from "@/blocks/core/catalog";
import type {
  BlockRuntimeContext,
  ResolvedBlock,
  RuntimeBlockInput,
} from "@/blocks/core/definition";
import { extractParsedPlaceholdersFromValue } from "@/blocks/core/lib/shared";
import { resolveSingleBlock } from "@/blocks/core/runtime/pipeline";

type BlockPageContext = Record<string, unknown> | undefined;

export interface BlockCacheContext {
  pageId?: string;
  pageContext?: BlockPageContext;
}

export interface ResolveSingleBlockWithCacheParams extends BlockCacheContext {
  block: RuntimeBlockInput;
  disableCache?: boolean;
}

export interface BuildPageCacheTagsParams {
  pageId: string;
  blocks: RuntimeBlockInput[];
  pageContext?: BlockPageContext;
}

const PLACEHOLDER_STATIC_TAG_MAP: Record<string, readonly string[]> = {
  posts: ["posts/list"],
  postsList: ["posts/list"],
  postsListPage: ["posts/list"],
  postsListTotalPage: ["posts/list"],
  postsListFirstPage: ["posts/list"],
  postsListLastPage: ["posts/list"],
  firstPublishAt: ["posts/list"],
  lastPublishDays: ["posts/list"],

  categories: ["categories/list"],
  rootCategories: ["categories/list"],
  childCategories: ["categories/list"],
  categoriesList: ["categories/list"],

  tags: ["tags/list"],
  tagsList: ["tags/list"],

  category: ["categories/list"],
  categoryName: ["categories/list"],
  categoryDescription: ["categories/list"],
  categorySubcategoryCount: ["categories/list"],
  categoryPostCount: ["categories/list"],
  categoryPage: ["categories/list"],
  categoryTotalPage: ["categories/list"],
  categoryFirstPage: ["categories/list"],
  categoryLastPage: ["categories/list"],

  tag: ["tags/list"],
  tagName: ["tags/list"],
  tagDescription: ["tags/list"],
  tagPostCount: ["tags/list"],
  tagPage: ["tags/list"],
  tagTotalPage: ["tags/list"],
  tagFirstPage: ["tags/list"],
  tagLastPage: ["tags/list"],

  projects: ["projects/list"],
  projectsList: ["projects/list"],

  friends: ["friend-links"],
  friendsList: ["friend-links"],
};

function normalizeContextSlug(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value
    .trim()
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
  return normalized || undefined;
}

function getPlaceholderScopedSlug(params: {
  placeholderParams: Record<string, string>;
  pageContext?: BlockPageContext;
}): string | undefined {
  return (
    normalizeContextSlug(params.placeholderParams.slug) ||
    normalizeContextSlug(params.pageContext?.slug)
  );
}

function getPlaceholderDynamicTags(params: {
  placeholderName: string;
  placeholderParams: Record<string, string>;
  pageContext?: BlockPageContext;
}): readonly string[] {
  const scopedSlug = getPlaceholderScopedSlug({
    placeholderParams: params.placeholderParams,
    pageContext: params.pageContext,
  });

  switch (params.placeholderName) {
    case "category":
    case "categoryName":
    case "categoryDescription":
    case "categorySubcategoryCount":
    case "categoryPostCount":
    case "categoryPage":
    case "categoryTotalPage":
    case "categoryFirstPage":
    case "categoryLastPage":
      return scopedSlug ? [`categories/${scopedSlug}`] : [];
    case "tag":
    case "tagName":
    case "tagDescription":
    case "tagPostCount":
    case "tagPage":
    case "tagTotalPage":
    case "tagFirstPage":
    case "tagLastPage":
      return scopedSlug ? [`tags/${scopedSlug}`] : [];
    case "pageInfo": {
      const pageType =
        typeof params.placeholderParams.page === "string"
          ? params.placeholderParams.page
          : "";
      if (pageType === "category-detail" && scopedSlug) {
        return [`categories/${scopedSlug}`];
      }
      if (pageType === "category-index") {
        return ["categories/list"];
      }
      if (pageType === "tag-detail" && scopedSlug) {
        return [`tags/${scopedSlug}`];
      }
      if (pageType === "tag-index") {
        return ["tags/list"];
      }
      if (pageType === "posts-index") {
        return ["posts/list"];
      }
      return [];
    }
    default:
      return [];
  }
}

function addTags(target: Set<string>, tags: Iterable<string>): void {
  for (const tag of tags) {
    if (tag) {
      target.add(tag);
    }
  }
}

function normalizeTagList(
  value: readonly string[] | undefined,
): readonly string[] {
  if (!value?.length) {
    return [];
  }

  const tags = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const trimmed = item.trim();
    if (trimmed) {
      tags.add(trimmed);
    }
  }

  return Array.from(tags);
}

function getDefinitionDependencyTags(params: {
  block: RuntimeBlockInput;
  pageContext?: BlockPageContext;
}): readonly string[] {
  const definition = getBlockDefinition(params.block.block || "default");
  const resolver = definition?.cache?.tags;
  if (!resolver) {
    return [];
  }

  const context: BlockRuntimeContext = {
    ...(params.pageContext ?? {}),
  };

  try {
    const resolved =
      typeof resolver === "function"
        ? resolver({
            block: params.block,
            content: params.block.content,
            context,
          })
        : resolver;

    return normalizeTagList(resolved);
  } catch (error) {
    console.error(
      `[BlockCache] Failed to resolve cache tags for block type "${params.block.block}"`,
      error,
    );
    return [];
  }
}

function getPlaceholderDependencyTags(params: {
  content: unknown;
  pageContext?: BlockPageContext;
}): readonly string[] {
  const tags = new Set<string>();
  const placeholders = extractParsedPlaceholdersFromValue(params.content);

  for (const placeholder of placeholders) {
    const mapped = PLACEHOLDER_STATIC_TAG_MAP[placeholder.name];
    if (mapped) {
      addTags(tags, mapped);
    }
    addTags(
      tags,
      getPlaceholderDynamicTags({
        placeholderName: placeholder.name,
        placeholderParams: placeholder.params,
        pageContext: params.pageContext,
      }),
    );
  }

  return Array.from(tags);
}

function getBlockDependencyTags(params: {
  block: RuntimeBlockInput;
  pageContext?: BlockPageContext;
}): readonly string[] {
  const tags = new Set<string>();

  addTags(tags, getDefinitionDependencyTags(params));
  addTags(
    tags,
    getPlaceholderDependencyTags({
      content: params.block.content,
      pageContext: params.pageContext,
    }),
  );

  const definition = getBlockDefinition(params.block.block || "default");
  if (definition?.capabilities.media?.length) {
    tags.add("photos");
  }

  return Array.from(tags);
}

export function getBlockCacheTags(params: {
  block: RuntimeBlockInput;
  pageId?: string;
  pageContext?: BlockPageContext;
}): string[] {
  const tags = new Set<string>();
  const blockId = String(params.block.id);

  if (params.pageId) {
    tags.add(`pages/${params.pageId}`);
    tags.add(`block/${params.pageId}/${blockId}`);
  }

  addTags(
    tags,
    getBlockDependencyTags({
      block: params.block,
      pageContext: params.pageContext,
    }),
  );

  return Array.from(tags);
}

export function buildPageCacheTagsForBlocks(
  params: BuildPageCacheTagsParams,
): string[] {
  const tags = new Set<string>([`pages/${params.pageId}`]);

  for (const block of params.blocks) {
    addTags(
      tags,
      getBlockDependencyTags({
        block,
        pageContext: params.pageContext,
      }),
    );
  }

  return Array.from(tags);
}

async function resolveSingleBlockCached(params: {
  block: RuntimeBlockInput;
  pageId: string;
  pageContext?: BlockPageContext;
}): Promise<ResolvedBlock> {
  return resolveSingleBlock(params.block, params.pageContext);
}

export async function resolveSingleBlockWithCache(
  params: ResolveSingleBlockWithCacheParams,
): Promise<ResolvedBlock> {
  if (params.disableCache || !params.pageId) {
    return resolveSingleBlock(params.block, params.pageContext);
  }

  return resolveSingleBlockCached({
    block: params.block,
    pageId: params.pageId,
    pageContext: params.pageContext,
  });
}
