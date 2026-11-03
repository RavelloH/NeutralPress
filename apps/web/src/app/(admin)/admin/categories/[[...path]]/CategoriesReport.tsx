"use client";

import { useCallback, useEffect, useState } from "react";
import { RiAddLine, RiArrowLeftSLine, RiRefreshLine } from "@remixicon/react";

import { createCategory } from "@/actions/category";
import { GridItem } from "@/components/client/layout/RowGrid";
import ErrorPage from "@/components/ui/Error";
import { useNavigateWithTransition } from "@/components/ui/Link";
import { useBroadcastSender } from "@/hooks/use-broadcast";
import { getCategoriesStats } from "@/lib/client/api/stats";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import Clickable from "@/ui/Clickable";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { useToast } from "@/ui/Toast";

type StatsData = {
  updatedAt: string;
  cache: boolean;
  total: {
    total: number;
    topLevel: number;
    withPosts: number;
    withoutPosts: number;
  };
  depth: {
    maxDepth: number;
    avgDepth: number;
  };
  new: {
    last7Days: number;
    last30Days: number;
    lastYear: number;
  };
};

type CurrentCategory = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  parentId: number | null;
} | null;

type Props = {
  parentId: number | null;
  categoryPath: string[];
  currentCategory: CurrentCategory;
};

