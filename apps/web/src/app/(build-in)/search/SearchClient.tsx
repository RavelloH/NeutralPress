"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RiAppsLine,
  RiArticleLine,
  RiFolderLine,
  RiGhostLine,
  RiImageLine,
  RiPriceTag3Line,
  RiSearchLine,
} from "@remixicon/react";
import type { ApiResponse } from "@repo/shared-types/api/common";
import Image from "next/image";

import HighlightedText from "@/components/client/HighlightedText";
import { useNavigateWithTransition } from "@/components/ui/Link";
import type { SearchSiteResult } from "@/lib/shared/search-site";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { Input } from "@/ui/Input";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { SegmentedControl } from "@/ui/SegmentedControl";

const SEARCH_TABS = [
  "posts",
  "projects",
  "tags",
  "categories",
  "photos",
] as const;

type SearchTab = (typeof SEARCH_TABS)[number];

const TAB_LABELS: Record<SearchTab, string> = {
  posts: "文章",
  projects: "项目",
  tags: "标签",
  categories: "分类",
  photos: "照片",
};

interface SearchClientProps {
  isModal?: boolean;
  onRequestClose?: (targetPath?: string) => void;
}

const EMPTY_RESULT: SearchSiteResult = {
  query: "",
  posts: [],
  projects: [],
  tags: [],
  categories: [],
  photos: [],
  counts: {
    posts: 0,
    projects: 0,
    tags: 0,
    categories: 0,
    photos: 0,
    total: 0,
  },
};

function SearchResultItem({
  title,
  description,
  meta,
  leading,
  onClick,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  leading?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-sm px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      <div className="flex items-start gap-3">
        {leading ? <div className="mt-0.5 shrink-0">{leading}</div> : null}
        <div className="min-w-0 flex-1">
          <div className="line-clamp-1 text-xl text-foreground">{title}</div>
          {description ? (
            <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {description}
            </div>
          ) : null}
          {meta ? (
            <div className="mt-2 line-clamp-1 text-xs text-muted-foreground">
              {meta}
            </div>
          ) : null}
        </div>
      </div>
    </button>
  );
}

