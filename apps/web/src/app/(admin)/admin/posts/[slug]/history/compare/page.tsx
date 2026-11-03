"use client";

import { useEffect, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { RiArrowLeftSLine } from "@remixicon/react";
import type { PostVersionDetail } from "@repo/shared-types/api/post";
import { useParams, useSearchParams } from "next/navigation";

import AdminSidebar from "@/components/client/layout/AdminSidebar";
import HorizontalScroll from "@/components/client/layout/HorizontalScroll";
import MainLayout from "@/components/client/layout/MainLayout";
import RowGrid, { GridItem } from "@/components/client/layout/RowGrid";
import { useNavigateWithTransition } from "@/components/ui/Link";
import { getPostVersion } from "@/lib/client/api/post-read";
import Clickable from "@/ui/Clickable";

export default function PostHistoryComparePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = params?.slug as string;
  const navigate = useNavigateWithTransition();

  const [fromTimestamp, setFromTimestamp] = useState<string>("");
  const [toTimestamp, setToTimestamp] = useState<string>("");
  const [fromVersion, setFromVersion] = useState<PostVersionDetail | null>(
    null,
  );
  const [toVersion, setToVersion] = useState<PostVersionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<"vs-light" | "vs-dark">(() => {
    if (typeof window !== "undefined") {
      const isDark = document.documentElement.classList.contains("dark");
      return isDark ? "vs-dark" : "vs-light";
    }
    return "vs-light";
  });

  // 从 URL 参数获取版本信息
  useEffect(() => {
    const from = searchParams?.get("from");
    const to = searchParams?.get("to");

    if (from && to) {
      setFromTimestamp(decodeURIComponent(from));
      setToTimestamp(decodeURIComponent(to));
    }
  }, [searchParams]);

  // 监听主题变化
  useEffect(() => {
    const updateTheme = () => {
      const isDark = document.documentElement.classList.contains("dark");
      setTheme(isDark ? "vs-dark" : "vs-light");
    };

    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  // 获取版本内容
  useEffect(() => {
    async function fetchVersions() {
      if (!fromTimestamp || !toTimestamp) return;

      setLoading(true);
      try {
        const [fromResult, toResult] = await Promise.all([
          getPostVersion({ slug, timestamp: fromTimestamp }),
          getPostVersion({ slug, timestamp: toTimestamp }),
        ]);

        if (fromResult.success && fromResult.data) {
          setFromVersion(fromResult.data);
        }

        if (toResult.success && toResult.data) {
          setToVersion(toResult.data);
        }
      } catch (error) {
        console.error("Failed to fetch version content:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchVersions();
  }, [slug, fromTimestamp, toTimestamp]);

  // 格式化时间显示
  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <MainLayout type="horizontal">
      <HorizontalScroll
        className="h-full"
        enableParallax={true}
        enableFadeElements={true}
        enableLineReveal={true}
        snapToElements={false}
      >
        <AdminSidebar />
        <RowGrid className="w-full max-h-[100vh]" full>
          {/* 顶部标题栏 */}
          <GridItem
            areas={[1]}
            width={3.2}
            className="flex items-center justify-between px-10 border-b border-foreground/10"
          >
            <div className="flex items-center gap-x-2">
              <Clickable
                onClick={() => navigate(`/admin/posts/${slug}/history`)}
              >
                <RiArrowLeftSLine size="2em" />
              </Clickable>
              <h1 className="text-2xl font-bold text-foreground">版本对比</h1>
              <p className="text-2xl text-muted-foreground">
                / <span className="font-mono">{slug}</span>
              </p>
            </div>
          </GridItem>

          {/* 版本信息展示 */}
          <GridItem
            areas={[2]}
            width={3.2}
            height={0.4}
            className="grid grid-cols-2 px-10 border-b border-foreground/10"
          >
            <div className="flex items-center justify-center gap-4 pr-6">
              <label className="text-sm text-foreground font-medium whitespace-nowrap">
                旧版本：
              </label>
              {fromVersion ? (
                <div className="flex items-center gap-3">
                  <p className="text-sm text-foreground whitespace-nowrap">
                    {formatTimestamp(fromVersion.timestamp)}
                  </p>
                  <span className="text-muted-foreground">·</span>
                  <p className="text-xs text-muted-foreground">
                    {fromVersion.commitMessage}
                  </p>
                  <span className="text-muted-foreground">·</span>
                  <p className="text-xs text-muted-foreground flex items-center gap-2 whitespace-nowrap">
                    {fromVersion.nickname || `@${fromVersion.username}`}
                    {fromVersion.isSnapshot && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                        快照
                      </span>
                    )}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">加载中...</p>
              )}
            </div>

            <div className="flex items-center justify-center gap-4 pl-6">
              <label className="text-sm text-foreground font-medium whitespace-nowrap">
                新版本：
              </label>
              {toVersion ? (
                <div className="flex items-center gap-3">
                  <p className="text-sm text-foreground whitespace-nowrap">
                    {formatTimestamp(toVersion.timestamp)}
                  </p>
                  <span className="text-muted-foreground">·</span>
                  <p className="text-xs text-muted-foreground">
                    {toVersion.commitMessage}
                  </p>
                  <span className="text-muted-foreground">·</span>
                  <p className="text-xs text-muted-foreground flex items-center gap-2 whitespace-nowrap">
                    {toVersion.nickname || `@${toVersion.username}`}
                    {toVersion.isSnapshot && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                        快照
                      </span>
                    )}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">加载中...</p>
              )}
            </div>
          </GridItem>

          {/* Diff Editor 内容区域 */}
          <GridItem
            areas={[3, 4, 5, 6, 7, 8, 9, 10, 11, 12]}
            className="overflow-hidden bg-background relative"
            height={1.5}
          >
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-muted-foreground">加载中...</p>
              </div>
            ) : fromVersion && toVersion ? (
              <DiffEditor
                height="100%"
                language="markdown"
                original={fromVersion.content}
                modified={toVersion.content}
                theme={theme}
                options={{
                  readOnly: true,
                  fontSize: 14,
                  lineHeight: 24,
                  fontFamily:
                    "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
                  minimap: {
                    enabled: true,
                  },
                  lineNumbers: "on",
                  folding: true,
                  wordWrap: "on",
                  wrappingIndent: "indent",
                  scrollBeyondLastLine: false,
                  smoothScrolling: true,
                  renderLineHighlight: "all",
                  automaticLayout: true,
                  scrollbar: {
                    useShadows: false,
                    verticalScrollbarSize: 10,
                    horizontalScrollbarSize: 10,
                  },
                  renderSideBySide: true,
                  ignoreTrimWhitespace: false,
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-muted-foreground">
                  {fromTimestamp && toTimestamp
                    ? "加载中..."
                    : "未找到要对比的版本"}
                </p>
              </div>
            )}
          </GridItem>
        </RowGrid>
      </HorizontalScroll>
    </MainLayout>
  );
}
