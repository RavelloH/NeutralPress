"use client";

import { useCallback, useEffect, useState } from "react";
import { RiFolderAddFill, RiGithubFill, RiRefreshLine } from "@remixicon/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { createProject, syncProjectsGithub } from "@/actions/project";
import { CategoryInput } from "@/components/client/features/categories/CategoryInput";
import MediaSelector from "@/components/client/features/media/MediaSelector";
import type { SelectedTag } from "@/components/client/features/tags/TagInput";
import { TagInput } from "@/components/client/features/tags/TagInput";
import { GridItem } from "@/components/client/layout/RowGrid";
import ErrorPage from "@/components/ui/Error";
import { useBroadcastSender } from "@/hooks/use-broadcast";
import { getProjectsStats } from "@/lib/client/api/stats";
import runWithAuth from "@/lib/client/run-with-auth";
import { AutoResizer } from "@/ui/AutoResizer";
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
    published: number;
    draft: number;
    archived: number;
    developing: number;
  };
  github: {
    syncEnabled: number;
    totalStars: number;
    totalForks: number;
  };
  new: {
    last7Days: number;
    last30Days: number;
    lastYear: number;
  };
};

const getNewProjectsDescription = (
  last7Days: number,
  last30Days: number,
  lastYear: number,
) => {
  if (last7Days === 0 && last30Days === 0 && lastYear === 0) {
    return "近一年没有新增项目";
  }

  const parts: string[] = [];

  if (last7Days > 0) {
    parts.push(`最近一周新增了 ${last7Days} 个`);
  }

  if (last30Days > last7Days) {
    parts.push(`本月共新增 ${last30Days} 个`);
  } else if (last30Days > 0 && last7Days === 0) {
    parts.push(`本月新增了 ${last30Days} 个`);
  }

  if (lastYear > last30Days) {
    parts.push(`今年累计新增 ${lastYear} 个`);
  } else if (lastYear > 0 && last30Days === 0) {
    parts.push(`今年新增了 ${lastYear} 个`);
  }

  return parts.join("，");
};

