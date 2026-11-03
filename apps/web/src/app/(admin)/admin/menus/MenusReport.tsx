"use client";

import { useCallback, useEffect, useState } from "react";
import { RiAddLine, RiRefreshLine } from "@remixicon/react";

import { createMenu } from "@/actions/menu";
import { GridItem } from "@/components/client/layout/RowGrid";
import ErrorPage from "@/components/ui/Error";
import { useBroadcastSender } from "@/hooks/use-broadcast";
import { getMenusStats } from "@/lib/client/api/menu-read";
import runWithAuth from "@/lib/client/run-with-auth";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
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
    main: number;
    common: number;
    outsite: number;
  };
};

export default function MenusReport() {
  const toast = useToast();
  const [result, setResult] = useState<StatsData | null>(null);
  const [refreshTime, setRefreshTime] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const { broadcast } = useBroadcastSender<{ type: "menus-refresh" }>();

  // 创建对话框
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createFormData, setCreateFormData] = useState({
    name: "",
    icon: "",
    link: "",
    slug: "",
    status: "ACTIVE" as "ACTIVE" | "SUSPENDED",
    order: 0,
    category: "COMMON" as "MAIN" | "COMMON" | "OUTSITE",
    linkType: "internal" as "internal" | "external",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchData = useCallback(
    async (forceRefresh: boolean = false) => {
      if (forceRefresh) {
        setResult(null);
      }
      setError(null);
      const res = await runWithAuth(getMenusStats, { force: forceRefresh });
      if (!res || !("data" in res) || !res.data) {
        setError(new Error("获取菜单统计失败"));
        return;
      }
      setResult(res.data);
      setRefreshTime(new Date(res.data.updatedAt));

      // 刷新成功后广播消息,通知其他组件更新
      if (forceRefresh) {
        await broadcast({ type: "menus-refresh" });
      }
    },
    [broadcast],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 打开创建对话框
  const openCreateDialog = () => {
    setCreateFormData({
      name: "",
      icon: "",
      link: "",
      slug: "",
      status: "ACTIVE",
      order: 0,
      category: "COMMON",
      linkType: "internal",
    });
    setCreateDialogOpen(true);
  };

  // 关闭创建对话框
  const closeCreateDialog = () => {
    setCreateDialogOpen(false);
  };

  // 处理链接类型切换
  const handleLinkTypeChange = (type: "internal" | "external") => {
    setCreateFormData((prev) => ({
      ...prev,
      linkType: type,
      link: type === "internal" ? "" : prev.link,
      slug: type === "external" ? "" : prev.slug,
    }));
  };

  // 创建菜单
  const handleCreateMenu = async () => {
    if (!createFormData.name.trim()) {
      toast.error("菜单名称不能为空");
      return;
    }

    if (createFormData.linkType === "internal" && !createFormData.slug.trim()) {
      toast.error("内部链接的 slug 不能为空");
      return;
    }

    if (createFormData.linkType === "external" && !createFormData.link.trim()) {
      toast.error("外部链接的 URL 不能为空");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await runWithAuth(createMenu, {
        name: createFormData.name.trim(),
        icon: createFormData.icon.trim() || undefined,
        status: createFormData.status,
        order: createFormData.order,
        category: createFormData.category,
        link:
          createFormData.linkType === "external"
            ? createFormData.link.trim()
            : undefined,
        slug:
          createFormData.linkType === "internal"
            ? createFormData.slug.trim()
            : undefined,
      });

      if (result && "data" in result && result.data) {
        toast.success(`菜单 "${createFormData.name}" 已创建`);
        closeCreateDialog();
        fetchData(true); // 刷新统计数据
      } else {
        toast.error("创建失败");
      }
    } catch (error) {
      console.error("创建菜单失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
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
                <div className="text-2xl py-2">菜单统计</div>
                <div>
                  当前共有 {result.total.total} 个菜单项
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
                    {result.total.main > 0 ||
                    result.total.common > 0 ||
                    result.total.outsite > 0 ? (
                      <>
                        包含 {result.total.main} 个主导航菜单
                        {result.total.common > 0 &&
                          `、${result.total.common} 个常用链接`}
                        {result.total.outsite > 0 &&
                          ` 和 ${result.total.outsite} 个外部链接`}
                        。
                      </>
                    ) : result.total.total > 0 ? (
                      "暂无菜单数据。"
                    ) : (
                      "暂无菜单数据。"
                    )}
                  </div>

                  {result.total.total > 0 && (
                    <>
                      <div>
                        主导航占比：
                        {result.total.total > 0
                          ? `${((result.total.main / result.total.total) * 100).toFixed(1)}%`
                          : "0%"}
                        ，常用链接占比：
                        {result.total.total > 0
                          ? `${((result.total.common / result.total.total) * 100).toFixed(1)}%`
                          : "0%"}
                        ，外部链接占比：
                        {result.total.total > 0
                          ? `${((result.total.outsite / result.total.total) * 100).toFixed(1)}%`
                          : "0%"}
                        。
                      </div>

                      {result.total.active > 0 && (
                        <div>
                          当前有 {result.total.active}{" "}
                          个菜单项处于激活状态，占总数的{" "}
                          {result.total.total > 0
                            ? `${((result.total.active / result.total.total) * 100).toFixed(1)}%`
                            : "0%"}
                          。
                        </div>
                      )}

                      {result.total.suspended > 0 && (
                        <div>
                          有 {result.total.suspended} 个菜单项处于暂停状态。
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div>
                {refreshTime && (
                  <div className="inline-flex items-center gap-2">
                    {result.cache ? "统计缓存于" : "最近更新于"}:{" "}
                    {new Date(refreshTime).toLocaleString()}
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
          <Clickable
            onClick={openCreateDialog}
            hoverScale={1}
            className="h-full flex gap-2 items-center justify-center text-2xl hover:bg-primary hover:text-primary-foreground transition-all"
          >
            <RiAddLine size="1.1em" /> 新建菜单
          </Clickable>
        </AutoTransition>
      </GridItem>

      {/* 创建菜单对话框 */}
      <Dialog
        open={createDialogOpen}
        onClose={closeCreateDialog}
        title="新建菜单"
        size="md"
      >
        <div className="px-6 py-6 space-y-6">
          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                基本信息
              </h3>
            </div>
            <div className="space-y-4">
              <Input
                label="菜单名称"
                value={createFormData.name}
                onChange={(e) =>
                  setCreateFormData((prev) => ({
                    ...prev,
                    name: e.target.value,
                  }))
                }
                required
                size="sm"
                helperText="显示在导航栏的文字"
              />
              <Input
                label="图标名称"
                value={createFormData.icon}
                onChange={(e) =>
                  setCreateFormData((prev) => ({
                    ...prev,
                    icon: e.target.value,
                  }))
                }
                size="sm"
                helperText="Remix Icon 图标名（如：home-3-fill、article-fill）"
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-foreground">
                    分类 <span className="text-destructive">*</span>
                  </label>
                  <Select
                    value={createFormData.category}
                    onChange={(value) =>
                      setCreateFormData((prev) => ({
                        ...prev,
                        category: value as "MAIN" | "COMMON" | "OUTSITE",
                      }))
                    }
                    options={[
                      { value: "MAIN", label: "主导航" },
                      { value: "COMMON", label: "常用链接" },
                      { value: "OUTSITE", label: "外部链接" },
                    ]}
                    size="sm"
                  />
                </div>
                <Input
                  label="排序"
                  type="number"
                  value={String(createFormData.order)}
                  onChange={(e) =>
                    setCreateFormData((prev) => ({
                      ...prev,
                      order: Number(e.target.value),
                    }))
                  }
                  size="sm"
                  helperText="数字越小越靠前"
                  placeholder="0"
                />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                链接设置
              </h3>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  链接类型 <span className="text-destructive">*</span>
                </label>
                <Select
                  value={createFormData.linkType}
                  onChange={(value) =>
                    handleLinkTypeChange(value as "internal" | "external")
                  }
                  options={[
                    { value: "internal", label: "内部路径 (slug)" },
                    { value: "external", label: "外部链接 (URL)" },
                  ]}
                  size="sm"
                />
              </div>
              {createFormData.linkType === "internal" ? (
                <Input
                  label="内部路径 (slug)"
                  value={createFormData.slug}
                  onChange={(e) =>
                    setCreateFormData((prev) => ({
                      ...prev,
                      slug: e.target.value,
                    }))
                  }
                  size="sm"
                  helperText="站内路径，如：posts、about、categories"
                  required
                />
              ) : (
                <Input
                  label="外部链接 (URL)"
                  value={createFormData.link}
                  onChange={(e) =>
                    setCreateFormData((prev) => ({
                      ...prev,
                      link: e.target.value,
                    }))
                  }
                  size="sm"
                  helperText="完整的 URL 地址"
                  required
                />
              )}
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">状态</h3>
            </div>
            <div className="space-y-2">
              <Select
                value={createFormData.status}
                onChange={(value) =>
                  setCreateFormData((prev) => ({
                    ...prev,
                    status: value as "ACTIVE" | "SUSPENDED",
                  }))
                }
                options={[
                  { value: "ACTIVE", label: "激活" },
                  { value: "SUSPENDED", label: "暂停" },
                ]}
                size="sm"
              />
              <p className="text-sm text-muted-foreground">
                激活：菜单项将在导航栏显示 <br />
                暂停：菜单项将不会显示
              </p>
            </div>
          </section>

          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end sm:gap-4">
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
              onClick={handleCreateMenu}
              size="sm"
              loading={isSubmitting}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}