export default function SearchClient({
  isModal = false,
  onRequestClose,
}: SearchClientProps) {
  const navigate = useNavigateWithTransition();
  const [searchQuery, setSearchQuery] = useState("");
  const [result, setResult] = useState<SearchSiteResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeTab, setActiveTab] = useState<SearchTab>("posts");
  const requestIdRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);

  const [sessionId] = useState(() => {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }

    return "xxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, () => {
      const random = (Math.random() * 16) | 0;
      return random.toString(16);
    });
  });

  const getVisitorId = useCallback(() => {
    const key = "visitor_id";
    const current = localStorage.getItem(key);
    if (current) return current;

    const nextId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "visitor-" +
          "xxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, () => {
            const random = (Math.random() * 16) | 0;
            return random.toString(16);
          });

    localStorage.setItem(key, nextId);
    return nextId;
  }, []);

  const handleNavigate = useCallback(
    (targetPath: string) => {
      if (onRequestClose) {
        onRequestClose(targetPath);
        return;
      }
      navigate(targetPath);
    },
    [navigate, onRequestClose],
  );

  const performSearch = useCallback(
    async (query: string) => {
      // Search is a read-only GET, not a serialized Server Function POST.
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      const currentRequestId = ++requestIdRef.current;

      setIsSearching(true);
      setHasSearched(true);

      try {
        const url = new URL("/api/public/search", window.location.origin);
        url.searchParams.set("q", query);

        const result = await fetch(url.toString(), {
          method: "GET",
          headers: {
            "x-search-session-id": sessionId,
            "x-search-visitor-id": getVisitorId(),
          },
          cache: "no-store",
          signal: controller.signal,
        });
        const response =
          (await result.json()) as ApiResponse<SearchSiteResult | null>;

        if (
          controller.signal.aborted ||
          currentRequestId !== requestIdRef.current
        ) {
          return;
        }

        if (result.ok && response.success && response.data) {
          const data = response.data;
          setResult(data);
          const firstAvailableTab =
            SEARCH_TABS.find((tab) => data.counts[tab] > 0) || "posts";
          setActiveTab(firstAvailableTab);
        } else {
          setResult({
            ...EMPTY_RESULT,
            query,
          });
          setActiveTab("posts");
        }
      } catch (error) {
        if (
          controller.signal.aborted ||
          currentRequestId !== requestIdRef.current
        ) {
          return;
        }
        console.error("全站搜索失败:", error);
        setResult({
          ...EMPTY_RESULT,
          query,
        });
        setActiveTab("posts");
      } finally {
        if (searchAbortRef.current === controller) {
          searchAbortRef.current = null;
        }
        if (currentRequestId === requestIdRef.current) {
          setIsSearching(false);
        }
      }
    },
    [getVisitorId, sessionId],
  );

  useEffect(() => () => searchAbortRef.current?.abort(), []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const keyword = searchQuery.trim();

      if (!keyword) {
        requestIdRef.current += 1;
        searchAbortRef.current?.abort();
        searchAbortRef.current = null;
        setIsSearching(false);
        setHasSearched(false);
        setResult(null);
        setActiveTab("posts");
        return;
      }

      void performSearch(keyword);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [performSearch, searchQuery]);

  const tabOptions = SEARCH_TABS.map((tab) => ({
    value: tab,
    label: `${TAB_LABELS[tab]} (${result?.counts[tab] ?? 0})`,
  }));

  const renderCurrentList = () => {
    if (!result) return null;

    if (activeTab === "posts") {
      return result.posts.map((post) => (
        <SearchResultItem
          key={`post-${post.slug}`}
          title={
            post.titleHighlight ? (
              <HighlightedText html={post.titleHighlight} />
            ) : (
              post.title
            )
          }
          description={
            post.excerptHighlight ? (
              <HighlightedText html={post.excerptHighlight} />
            ) : (
              post.excerpt || "暂无摘要"
            )
          }
          meta={`/posts/${post.slug}`}
          onClick={() => handleNavigate(`/posts/${post.slug}`)}
        />
      ));
    }

    if (activeTab === "projects") {
      return result.projects.map((project) => (
        <SearchResultItem
          key={`project-${project.slug}`}
          title={project.title}
          description={project.description}
          meta={`/projects/${project.slug}`}
          onClick={() => handleNavigate(`/projects/${project.slug}`)}
        />
      ));
    }

    if (activeTab === "tags") {
      return result.tags.map((tag) => (
        <SearchResultItem
          key={`tag-${tag.slug}`}
          title={tag.name}
          description={tag.description || "#" + tag.slug}
          meta={`/tags/${tag.slug}`}
          onClick={() => handleNavigate(`/tags/${tag.slug}`)}
        />
      ));
    }

    if (activeTab === "categories") {
      return result.categories.map((category) => (
        <SearchResultItem
          key={`category-${category.id}`}
          title={category.name}
          description={category.description || "#" + category.slug}
          meta={`/categories/${category.fullSlug}`}
          onClick={() => handleNavigate(`/categories/${category.fullSlug}`)}
        />
      ));
    }

    return result.photos.map((photo) => (
      <SearchResultItem
        key={`photo-${photo.slug}`}
        title={photo.name}
        description={photo.description || ""}
        meta={`/gallery/photo/${photo.slug}`}
        leading={
          <Image
            src={photo.imageUrl}
            alt={photo.name}
            width={56}
            height={56}
            className="h-14 w-14 rounded-sm border border-foreground/10 object-cover"
          />
        }
        onClick={() => handleNavigate(`/gallery/photo/${photo.slug}`)}
      />
    ));
  };

  return (
    <div
      className={
        isModal
          ? "h-full px-6 py-5"
          : "mx-auto w-full max-w-5xl px-6 py-8 md:px-10"
      }
    >
      <div className="space-y-6">
        {isModal ? null : (
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-wider">全站搜索</h1>
            <p className="text-sm text-muted-foreground">
              搜索文章、项目、标签、分类与照片。
            </p>
          </div>
        )}

        <Input
          label="搜索"
          type="text"
          helperText="搜索文章、项目、标签、分类、照片"
          size="sm"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          icon={<RiSearchLine size="1.2em" />}
          autoFocus
        />
        <AutoResizer>
          <AutoTransition>
            {result ? (
              <SegmentedControl<SearchTab>
                value={activeTab}
                onChange={setActiveTab}
                options={tabOptions}
                columns={5}
              />
            ) : null}
          </AutoTransition>
        </AutoResizer>

        <AutoResizer>
          <div className={isModal ? "pr-1 py-3" : "overflow-y-auto pr-1"}>
            <AutoTransition type="fade">
              {isSearching ? (
                <div
                  key="search-loading"
                  className="flex items-center justify-center py-40"
                >
                  <LoadingIndicator size="md" />
                </div>
              ) : !hasSearched ? (
                <div
                  key="search-initial"
                  className="flex flex-col items-center justify-center py-40 text-muted-foreground"
                >
                  <RiSearchLine size="3em" className="mb-3 opacity-50" />
                  <p className="text-sm">输入关键词开始搜索</p>
                </div>
              ) : !result || result.counts.total === 0 ? (
                <div
                  key="search-empty-all"
                  className="flex flex-col items-center justify-center py-14 text-muted-foreground"
                >
                  <RiGhostLine size="3em" className="mb-3 opacity-50" />
                  <p className="text-sm">没有找到匹配的内容</p>
                </div>
              ) : result.counts[activeTab] === 0 ? (
                <div
                  key={`search-empty-tab-${activeTab}-${result.query}`}
                  className="flex flex-col items-center justify-center py-14 text-muted-foreground"
                >
                  {activeTab === "posts" ? (
                    <RiArticleLine size="3em" className="mb-3 opacity-50" />
                  ) : null}
                  {activeTab === "projects" ? (
                    <RiAppsLine size="3em" className="mb-3 opacity-50" />
                  ) : null}
                  {activeTab === "tags" ? (
                    <RiPriceTag3Line size="3em" className="mb-3 opacity-50" />
                  ) : null}
                  {activeTab === "categories" ? (
                    <RiFolderLine size="3em" className="mb-3 opacity-50" />
                  ) : null}
                  {activeTab === "photos" ? (
                    <RiImageLine size="3em" className="mb-3 opacity-50" />
                  ) : null}
                  <p className="text-sm">当前分组暂无结果</p>
                </div>
              ) : (
                <div
                  key={`search-list-${activeTab}-${result.query}`}
                  className="space-y-2"
                >
                  {renderCurrentList()}
                </div>
              )}
            </AutoTransition>
          </div>
        </AutoResizer>
      </div>
    </div>
  );
}