export default function ProjectsReport() {
  const toast = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [result, setResult] = useState<StatsData | null>(null);
  const [refreshTime, setRefreshTime] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const { broadcast } = useBroadcastSender<{ type: "projects-refresh" }>();

  // 新建项目表单状态
  const [newProjectForm, setNewProjectForm] = useState({
    title: "",
    slug: "",
    description: "",
    status: "PUBLISHED" as "DRAFT" | "PUBLISHED" | "ARCHIVED" | "DEVELOPING",
    demoUrl: "",
    repoUrl: "",
    urls: "",
    techStack: [] as string[],
    repoPath: "",
    license: "",
    enableGithubSync: false,
    enableConentSync: false,
    syncImmediately: false,
    startedAt: "",
    completedAt: "",
    category: null as string | null,
    tags: [] as SelectedTag[],
    featuredImages: [] as string[],
    isFeatured: false,
    sortOrder: 0,
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
      const res = await runWithAuth(getProjectsStats, { force: forceRefresh });
      if (!res || !("data" in res) || !res.data) {
        setError(new Error("获取项目统计失败"));
        return;
      }
      const data = res.data;
      setResult(data);
      setRefreshTime(new Date(data.updatedAt));

      if (forceRefresh) {
        await broadcast({ type: "projects-refresh" });
      }
    },
    [broadcast],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 打开新建项目对话框
  const openCreateDialog = useCallback(() => {
    setNewProjectForm({
      title: "",
      slug: "",
      description: "",
      status: "DRAFT",
      demoUrl: "",
      repoUrl: "",
      urls: "",
      techStack: [],
      repoPath: "",
      license: "",
      enableGithubSync: false,
      enableConentSync: false,
      syncImmediately: false,
      startedAt: "",
      completedAt: "",
      category: null,
      tags: [],
      featuredImages: [],
      isFeatured: false,
      sortOrder: 0,
      metaDescription: "",
      metaKeywords: "",
      robotsIndex: true,
    });
    setCreateDialogOpen(true);
  }, []);

  // 监听 URL 参数 action=new
  useEffect(() => {
    if (searchParams.get("action") === "new") {
      openCreateDialog();
      const params = new URLSearchParams(searchParams.toString());
      params.delete("action");
      router.replace(`${pathname}?${params.toString()}`);
    }
  }, [searchParams, pathname, router, openCreateDialog]);

  // 处理创建项目
  const handleCreateProject = async () => {
    if (!newProjectForm.title.trim()) {
      toast.error("请输入项目标题");
      return;
    }

    setIsCreating(true);
    try {
      const result = await runWithAuth(createProject, {
        title: newProjectForm.title,
        slug: newProjectForm.slug || undefined,
        description: newProjectForm.description || undefined,
        status: newProjectForm.status,
        demoUrl: newProjectForm.demoUrl || undefined,
        repoUrl: newProjectForm.repoUrl || undefined,
        urls: newProjectForm.urls
          ? newProjectForm.urls
              .split("\n")
              .map((url) => url.trim())
              .filter(Boolean)
          : undefined,
        techStack:
          newProjectForm.techStack.length > 0
            ? newProjectForm.techStack
            : undefined,
        repoPath: newProjectForm.repoPath || undefined,
        license: newProjectForm.license || undefined,
        enableGithubSync: newProjectForm.enableGithubSync,
        enableConentSync: newProjectForm.enableConentSync,
        syncImmediately: newProjectForm.syncImmediately,
        startedAt: newProjectForm.startedAt || undefined,
        completedAt: newProjectForm.completedAt || undefined,
        categories: newProjectForm.category
          ? [newProjectForm.category]
          : undefined,
        tags:
          newProjectForm.tags.length > 0
            ? newProjectForm.tags.map((tag) => tag.name)
            : undefined,
        featuredImages:
          newProjectForm.featuredImages.length > 0
            ? newProjectForm.featuredImages
            : undefined,
        isFeatured: newProjectForm.isFeatured,
        sortOrder: newProjectForm.sortOrder,
        metaDescription: newProjectForm.metaDescription || undefined,
        metaKeywords: newProjectForm.metaKeywords || undefined,
        robotsIndex: newProjectForm.robotsIndex,
      });

      if (result && "data" in result && result.data) {
        let message = `项目 "${newProjectForm.title}" 已创建`;

        // 如果进行了同步，显示同步结果
        if (result.data.syncResult) {
          if (result.data.syncResult.success) {
            message += `，GitHub 同步成功`;
            if (result.data.syncResult.stars !== undefined) {
              message += ` (${result.data.syncResult.stars} Stars)`;
            }
          } else {
            message += `，但 GitHub 同步失败: ${result.data.syncResult.error || "未知错误"}`;
          }
        }

        toast.success(message);
        setCreateDialogOpen(false);
        // 刷新统计数据
        await fetchData(true);
      } else {
        toast.error("创建失败");
      }
    } catch (error) {
      console.error("创建项目失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsCreating(false);
    }
  };

  // 处理同步所有项目数据
  const handleSyncAllProjects = async () => {
    const toastId = toast.info(
      "正在更新所有项目...",
      "正在从 GitHub 获取最新数据...",
      0,
    );

    try {
      // 不传 ids 默认更新全部
      const result = await runWithAuth(syncProjectsGithub, {});

      if (result && "success" in result && result.success && result.data) {
        const { synced, failed } = result.data;
        if (failed > 0) {
          toast.update(
            toastId,
            "部分同步完成",
            `已同步 ${synced} 个项目，${failed} 个项目同步失败`,
            "warning",
          );
        } else {
          toast.update(
            toastId,
            "同步完成",
            `成功同步了 ${synced} 个项目的数据`,
            "success",
          );
        }
        // 刷新统计数据
        await fetchData(true);
      } else {
        toast.update(
          toastId,
          "同步失败",
          (result && "message" in result ? result.message : "未知错误") ||
            "同步过程中发生错误",
          "error",
        );
      }
    } catch (error) {
      console.error("同步所有项目失败:", error);
      toast.update(toastId, "同步出错", "网络请求失败", "error");
    }

    // 5秒后自动关闭
    setTimeout(() => toast.dismiss(toastId), 5000);
  };

  return (
    <>
      <GridItem areas={[1, 2, 3, 4]} width={3} height={0.8}>
        <AutoTransition type="scale" className="h-full">
          {result ? (
            <div
              className="flex flex-col justify-between p-10 h-full"
              key="content"
            >
              <div className="space-y-2">
                <div className="text-2xl">项目统计</div>
                <div>
                  当前共有 {result.total.total} 个项目
                  {result.total.total > 0 &&
                    (() => {
                      const parts = [
                        result.total.published > 0 &&
                          `${result.total.published} 个已发布`,
                        result.total.draft > 0 &&
                          `${result.total.draft} 个草稿`,
                        result.total.archived > 0 &&
                          `${result.total.archived} 个已归档`,
                        result.total.developing > 0 &&
                          `${result.total.developing} 个开发中`,
                      ].filter(Boolean);
                      return parts.length > 0
                        ? `，其中 ${parts.join("、")}`
                        : "";
                    })()}
                  。
                </div>
              </div>
              <div>
                <div>
                  <div>
                    {getNewProjectsDescription(
                      result.new.last7Days,
                      result.new.last30Days,
                      result.new.lastYear,
                    )}
                    。
                  </div>

                  {result.github.syncEnabled > 0 && (
                    <div className="flex items-center">
                      <span className="inline-flex items-center gap-1">
                        <RiGithubFill size="1em" />
                        {result.github.syncEnabled} 个项目已启用 GitHub 同步
                      </span>
                      {result.github.totalStars > 0 && (
                        <span className="inline-flex items-center gap-1">
                          ，共 {result.github.totalStars} Stars
                        </span>
                      )}
                      {result.github.totalForks > 0 && (
                        <span>、{result.github.totalForks} Forks</span>
                      )}
                    </div>
                  )}
                  {result.total.total === 0 && <div>暂无项目数据。</div>}
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
      <GridItem areas={[5, 6]} width={6} height={0.2}>
        <AutoTransition type="scale" className="h-full">
          <button
            onClick={openCreateDialog}
            className="h-full w-full flex gap-2 items-center justify-center text-2xl hover:bg-primary hover:text-primary-foreground transition-all cursor-pointer"
          >
            <RiFolderAddFill size="1.1em" /> 新建项目
          </button>
        </AutoTransition>
      </GridItem>
      <GridItem areas={[7, 8]} width={6} height={0.2}>
        <AutoTransition type="scale" className="h-full">
          <button
            onClick={handleSyncAllProjects}
            className="h-full w-full flex gap-2 items-center justify-center text-2xl hover:bg-primary hover:text-primary-foreground transition-all cursor-pointer"
          >
            <RiRefreshLine size="1.1em" /> 更新所有项目数据
          </button>
        </AutoTransition>
      </GridItem>

      {/* 新建项目对话框 */}
      <Dialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        title="新建项目"
        size="lg"
      >
        <div className="px-6 py-6 space-y-8">
          {/* 基本信息 */}
          <section>
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                基本信息
              </h3>
              <p className="text-sm text-muted-foreground">
                填写项目的基本信息。描述和开始时间可选填，若已设置 GitHub
                仓库路径会自动从 GitHub 获取。
              </p>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="项目标题"
                  value={newProjectForm.title}
                  onChange={(e) =>
                    setNewProjectForm({
                      ...newProjectForm,
                      title: e.target.value,
                    })
                  }
                  required
                  size="sm"
                  helperText="项目的显示名称"
                />
                <Input
                  label="Slug"
                  value={newProjectForm.slug}
                  onChange={(e) =>
                    setNewProjectForm({
                      ...newProjectForm,
                      slug: e.target.value,
                    })
                  }
                  size="sm"
                  helperText="URL 路径，留空将从标题自动生成"
                />
              </div>
              <Input
                label="项目描述"
                value={newProjectForm.description}
                onChange={(e) =>
                  setNewProjectForm({
                    ...newProjectForm,
                    description: e.target.value,
                  })
                }
                rows={2}
                size="sm"
                helperText="可选，若有 GitHub 仓库路径会自动获取"
              />
              <Input
                label="技术栈"
                value={newProjectForm.techStack.join(", ")}
                onChange={(e) =>
                  setNewProjectForm({
                    ...newProjectForm,
                    techStack: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                size="sm"
                helperText="多个技术栈用英文逗号分隔，如：React, TypeScript, Tailwind CSS"
              />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Input
                    label="开始时间"
                    type="date"
                    value={newProjectForm.startedAt}
                    onChange={(e) =>
                      setNewProjectForm({
                        ...newProjectForm,
                        startedAt: e.target.value,
                      })
                    }
                    size="sm"
                  />
                  <p className="text-muted-foreground text-sm">
                    可选，若有 GitHub 仓库路径会使用仓库创建时间
                  </p>
                </div>
                <div className="space-y-2">
                  <Input
                    label="完成时间"
                    type="date"
                    value={newProjectForm.completedAt}
                    onChange={(e) =>
                      setNewProjectForm({
                        ...newProjectForm,
                        completedAt: e.target.value,
                      })
                    }
                    size="sm"
                  />
                  <p className="text-muted-foreground text-sm">可选</p>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <TagInput
                label="标签"
                value={newProjectForm.tags}
                onChange={(tags) =>
                  setNewProjectForm({ ...newProjectForm, tags })
                }
                helperText="输入关键词搜索现有标签，或直接创建新标签"
                size="sm"
              />
              <CategoryInput
                label="分类"
                value={newProjectForm.category}
                onChange={(category) =>
                  setNewProjectForm({ ...newProjectForm, category })
                }
                size="sm"
              />
            </div>
          </section>

          {/* 链接信息 */}
          <section>
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                链接信息
              </h3>
              <p className="text-sm text-muted-foreground">
                用于在项目页面展示相关链接。
              </p>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Demo URL"
                  value={newProjectForm.demoUrl}
                  onChange={(e) =>
                    setNewProjectForm({
                      ...newProjectForm,
                      demoUrl: e.target.value,
                    })
                  }
                  size="sm"
                  helperText="项目演示地址"
                />
                <Input
                  label="仓库 URL"
                  value={newProjectForm.repoUrl}
                  onChange={(e) =>
                    setNewProjectForm({
                      ...newProjectForm,
                      repoUrl: e.target.value,
                    })
                  }
                  size="sm"
                  helperText="GitHub/GitLab 等仓库地址"
                />
              </div>
              <Input
                label="其他链接 (Urls)"
                value={newProjectForm.urls}
                onChange={(e) =>
                  setNewProjectForm({
                    ...newProjectForm,
                    urls: e.target.value,
                  })
                }
                rows={3}
                size="sm"
                helperText="每行一个链接"
              />
            </div>
          </section>

          {/* 展示设置 */}
          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                展示设置
              </h3>
            </div>
            <div className="space-y-4 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-foreground">状态</label>
                <Select
                  value={newProjectForm.status}
                  onChange={(value) =>
                    setNewProjectForm({
                      ...newProjectForm,
                      status: value as
                        | "DRAFT"
                        | "PUBLISHED"
                        | "ARCHIVED"
                        | "DEVELOPING",
                    })
                  }
                  options={[
                    { value: "DRAFT", label: "草稿" },
                    { value: "PUBLISHED", label: "已发布" },
                    { value: "DEVELOPING", label: "开发中" },
                    { value: "ARCHIVED", label: "已归档" },
                  ]}
                  size="sm"
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-sm text-foreground">
                  置顶状态
                </label>
                <Select
                  value={newProjectForm.isFeatured ? "true" : "false"}
                  onChange={(value) =>
                    setNewProjectForm({
                      ...newProjectForm,
                      isFeatured: value === "true",
                    })
                  }
                  options={[
                    { value: "false", label: "常规" },
                    { value: "true", label: "置顶" },
                  ]}
                  size="sm"
                  className="w-full"
                />
              </div>
            </div>
            <Input
              label="排序权重"
              value={String(newProjectForm.sortOrder)}
              onChange={(e) =>
                setNewProjectForm({
                  ...newProjectForm,
                  sortOrder: parseInt(e.target.value) || 0,
                })
              }
              type="number"
              size="sm"
              helperText="数字越大排序越靠前"
            />
          </section>

          {/* SEO 设置 */}
          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                SEO 设置
              </h3>
            </div>
            <div className="space-y-4">
              <Input
                label="Meta Description"
                value={newProjectForm.metaDescription}
                onChange={(e) =>
                  setNewProjectForm({
                    ...newProjectForm,
                    metaDescription: e.target.value,
                  })
                }
                rows={2}
                size="sm"
                helperText="SEO 描述，建议 160 字以内，留空则使用项目描述内容"
              />
              <Input
                label="Meta Keywords"
                value={newProjectForm.metaKeywords}
                onChange={(e) =>
                  setNewProjectForm({
                    ...newProjectForm,
                    metaKeywords: e.target.value,
                  })
                }
                size="sm"
                helperText="SEO 关键词，用英文逗号分隔"
              />
              <Checkbox
                label="允许搜索引擎索引 (Robots Index)"
                checked={newProjectForm.robotsIndex}
                onChange={(e) =>
                  setNewProjectForm({
                    ...newProjectForm,
                    robotsIndex: e.target.checked,
                  })
                }
              />
            </div>
          </section>

          {/* GitHub 同步设置 */}
          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                GitHub 同步
              </h3>
              <p className="text-sm text-muted-foreground">
                启用后将自动同步仓库的 Stars、Forks、语言等信息。
              </p>
            </div>
            <AutoResizer>
              <div className="space-y-4 flex flex-col">
                <Input
                  label="GitHub 仓库路径"
                  value={newProjectForm.repoPath}
                  onChange={(e) =>
                    setNewProjectForm({
                      ...newProjectForm,
                      repoPath: e.target.value,
                    })
                  }
                  size="sm"
                  helperText='格式：owner/repo，如 "RavelloH/NeutralPress"'
                />
                <Input
                  label="开源许可证"
                  value={newProjectForm.license}
                  onChange={(e) =>
                    setNewProjectForm({
                      ...newProjectForm,
                      license: e.target.value,
                    })
                  }
                  size="sm"
                  disabled={newProjectForm.enableGithubSync}
                  helperText={
                    newProjectForm.enableGithubSync
                      ? "已启用 GitHub 同步，许可证将从仓库自动获取"
                      : "项目的开源许可证类型，如：MIT、Apache-2.0"
                  }
                />
                <Checkbox
                  label="启用 GitHub 同步"
                  checked={newProjectForm.enableGithubSync}
                  onChange={(e) =>
                    setNewProjectForm({
                      ...newProjectForm,
                      enableGithubSync: e.target.checked,
                    })
                  }
                />
                <AutoTransition className="flex flex-col space-y-4">
                  {newProjectForm.enableGithubSync && (
                    <>
                      <Checkbox
                        label="同步 README 内容"
                        checked={newProjectForm.enableConentSync}
                        onChange={(e) =>
                          setNewProjectForm({
                            ...newProjectForm,
                            enableConentSync: e.target.checked,
                          })
                        }
                      />
                      <Checkbox
                        label="创建后立即同步"
                        checked={newProjectForm.syncImmediately}
                        onChange={(e) =>
                          setNewProjectForm({
                            ...newProjectForm,
                            syncImmediately: e.target.checked,
                          })
                        }
                      />
                    </>
                  )}
                </AutoTransition>
              </div>
            </AutoResizer>
          </section>

          {/* 特色图片 */}
          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                特色图片
              </h3>
              <p className="text-sm text-muted-foreground">
                可以选择多张图片作为项目展示图。
              </p>
            </div>
            <MediaSelector
              label="特色图片"
              value={newProjectForm.featuredImages}
              onChange={(urls) =>
                setNewProjectForm({
                  ...newProjectForm,
                  featuredImages: Array.isArray(urls)
                    ? urls
                    : urls
                      ? [urls]
                      : [],
                })
              }
              multiple
              helperText="选择或上传项目的特色图片"
            />
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
              label="创建项目"
              variant="primary"
              onClick={handleCreateProject}
              size="sm"
              loading={isCreating}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}
