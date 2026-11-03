"use client";

import { useCallback, useEffect, useState } from "react";
import { RiFileAddLine, RiRefreshLine } from "@remixicon/react";

import { createPage } from "@/actions/page";
import { GridItem } from "@/components/client/layout/RowGrid";
import ErrorPage from "@/components/ui/Error";
import { useNavigateWithTransition } from "@/components/ui/Link";
import { useBroadcastSender } from "@/hooks/use-broadcast";
import { getPagesStats } from "@/lib/client/api/stats";
import runWithAuth from "@/lib/client/run-with-auth";
import { getPageEditorPathByContentType } from "@/lib/shared/page-editor-route";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import Clickable from "@/ui/Clickable";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { Select } from "@/ui/Select";
import { useToast } from "@/ui/Toast";

type StatsData = {
  updatedAt: string;
  cache: boolean;
  total: {
    total: number;
    active: number;
    suspended: number;
    system: number;
    custom: number;
  };
};

export default function PagesReport() {
  const toast = useToast();
  const navigate = useNavigateWithTransition();
  const [result, setResult] = useState<StatsData | null>(null);
  const [refreshTime, setRefreshTime] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const { broadcast } = useBroadcastSender<{ type: "pages-refresh" }>();

  // 新建页面表单状态
  const [newPageForm, setNewPageForm] = useState({
    title: "",
    slug: "",
    status: "ACTIVE" as "ACTIVE" | "SUSPENDED",
    contentType: "BLOCK" as "MARKDOWN" | "HTML" | "MDX" | "BLOCK" | "BUILDIN",
    metaDescription: "",
    metaKeywords: "",
    robotsIndex: true,
  });

  const fetchData = useCallback(
    async (forceRefresh: boolean = false) => {
      if (forceRefresh) {
        setResult(null);
      }
      setError(null);
      const res = await runWithAuth(getPagesStats, { force: forceRefresh });
      if (!res || !("data" in res) || !res.data) {
        setError(new Error("获取页面统计失败"));
        return;
      }
      setResult(res.data);
      setRefreshTime(new Date(res.data.updatedAt));

      // 刷新成功后广播消息,通知其他组件更新
      if (forceRefresh) {
        await broadcast({ type: "pages-refresh" });
      }
    },
    [broadcast],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 打开新建页面对话框
  const openCreateDialog = () => {
    setNewPageForm({
      title: "",
      slug: "",
      status: "ACTIVE",
      contentType: "BLOCK",
      metaDescription: "",
      metaKeywords: "",
      robotsIndex: true,
    });
    setCreateDialogOpen(true);
  };

  // 处理创建页面
  const handleCreatePage = async () => {
    if (!newPageForm.title.trim()) {
      toast.error("请输入页面标题");
      return;
    }
    if (!newPageForm.slug.trim()) {
      toast.error("请输入页面路径");
      return;
    }

    setIsCreating(true);
    try {
      const result = await runWithAuth(createPage, {
        title: newPageForm.title,
        slug: newPageForm.slug.startsWith("/")
          ? newPageForm.slug
          : `/${newPageForm.slug}`,
        status: newPageForm.status,
        contentType: newPageForm.contentType,
        metaDescription: newPageForm.metaDescription || undefined,
        metaKeywords: newPageForm.metaKeywords || undefined,
        robotsIndex: newPageForm.robotsIndex,
        isSystemPage: false,
      });

      if (result && "data" in result && result.data) {
        toast.success(`页面 "${newPageForm.title}" 已创建`);
        setCreateDialogOpen(false);
        // 刷新统计数据
        await fetchData(true);
        navigate(
          getPageEditorPathByContentType(
            newPageForm.contentType,
            result.data.id,
          ),
        );
      } else {
        toast.error("创建失败");
      }
    } catch (error) {
      console.error("创建页面失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <GridItem areas={[1, 2, 3, 4, 5, 6]} width={2} height={0.8}>
        <AutoTransition type="scale" className="h-full">
          {result ? (
            <div
              className="flex flex-col justify-between p-10 h-full"
              key="content"
            >
              <div>
                <div className="text-2xl py-2">页面统计</div>
                <div>
                  当前共有 {result.total.total} 个页面
                  {result.total.total > 0 &&
                    (() => {
                      const parts = [
                        result.total.active > 0 &&
                          `${result.total.active} 个已激活`,
                        result.total.suspended > 0 &&
                          `${result.total.suspended} 个已暂停`,
                      ].filter(Boolean);
                      return parts.length > 0
                        ? `，其中 ${parts.join("、")}`
                        : "";
                    })()}
                  。
                </div>
              </div>
              <div>
                <div className="space-y-2">
                  <div>
                    {result.total.system > 0 || result.total.custom > 0 ? (
                      <>
                        包含 {result.total.system} 个系统页面
                        {result.total.custom > 0 &&
                          ` 和 ${result.total.custom} 个自定义页面`}
                        。
                      </>
                    ) : result.total.total > 0 ? (
                      "暂无页面数据。"
                    ) : (
                      "暂无页面数据。"
                    )}
                  </div>

                  {result.total.total > 0 && (
                    <>
                      <div>
                        系统页面占比：
                        {result.total.total > 0
                          ? `${((result.total.system / result.total.total) * 100).toFixed(1)}%`
                          : "0%"}
                        ，自定义页面占比：
                        {result.total.total > 0
                          ? `${((result.total.custom / result.total.total) * 100).toFixed(1)}%`
                          : "0%"}
                        。
                      </div>

                      {result.total.active > 0 && (
                        <div>
                          当前有 {result.total.active}{" "}
                          个页面处于激活状态，占活跃页面总数的{" "}
                          {result.total.total > 0
                            ? `${((result.total.active / result.total.total) * 100).toFixed(1)}%`
                            : "0%"}
                          。
                        </div>
                      )}

                      {result.total.suspended > 0 && (
                        <div>
                          有 {result.total.suspended} 个页面处于暂停状态。
                        </div>
                      )}
                    </>
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
            <RiFileAddLine size="1.1em" /> 新建页面
          </button>
        </AutoTransition>
      </GridItem>

      {/* 新建页面对话框 */}
      <Dialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        title="新建页面"
        size="lg"
      >
        <div className="px-6 py-6 space-y-8">
          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                基本信息
              </h3>
              <p className="text-sm text-muted-foreground">
                填写页面基本信息。创建后将进入对应类型编辑页（BUILDIN
                会返回列表页）。
              </p>
            </div>
            <div className="space-y-4">
              <Input
                label="路径"
                value={newPageForm.slug}
                onChange={(e) =>
                  setNewPageForm({ ...newPageForm, slug: e.target.value })
                }
                required
                size="sm"
                helperText='页面路径，如 "/about" 或 "about"'
              />
              <p className="text-sm text-muted-foreground font-mono py-2">
                路由解析规则（按优先级排序）：
                <br />
                1. 精确匹配：/about → 匹配 /about 页面
                <br />
                2. 固定路径 + 分页：/posts/page/:page → 匹配 /posts 和
                /posts/page/123 页面，提供 page 参数
                <br />
                3. 通配符路径 + 分页：/tags/:slug/page/:page → 匹配
                /tags/:slug/page/:page 页面，提供 slug 和 page 参数
                <br />
                4. 纯通配符：/posts/:slug → 匹配 /posts/:slug 页面，提供 slug
                参数
                <br />
                5. 捕获所有 (Catch-all)：/categories/:slug.../page/:page → 匹配
                /categories/a/b/c 及其分页，slug 将包含所有路径段
                <br />
                <br />
                通配符说明：
                <br />• 使用 &quot;:slug&quot; 匹配任意路径段（如
                &quot;/posts/:slug&quot; 可匹配 &quot;/posts/hello-world&quot;）
                <br />• 使用 &quot;:slug...&quot; 匹配多个路径段（如
                &quot;/categories/:slug...&quot; 可匹配
                &quot;/categories/a/b/c&quot;）
                <br />• 使用 &quot;/page/:page&quot; 创建分页路由（如
                &quot;/posts/page/:page&quot; 可匹配 &quot;/posts/page/1&quot;）
                <br />• 可组合使用：&quot;/:slug.../page/:page&quot;
              </p>
              <Input
                label="标题"
                value={newPageForm.title}
                onChange={(e) =>
                  setNewPageForm({ ...newPageForm, title: e.target.value })
                }
                required
                size="sm"
                helperText="页面标题"
              />
              <Input
                label="SEO 描述"
                value={newPageForm.metaDescription}
                onChange={(e) =>
                  setNewPageForm({
                    ...newPageForm,
                    metaDescription: e.target.value,
                  })
                }
                rows={2}
                size="sm"
                helperText="用于搜索引擎结果展示"
              />
              <p className="text-muted-foreground text-sm">
                标题与SEO描述中支持的变量：
                <br />
                {`• {slug} - 路由参数`}
                <br />
                {`• {page} - 当前页码`}
                <br />
                {`• {totalPage} - 总页数（通过数据库计数计算）`}
                <br />
                {`• {tag} - 标签名称`}
                <br />
                {`• {tagDescription} - 标签描述`}
                <br />
                {`• {category} - 分类名称（原 {categoryName} 改名）`}
                <br />
                {`• {categoryDescription} - 分类描述`}
              </p>
              <Input
                label="SEO 关键词"
                value={newPageForm.metaKeywords}
                onChange={(e) =>
                  setNewPageForm({
                    ...newPageForm,
                    metaKeywords: e.target.value,
                  })
                }
                size="sm"
                helperText="多个关键词用逗号分隔"
              />
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                页面设置
              </h3>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm text-foreground">
                  内容类型
                </label>
                <Select
                  value={newPageForm.contentType}
                  onChange={(value) =>
                    setNewPageForm({
                      ...newPageForm,
                      contentType: value as
                        | "MARKDOWN"
                        | "HTML"
                        | "MDX"
                        | "BLOCK"
                        | "BUILDIN",
                    })
                  }
                  options={[
                    { value: "BLOCK", label: "BLOCK（布局编辑器）" },
                    { value: "MARKDOWN", label: "Markdown" },
                    { value: "HTML", label: "HTML" },
                    { value: "MDX", label: "MDX" },
                    {
                      value: "BUILDIN",
                      label: "BUILDIN（内置集成，仅基础信息）",
                    },
                  ]}
                  size="sm"
                />
              </div>
              <Checkbox
                label="允许搜索引擎索引"
                checked={newPageForm.robotsIndex}
                onChange={(e) =>
                  setNewPageForm({
                    ...newPageForm,
                    robotsIndex: e.target.checked,
                  })
                }
              />
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                发布设置
              </h3>
            </div>
            <div className="space-y-2">
              <label className="block text-sm text-foreground">状态</label>
              <Select
                value={newPageForm.status}
                onChange={(value) =>
                  setNewPageForm({
                    ...newPageForm,
                    status: value as "ACTIVE" | "SUSPENDED",
                  })
                }
                options={[
                  { value: "ACTIVE", label: "激活" },
                  { value: "SUSPENDED", label: "暂停" },
                ]}
                size="sm"
              />
            </div>
          </section>

          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end sm:gap-4">
            <Button
              label="取消"
              variant="ghost"
              onClick={() => setCreateDialogOpen(false)}
              size="sm"
              disabled={isCreating}
            />
            <Button
              label={
                newPageForm.contentType === "BUILDIN"
                  ? "创建并返回列表"
                  : "创建并进入编辑器"
              }
              variant="primary"
              onClick={handleCreatePage}
              size="sm"
              loading={isCreating}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}