export default function CategoriesReport({
  parentId,
  categoryPath,
  currentCategory,
}: Props) {
  const toast = useToast();
  const navigate = useNavigateWithTransition();
  const [result, setResult] = useState<StatsData | null>(null);
  const [refreshTime, setRefreshTime] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const { broadcast } = useBroadcastSender<{ type: "categories-refresh" }>();

  // 创建对话框
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createFormData, setCreateFormData] = useState({
    name: "",
    slug: "",
    description: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchData = useCallback(
    async (forceRefresh: boolean = false) => {
      if (forceRefresh) {
        setResult(null);
      }
      setError(null);
      const res = await getCategoriesStats({ force: forceRefresh });
      if (!res.success) {
        setError(new Error(res.message || "获取分类统计失败"));
        return;
      }
      if (!res.data) return;
      setResult(res.data);
      setRefreshTime(new Date(res.data.updatedAt));

      // 刷新成功后广播消息,通知其他组件更新
      if (forceRefresh) {
        await broadcast({ type: "categories-refresh" });
      }
    },
    [broadcast],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 打开创建对话框
  const openCreateDialog = () => {
    setCreateFormData({ name: "", slug: "", description: "" });
    setCreateDialogOpen(true);
  };

  // 关闭创建对话框
  const closeCreateDialog = () => {
    setCreateDialogOpen(false);
  };

  // 创建分类
  const handleCreateCategory = async () => {
    if (!createFormData.name.trim()) {
      toast.error("分类名称不能为空");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createCategory({
        name: createFormData.name.trim(),
        slug: createFormData.slug.trim() || undefined,
        description: createFormData.description.trim() || undefined,
        parentId: parentId,
      });

      if (result.success) {
        toast.success(`分类 "${createFormData.name}" 已创建`);
        closeCreateDialog();
        fetchData(true); // 刷新统计数据
      } else {
        toast.error(result.message || "未知错误");
      }
    } catch (error) {
      console.error("创建分类失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <GridItem areas={[1, 2, 3, 4, 5, 6]} width={2} height={0.5}>
        <AutoTransition type="scale" className="h-full">
          {result ? (
            <div
              className="flex flex-col justify-between p-10 h-full"
              key="content"
            >
              <div>
                <div className="flex justify-between items-center gap-x-4 py-2">
                  <h1 className="text-2xl text-foreground">分类统计</h1>
                  {currentCategory && (
                    <Clickable
                      onClick={() => {
                        if (categoryPath.length === 1) {
                          navigate("/admin/categories");
                        } else {
                          const parentPath = categoryPath
                            .slice(0, -1)
                            .join("/");
                          navigate(`/admin/categories/${parentPath}`);
                        }
                      }}
                    >
                      <RiArrowLeftSLine size="2em" />
                    </Clickable>
                  )}
                </div>
                <div className="space-y-2">
                  <div>
                    {currentCategory && (
                      <>正在查看&quot;{currentCategory.name}&quot;的子分类。</>
                    )}
                  </div>
                  <div>
                    当前共有 {result.total.total} 个分类
                    {result.total.total > 0 &&
                      (() => {
                        const parts = [
                          result.total.topLevel > 0 &&
                            `${result.total.topLevel} 个顶级分类`,
                          result.total.withPosts > 0 &&
                            `${result.total.withPosts} 个有文章`,
                          result.total.withoutPosts > 0 &&
                            `${result.total.withoutPosts} 个无文章`,
                        ].filter(Boolean);
                        return parts.length > 0
                          ? `，其中 ${parts.join("、")}`
                          : "";
                      })()}
                    。
                  </div>
                  {!currentCategory && result.depth.maxDepth > 0 && (
                    <div>
                      最大层级深度：{result.depth.maxDepth}，平均深度：
                      {result.depth.avgDepth.toFixed(1)}
                    </div>
                  )}
                  {result.new.last7Days > 0 ||
                  result.new.last30Days > 0 ||
                  result.new.lastYear > 0 ? (
                    <div>
                      {(() => {
                        const parts: string[] = [];
                        if (result.new.last7Days > 0) {
                          parts.push(
                            `最近一周新增了 ${result.new.last7Days} 个`,
                          );
                        }
                        if (result.new.last30Days > result.new.last7Days) {
                          parts.push(`本月共新增 ${result.new.last30Days} 个`);
                        } else if (
                          result.new.last30Days > 0 &&
                          result.new.last7Days === 0
                        ) {
                          parts.push(`本月新增了 ${result.new.last30Days} 个`);
                        }
                        if (result.new.lastYear > result.new.last30Days) {
                          parts.push(`今年累计新增 ${result.new.lastYear} 个`);
                        } else if (
                          result.new.lastYear > 0 &&
                          result.new.last30Days === 0
                        ) {
                          parts.push(`今年新增了 ${result.new.lastYear} 个`);
                        }
                        return parts.length > 0
                          ? parts.join("，") + "。"
                          : "近一年没有新增分类。";
                      })()}
                    </div>
                  ) : (
                    <div>近一年没有新增分类。</div>
                  )}

                  {result.total.total === 0 && (
                    <div className="text-muted-foreground">暂无分类数据。</div>
                  )}
                </div>
              </div>
              <div>
                {refreshTime && (
                  <div className="inline-flex items-center gap-2">
                    最近更新于: {new Date(refreshTime).toLocaleString()}
                    {result.cache && " (缓存)"}
                    <Clickable onClick={() => fetchData(true)}>
                      <RiRefreshLine size={"1em"} />
                    </Clickable>
                  </div>
                )}
              </div>
            </div>
          ) : error ? (
            <div className="px-10 h-full" key="error">
              <ErrorPage reason={error} reset={() => fetchData(true)} />
            </div>
          ) : (
            <div className="h-full">
              <LoadingIndicator key="loading" />
            </div>
          )}
        </AutoTransition>
      </GridItem>
      <GridItem areas={[7, 8]} width={6} height={0.2}>
        <AutoTransition type="scale" className="h-full">
          <button
            onClick={openCreateDialog}
            className="h-full w-full flex gap-2 items-center justify-center text-2xl hover:bg-primary hover:text-primary-foreground transition-all cursor-pointer"
          >
            <RiAddLine size="1.1em" />{" "}
            {currentCategory
              ? `在"${currentCategory.name}"下新建分类`
              : "新建顶级分类"}
          </button>
        </AutoTransition>
      </GridItem>

      {/* 创建分类对话框 */}
      <Dialog
        open={createDialogOpen}
        onClose={closeCreateDialog}
        title={
          currentCategory
            ? `在"${currentCategory.name}"下新建分类`
            : "新建顶级分类"
        }
        size="md"
      >
        <div className="px-6 py-6 space-y-6">
          <div className="space-y-4">
            <Input
              label="分类名称"
              value={createFormData.name}
              onChange={(e) =>
                setCreateFormData((prev) => ({
                  ...prev,
                  name: e.target.value,
                }))
              }
              required
              size="sm"
              helperText="输入分类名称"
            />
            <Input
              label="Slug（可选）"
              value={createFormData.slug}
              onChange={(e) =>
                setCreateFormData((prev) => ({
                  ...prev,
                  slug: e.target.value,
                }))
              }
              size="sm"
              helperText="只能包含小写字母、数字和连字符，留空则自动生成"
            />
            <Input
              label="描述（可选）"
              value={createFormData.description}
              onChange={(e) =>
                setCreateFormData((prev) => ({
                  ...prev,
                  description: e.target.value,
                }))
              }
              rows={3}
              size="sm"
              helperText="分类的简短描述"
            />
          </div>

          <div className="flex justify-end gap-4 pt-4 border-t border-foreground/10">
            <Button
              label="取消"
              variant="ghost"
              onClick={closeCreateDialog}
              size="sm"
              disabled={isSubmitting}
            />
            <Button
              label="创建"
              variant="primary"
              onClick={handleCreateCategory}
              size="sm"
              loading={isSubmitting}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}
