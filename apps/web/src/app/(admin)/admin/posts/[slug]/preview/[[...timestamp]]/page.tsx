"use client";

import { useEffect, useState } from "react";
import { RiArrowLeftSLine } from "@remixicon/react";
import type { PostVersionDetail } from "@repo/shared-types/api/post";
import { useParams } from "next/navigation";

import { LivePreview } from "@/components/client/features/editor/LivePreview";
import AdminSidebar from "@/components/client/layout/AdminSidebar";
import HorizontalScroll from "@/components/client/layout/HorizontalScroll";
import MainLayout from "@/components/client/layout/MainLayout";
import RowGrid, { GridItem } from "@/components/client/layout/RowGrid";
import { useNavigateWithTransition } from "@/components/ui/Link";
import { getPostVersion } from "@/lib/client/api/post-read";
import { getPostDetail } from "@/lib/client/api/post-read";
import { Button } from "@/ui/Button";
import Clickable from "@/ui/Clickable";

export default function PostPreviewPage() {
  const params = useParams();
  const slug = params?.slug as string;
  const timestampParam = params?.timestamp as string | string[] | undefined;
  // 如果 timestampParam 是数组，取第一个元素；否则使用原值
  const timestamp = timestampParam
    ? Array.isArray(timestampParam)
      ? timestampParam[0]
      : timestampParam
    : undefined;
  const navigate = useNavigateWithTransition();

  const [version, setVersion] = useState<PostVersionDetail | null>(null);
  const [postMode, setPostMode] = useState<"MARKDOWN" | "MDX">("MARKDOWN");
  const [loading, setLoading] = useState(true);

  // 获取版本内容和文章模式
  useEffect(() => {
    async function fetchVersion() {
      setLoading(true);
      try {
        // 获取文章详情以获取 postMode
        const detailResult = await getPostDetail({ slug });

        if (detailResult.success && detailResult.data) {
          setPostMode(detailResult.data.postMode);
        }

        // 如果提供了 timestamp，需要先解码
        const decodedTimestamp = timestamp
          ? decodeURIComponent(timestamp)
          : undefined;

        const result = await getPostVersion({
          slug,
          timestamp: decodedTimestamp,
        });

        if (result.success && result.data) {
          setVersion(result.data);
        }
      } catch (error) {
        console.error("Failed to fetch version:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchVersion();
  }, [slug, timestamp]);

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
            <div className="flex gap-x-2">
              <Clickable
                onClick={() =>
                  navigate(
                    timestamp
                      ? `/admin/posts/${slug}/history`
                      : `/admin/posts/`,
                  )
                }
              >
                <RiArrowLeftSLine size="2em" />
              </Clickable>
              <h1 className="text-2xl font-bold text-foreground">
                {timestamp ? "预览版本" : "预览最新版本"}
              </h1>
              <p className="text-2xl text-muted-foreground">
                / <span className="font-mono">{slug}</span>
              </p>
            </div>
            <div className="flex gap-x-2">
              <Button
                label="编辑"
                size="sm"
                variant="ghost"
                onClick={() => {
                  navigate(`/admin/posts/${slug}`);
                }}
              ></Button>
              <Button
                label="源码"
                size="sm"
                variant="secondary"
                onClick={() => {
                  navigate(
                    timestamp
                      ? `/admin/posts/${slug}/source/${timestamp}`
                      : `/admin/posts/${slug}/source`,
                  );
                }}
              ></Button>
            </div>
          </GridItem>

          {/* 版本信息卡片 */}
          <GridItem
            areas={[2]}
            width={3.2}
            height={0.4}
            className="flex items-center px-10 border-b border-foreground/10"
          >
            {version && (
              <div className="w-full">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      提交时间
                    </p>
                    <p className="text-sm font-mono text-foreground">
                      {formatTimestamp(version.timestamp)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">提交人</p>
                    <p className="text-sm text-foreground">
                      {version.nickname || `@${version.username}`}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      版本类型
                    </p>
                    <p className="text-sm text-foreground">
                      {version.isSnapshot ? (
                        <span className="text-sm py-1 text-primary font-medium">
                          快照版本
                        </span>
                      ) : (
                        <span className="text-sm py-1 font-medium">
                          差异版本
                        </span>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      提交信息
                    </p>
                    <p
                      className="text-sm text-foreground truncate"
                      title={version.commitMessage}
                    >
                      {version.commitMessage}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </GridItem>

          {/* 预览内容区域 */}
          <GridItem
            areas={[3, 4, 5, 6, 7, 8, 9, 10, 11, 12]}
            className="overflow-hidden bg-background relative"
            height={1.5}
          >
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-muted-foreground">加载中...</p>
              </div>
            ) : version ? (
              <LivePreview
                content={version.content}
                mode={postMode === "MDX" ? "mdx" : "markdown"}
                className="px-6 py-8"
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-muted-foreground">版本不存在</p>
              </div>
            )}
          </GridItem>
        </RowGrid>
      </HorizontalScroll>
    </MainLayout>
  );
}
