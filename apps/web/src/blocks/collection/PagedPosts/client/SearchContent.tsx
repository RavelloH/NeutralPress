"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { RiGhostLine } from "@remixicon/react";

import HighlightedText from "@/components/client/HighlightedText";
import RowGrid, { GridItem } from "@/components/client/layout/RowGrid";
import ViewCountBatchLoader from "@/components/client/logic/ViewCountBatchLoader";
import EmptyPostCard from "@/components/server/features/posts/EmptyPostCard";
import PostCard from "@/components/server/features/posts/PostCard";
import { useBroadcast } from "@/hooks/use-broadcast";
import { searchPosts } from "@/lib/client/api/search-posts-read";
import { createArray } from "@/lib/client/create-array";
import { AutoTransition } from "@/ui/AutoTransition";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

export interface PostData {
  title: string;
  titleHighlight?: string;
  slug: string;
  accessMode?: "PUBLIC" | "ROLE" | "PASSWORD";
  excerpt: string | null;
  excerptHighlight?: string | null;
  isPinned: boolean;
  publishedAt: Date | null;
  categories: { name: string; slug: string }[];
  tags: { name: string; slug: string }[];
  coverData?: Array<{
    url: string;
    width?: number;
    height?: number;
    blur?: string;
  }>;
}

interface SearchContentProps {
  initialPosts: PostData[];
  searchQuery: string;
  onSearchStateChange?: (isSearching: boolean) => void;
  // currentPage, totalPages, basePath 保留用于未来扩展
  // 目前分页由独立的 PaginationBlock 处理
  currentPage?: number;
  totalPages?: number;
  basePath?: string;
}

interface SearchMessage {
  query: string;
}

export default function SearchContent({
  initialPosts,
  searchQuery,
  onSearchStateChange,
  currentPage: _currentPage,
  totalPages: _totalPages,
  basePath: _basePath,
}: SearchContentProps) {
  const [posts, setPosts] = useState<PostData[]>(initialPosts);
  const [isSearching, setIsSearching] = useState(false);
  const [currentSearchQuery, setCurrentSearchQuery] = useState(searchQuery);
  const [currentSearchToken, setCurrentSearchToken] = useState<string[]>([]);
  const hasSearched = useRef(false); // 跟踪是否执行过搜索

  // 生成或获取 sessionId（在组件挂载时生成一次）
  const [sessionId] = useState(() => {
    // 使用 crypto API 生成 UUID
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // 备用方案：生成简单的 UUID
    return "xxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (_c) => {
      const num = (Math.random() * 16) | 0;
      return num.toString(16);
    });
  });

  // 监听 isSearching 变化并通知父组件
  useEffect(() => {
    onSearchStateChange?.(isSearching);
  }, [isSearching, onSearchStateChange]);

  // 获取或生成 visitorId
  const getVisitorId = useCallback((): string => {
    let visitorId = localStorage.getItem("visitor_id");
    if (!visitorId) {
      // 生成新的 visitorId
      if (typeof crypto !== "undefined" && crypto.randomUUID) {
        visitorId = crypto.randomUUID();
      } else {
        // 备用方案
        visitorId =
          "visitor_" +
          "xxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (_c) => {
            const num = (Math.random() * 16) | 0;
            return num.toString(16);
          });
      }
      localStorage.setItem("visitor_id", visitorId);
    }
    return visitorId;
  }, []);

  // 防抖搜索函数
  const performSearch = useCallback(
    async (query: string) => {
      setIsSearching(true);
      hasSearched.current = true; // 标记已执行搜索

      try {
        const result = await searchPosts({
          query: query.trim(),
          page: 1,
          pageSize: 20,
          searchIn: "both",
          status: "PUBLISHED",
          sessionId, // 传递 sessionId
          visitorId: getVisitorId(), // 获取或生成 visitorId
        });

        if (result.success && result.data?.posts) {
          setCurrentSearchToken(result.data.tokensUsed);
          // 转换搜索结果为 PostData 格式
          const searchResults: PostData[] = result.data.posts.map((item) => ({
            title: item.title,
            titleHighlight: item.titleHighlight,
            slug: item.slug,
            accessMode: "PUBLIC",
            excerpt: item.excerpt,
            excerptHighlight: item.excerptHighlight,
            isPinned: item.isPinned,
            publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
            categories: item.categories
              ? item.categories.map((cat) => ({
                  name: cat.name,
                  slug: cat.slug,
                }))
              : [],
            tags: item.tags
              ? item.tags.map((tag) => ({
                  name: tag.name,
                  slug: tag.slug,
                }))
              : [],
            coverData: item.coverData
              ? [
                  {
                    url: item.coverData.url,
                    width: item.coverData.width || undefined,
                    height: item.coverData.height || undefined,
                    blur: item.coverData.blur || undefined,
                  },
                ]
              : undefined,
          }));

          setPosts(searchResults);
        } else {
          // 搜索失败或无结果时，显示空列表
          setPosts([]);
        }
      } catch (error) {
        console.error("搜索出错:", error);
        setPosts([]);
      } finally {
        setIsSearching(false);
      }
    },
    [sessionId, getVisitorId],
  );

  // 监听广播消息
  useBroadcast<SearchMessage>((message) => {
    // 安全检查：确保 query 存在
    if (!message || typeof message.query !== "string") {
      return;
    }

    // 更新搜索词显示
    setCurrentSearchQuery(message.query);
    // 只有非空查询才执行搜索
    if (message.query.trim()) {
      performSearch(message.query);
    } else if (hasSearched.current) {
      // 空查询时恢复显示初始文章列表（仅在执行过搜索后）
      setPosts(initialPosts);
      hasSearched.current = false;
    }
  });

  return (
    <>
      <AutoTransition type="fade" className="h-full">
        {/** 与 PagedPosts 主体保持一致：至少渲染一行（4个） */}
        {(() => {
          const rowsToRender = Math.max(1, Math.ceil(posts.length / 4));

          return isSearching ? (
            <RowGrid key="searching">
              <GridItem
                key={`loading}`}
                areas={createArray(1, 12)}
                width={1}
                height={1}
                className="flex items-center justify-center text-muted-foreground"
              >
                <LoadingIndicator />
              </GridItem>
            </RowGrid>
          ) : posts.length === 0 && currentSearchQuery.trim() ? (
            <RowGrid key="no-results">
              <GridItem
                areas={createArray(1, 12)}
                width={1}
                height={1}
                className="flex items-center justify-center text-muted-foreground flex-col gap-4 p-10 text-center"
              >
                <RiGhostLine size={"5em"} className="opacity-70" />
                {`未找到与 "${currentSearchToken.join("、") || currentSearchQuery}" 相关的文章`}
              </GridItem>
            </RowGrid>
          ) : (
            <RowGrid key={`results-${currentSearchQuery}`}>
              {Array(rowsToRender)
                .fill(0)
                .map((_, rowIndex) => (
                  <React.Fragment key={rowIndex}>
                    {Array.from({ length: 4 }, (_, index) => {
                      const postIndex = rowIndex * 4 + index;
                      const post = posts[postIndex];

                      return (
                        <GridItem
                          key={post ? post.slug : `empty-${postIndex}`}
                          areas={createArray(index * 3 + 1, (index + 1) * 3)}
                          width={4}
                          height={0.4}
                          className=""
                        >
                          {post ? (
                            <PostCard
                              title={
                                post.titleHighlight ? (
                                  <HighlightedText html={post.titleHighlight} />
                                ) : (
                                  post.title
                                )
                              }
                              slug={post.slug}
                              accessMode={post.accessMode}
                              isPinned={post.isPinned}
                              date={post.publishedAt}
                              category={post.categories}
                              tags={post.tags}
                              cover={post.coverData}
                              showAll={hasSearched.current}
                              summary={
                                post.excerptHighlight ? (
                                  <HighlightedText
                                    html={post.excerptHighlight}
                                  />
                                ) : post.excerpt ? (
                                  post.excerpt
                                ) : (
                                  ""
                                )
                              }
                            />
                          ) : (
                            <EmptyPostCard
                              direction={index % 2 === 0 ? "left" : "right"}
                            />
                          )}
                        </GridItem>
                      );
                    })}
                  </React.Fragment>
                ))}
            </RowGrid>
          );
        })()}
        <ViewCountBatchLoader
          key={JSON.stringify(posts.map((post) => post.slug))}
        />
      </AutoTransition>
    </>
  );
}
