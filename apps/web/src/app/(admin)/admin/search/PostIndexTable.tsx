"use client";

import { useEffect, useState } from "react";
import {
  RiAlertLine,
  RiCheckLine,
  RiDeleteBinLine,
  RiErrorWarningLine,
  RiEyeLine,
  RiRefreshLine,
} from "@remixicon/react";
import type {
  IndexStatusItem,
  PostTokenDetails,
} from "@repo/shared-types/api/search";

import { deleteIndex, indexPosts } from "@/actions/search";
import type { ActionButton, FilterConfig } from "@/components/ui/GridTable";
import GridTable from "@/components/ui/GridTable";
import Link from "@/components/ui/Link";
import { useBroadcast } from "@/hooks/use-broadcast";
import {
  getIndexStatus,
  getPostTokenDetails,
} from "@/lib/client/api/search-admin-read";
import { AlertDialog } from "@/ui/AlertDialog";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { Dialog } from "@/ui/Dialog";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import type { TableColumn } from "@/ui/Table";
import { useToast } from "@/ui/Toast";

export default function PostIndexTable() {
  const toast = useToast();
  const [data, setData] = useState<IndexStatusItem[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortKey, setSortKey] = useState<string | null>("updatedAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | null>("desc");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [selectedPosts, setSelectedPosts] = useState<(string | number)[]>([]);
  const [filterValues, setFilterValues] = useState<
    Record<string, string | string[] | { start?: string; end?: string }>
  >({});

  // 监听广播刷新消息
  useBroadcast<{ type: string }>(async (message) => {
    if (message.type === "search-index-refresh") {
      setRefreshTrigger((prev) => prev + 1); // 触发刷新
    }
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [indexDialogOpen, setIndexDialogOpen] = useState(false);
  const [indexingPost, setIndexingPost] = useState<IndexStatusItem | null>(
    null,
  );
  const [batchIndexDialogOpen, setBatchIndexDialogOpen] = useState(false);

  // 删除索引相关状态
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingPost, setDeletingPost] = useState<IndexStatusItem | null>(
    null,
  );
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);

  // 详情对话框相关状态
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tokenDetails, setTokenDetails] = useState<PostTokenDetails | null>(
    null,
  );
  const [selectedPost, setSelectedPost] = useState<IndexStatusItem | null>(
    null,
  );

  // 处理选中状态变化
  const handleSelectionChange = (selectedKeys: (string | number)[]) => {
    setSelectedPosts(selectedKeys);
  };

  // 打开索引单个文章对话框
  const openIndexDialog = (post: IndexStatusItem) => {
    setIndexingPost(post);
    setIndexDialogOpen(true);
  };

  // 关闭索引对话框
  const closeIndexDialog = () => {
    setIndexDialogOpen(false);
    setIndexingPost(null);
  };

  // 确认索引单个文章
  const handleConfirmIndex = async () => {
    if (!indexingPost) return;

    setIsSubmitting(true);
    try {
      const result = await indexPosts({
        slugs: [indexingPost.slug],
      });

      if (result.success && result.data) {
        toast.success(
          `文章 "${indexingPost.title}" 索引成功 (${result.data.indexed}/${result.data.total})`,
        );
        closeIndexDialog();
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error(result.message || "索引失败");
      }
    } catch (error) {
      console.error("索引文章失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 打开批量索引对话框
  const openBatchIndexDialog = () => {
    setBatchIndexDialogOpen(true);
  };

  // 关闭批量索引对话框
  const closeBatchIndexDialog = () => {
    setBatchIndexDialogOpen(false);
  };

  // 确认批量索引
  const handleConfirmBatchIndex = async () => {
    setIsSubmitting(true);
    try {
      const slugs = selectedPosts.map((slug) => String(slug));
      const result = await indexPosts({
        slugs,
      });

      if (result.success && result.data) {
        toast.success(
          `批量索引完成：${result.data.indexed} 成功，${result.data.failed} 失败`,
        );
        if (result.data.errors && result.data.errors.length > 0) {
          console.error("索引错误:", result.data.errors);
        }
        closeBatchIndexDialog();
        setRefreshTrigger((prev) => prev + 1);
        setSelectedPosts([]);
      } else {
        toast.error(result.message || "批量索引失败");
      }
    } catch (error) {
      console.error("批量索引失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 打开删除单个索引对话框
  const openDeleteDialog = (post: IndexStatusItem) => {
    setDeletingPost(post);
    setDeleteDialogOpen(true);
  };

  // 关闭删除对话框
  const closeDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setDeletingPost(null);
  };

  // 确认删除单个索引
  const handleConfirmDelete = async () => {
    if (!deletingPost) return;

    setIsSubmitting(true);
    try {
      const result = await deleteIndex({
        slugs: [deletingPost.slug],
      });

      if (result.success && result.data) {
        toast.success(
          `文章 "${deletingPost.title}" 索引已删除 (${result.data.deleted}/${result.data.total})`,
        );
        closeDeleteDialog();
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error(result.message || "删除失败");
      }
    } catch (error) {
      console.error("删除文章索引失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 打开批量删除对话框
  const openBatchDeleteDialog = () => {
    setBatchDeleteDialogOpen(true);
  };

  // 关闭批量删除对话框
  const closeBatchDeleteDialog = () => {
    setBatchDeleteDialogOpen(false);
  };

  // 确认批量删除索引
  const handleConfirmBatchDelete = async () => {
    setIsSubmitting(true);
    try {
      const slugs = selectedPosts.map((slug) => String(slug));
      const result = await deleteIndex({
        slugs,
      });

      if (result.success && result.data) {
        toast.success(
          `批量删除完成：${result.data.deleted} 成功，${result.data.failed} 失败`,
        );
        if (result.data.errors && result.data.errors.length > 0) {
          console.error("删除错误:", result.data.errors);
        }
        closeBatchDeleteDialog();
        setRefreshTrigger((prev) => prev + 1);
        setSelectedPosts([]);
      } else {
        toast.error(result.message || "批量删除失败");
      }
    } catch (error) {
      console.error("批量删除失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 打开详情对话框
  const openDetailDialog = async (post: IndexStatusItem) => {
    if (post.status === "never-indexed") {
      toast.error("该文章尚未建立索引");
      return;
    }

    // 立即打开对话框并显示基本信息
    setSelectedPost(post);
    setDetailDialogOpen(true);
    setDetailLoading(true);
    setTokenDetails(null);

    try {
      const result = await getPostTokenDetails({ slug: post.slug });
      if (result.success && result.data) {
        setTokenDetails(result.data);
      } else {
        toast.error(result.message || "获取分词详情失败");
        setDetailDialogOpen(false);
      }
    } catch (error) {
      console.error("获取分词详情失败:", error);
      toast.error("获取分词详情失败");
      setDetailDialogOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  // 关闭详情对话框
  const closeDetailDialog = () => {
    setDetailDialogOpen(false);
    setTokenDetails(null);
    setSelectedPost(null);
  };

  // 批量操作按钮
  const batchActions: ActionButton[] = [
    {
      label: "批量重建索引",
      onClick: openBatchIndexDialog,
      icon: <RiRefreshLine size="1em" />,
      variant: "primary",
    },
    {
      label: "批量删除索引",
      onClick: openBatchDeleteDialog,
      icon: <RiDeleteBinLine size="1em" />,
      variant: "danger",
    },
  ];

  // 行操作按钮
  const rowActions = (record: Record<string, unknown>): ActionButton[] => [
    {
      label: "查看详情",
      onClick: () => {
        void openDetailDialog(record as unknown as IndexStatusItem);
      },
      icon: <RiEyeLine size="1em" />,
      variant: "ghost",
    },
    {
      label: "重建索引",
      onClick: () => openIndexDialog(record as unknown as IndexStatusItem),
      icon: <RiRefreshLine size="1em" />,
      variant: "ghost",
    },
    {
      label: "删除索引",
      onClick: () => openDeleteDialog(record as unknown as IndexStatusItem),
      icon: <RiDeleteBinLine size="1em" />,
      variant: "danger",
    },
  ];

  // 处理排序变化
  const handleSortChange = (key: string, order: "asc" | "desc" | null) => {
    setSortKey(order ? key : null);
    setSortOrder(order);
    setPage(1);
  };

  // 处理筛选变化
  const handleFilterChange = (
    filters: Record<
      string,
      string | string[] | { start?: string; end?: string }
    >,
  ) => {
    setFilterValues(filters);
    setPage(1);
  };

  // 筛选配置
  const filterConfig: FilterConfig[] = [
    {
      key: "status",
      label: "索引状态",
      type: "checkboxGroup",
      options: [
        { value: "never-indexed", label: "未索引" },
        { value: "outdated", label: "已过期" },
        { value: "up-to-date", label: "已更新" },
      ],
    },
  ];

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const params: {
          page: number;
          pageSize: number;
          sortBy?: "slug" | "updatedAt" | "tokenizedAt";
          sortOrder?: "asc" | "desc";
          status?: "never-indexed" | "outdated" | "up-to-date";
        } = {
          page,
          pageSize,
        };

        if (sortKey && sortOrder) {
          // 过滤掉不支持的排序字段
          if (
            sortKey === "slug" ||
            sortKey === "updatedAt" ||
            sortKey === "tokenizedAt"
          ) {
            params.sortBy = sortKey;
            params.sortOrder = sortOrder;
          }
        }

        // 添加筛选参数
        if (
          filterValues.status &&
          Array.isArray(filterValues.status) &&
          filterValues.status.length === 1
        ) {
          params.status = filterValues.status[0] as
            | "never-indexed"
            | "outdated"
            | "up-to-date";
        }

        const result = await getIndexStatus({
          ...params,
          sortBy: params.sortBy || "updatedAt",
          sortOrder: params.sortOrder || "desc",
        });

        if (result.success && result.data) {
          setData(result.data);
          setTotalRecords(result.meta?.total || 0);
          if (result.meta) {
            setTotalPages(result.meta.totalPages);
          }
        }
      } catch (error) {
        console.error("Failed to fetch index status:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [page, pageSize, sortKey, sortOrder, filterValues, refreshTrigger]);

  const columns: TableColumn<Record<string, unknown>>[] = [
    {
      key: "title",
      title: "标题",
      dataIndex: "title",
      align: "left",
      sortable: false,
      width: "32em",
      render: (value: unknown) => {
        return (
          <span className="font-medium line-clamp-1">{String(value)}</span>
        );
      },
    },
    {
      key: "slug",
      title: "Slug",
      dataIndex: "slug",
      align: "left",
      sortable: true,
      width: "24em",
      mono: true,
      render: (value: unknown) => {
        return (
          <Link
            href={`/admin/posts/${String(value)}`}
            className="text-sm text-primary font-mono line-clamp-1"
            presets={["hover-underline"]}
          >
            {String(value)}
          </Link>
        );
      },
    },

    {
      key: "status",
      title: "索引状态",
      dataIndex: "status",
      align: "center",
      render: (value: unknown) => {
        const status = String(value);
        let statusText = "";
        let statusColor = "";
        let statusIcon = null;

        switch (status) {
          case "never-indexed":
            statusText = "未索引";
            statusColor = "text-muted-foreground";
            statusIcon = <RiErrorWarningLine size="1em" />;
            break;
          case "outdated":
            statusText = "已过期";
            statusColor = "text-warning";
            statusIcon = <RiAlertLine size="1em" />;
            break;
          case "up-to-date":
            statusText = "已更新";
            statusColor = "text-success";
            statusIcon = <RiCheckLine size="1em" />;
            break;
        }

        return (
          <span
            className={`inline-flex items-center gap-1 text-sm font-medium ${statusColor}`}
          >
            {statusIcon}
            {statusText}
          </span>
        );
      },
    },
    {
      key: "tokenCount",
      title: "词元数",
      dataIndex: "tokenCount",
      align: "center",
      mono: true,
      render: (value: unknown) => {
        if (typeof value === "number" && value > 0) {
          return <span className="text-sm">{value.toLocaleString()}</span>;
        }
        return <span className="text-muted-foreground text-sm">-</span>;
      },
    },
    {
      key: "tokenSize",
      title: "索引体积",
      dataIndex: "tokenSize",
      align: "center",
      mono: true,
      render: (value: unknown) => {
        if (typeof value === "number" && value > 0) {
          // 格式化文件大小
          const formatSize = (bytes: number): string => {
            if (bytes < 1024) return `${bytes} B`;
            if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
            return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
          };
          return <span className="text-sm">{formatSize(value)}</span>;
        }
        return <span className="text-muted-foreground text-sm">-</span>;
      },
    },
    {
      key: "updatedAt",
      title: "更新时间",
      dataIndex: "updatedAt",
      sortable: true,
      mono: true,
      render: (value: unknown) => {
        if (typeof value === "string") {
          return new Date(value).toLocaleString("zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          });
        }
        return "-";
      },
    },
    {
      key: "tokenizedAt",
      title: "索引时间",
      dataIndex: "tokenizedAt",
      sortable: true,
      mono: true,
      render: (value: unknown) => {
        if (value && typeof value === "string") {
          return new Date(value).toLocaleString("zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          });
        }
        return <span className="text-muted-foreground">从未索引</span>;
      },
    },
  ];

  return (
    <>
      <GridTable
        title="文章索引管理"
        columns={columns}
        data={data as unknown as Record<string, unknown>[]}
        loading={loading}
        rowKey="slug"
        page={page}
        totalPages={totalPages}
        totalRecords={totalRecords}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        onSortChange={handleSortChange}
        filterConfig={filterConfig}
        onFilterChange={handleFilterChange}
        striped
        hoverable
        bordered={false}
        size="sm"
        emptyText="暂无文章记录"
        stickyHeader
        maxHeight="100%"
        padding={2.5}
        enableActions={true}
        batchActions={batchActions}
        rowActions={rowActions}
        onSelectionChange={handleSelectionChange}
        onRowClick={(record) =>
          openDetailDialog(record as unknown as IndexStatusItem)
        }
      />

      {/* 索引单个文章确认对话框 */}
      <AlertDialog
        open={indexDialogOpen}
        onClose={closeIndexDialog}
        onConfirm={handleConfirmIndex}
        title="确认重建索引"
        description={
          indexingPost
            ? `确定要重建文章 "${indexingPost.title}" 的搜索索引吗？这将分析文章内容并更新分词索引。`
            : ""
        }
        confirmText="重建索引"
        cancelText="取消"
        variant="info"
        loading={isSubmitting}
      />

      {/* 批量索引确认对话框 */}
      <AlertDialog
        open={batchIndexDialogOpen}
        onClose={closeBatchIndexDialog}
        onConfirm={handleConfirmBatchIndex}
        title="确认批量重建索引"
        description={`确定要重建选中的 ${selectedPosts.length} 篇文章的搜索索引吗？这可能需要一些时间。`}
        confirmText="批量重建"
        cancelText="取消"
        variant="info"
        loading={isSubmitting}
      />

      {/* 删除单个索引确认对话框 */}
      <AlertDialog
        open={deleteDialogOpen}
        onClose={closeDeleteDialog}
        onConfirm={handleConfirmDelete}
        title="确认删除索引"
        description={
          deletingPost
            ? `确定要删除文章 "${deletingPost.title}" 的搜索索引吗？删除后该文章将无法被搜索到，直到重新建立索引。`
            : ""
        }
        confirmText="删除索引"
        cancelText="取消"
        variant="danger"
        loading={isSubmitting}
      />

      {/* 批量删除索引确认对话框 */}
      <AlertDialog
        open={batchDeleteDialogOpen}
        onClose={closeBatchDeleteDialog}
        onConfirm={handleConfirmBatchDelete}
        title="确认批量删除索引"
        description={`确定要删除选中的 ${selectedPosts.length} 篇文章的搜索索引吗？删除后这些文章将无法被搜索到，直到重新建立索引。`}
        confirmText="批量删除"
        cancelText="取消"
        variant="danger"
        loading={isSubmitting}
      />

      {/* 分词详情对话框 */}
      <Dialog
        open={detailDialogOpen}
        onClose={closeDetailDialog}
        title={`分词详情 - ${selectedPost?.title || ""}`}
        size="lg"
      >
        <AutoResizer>
          {selectedPost ? (
            <div className="px-6 py-6 space-y-6" key="details">
              {/* 基本信息 - 立即显示 */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                  基本信息
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-muted-foreground">
                      Slug
                    </label>
                    <p className="text-sm font-mono">{selectedPost.slug}</p>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">
                      索引时间
                    </label>
                    <p className="text-sm font-mono">
                      {selectedPost.tokenizedAt
                        ? new Date(selectedPost.tokenizedAt).toLocaleString(
                            "zh-CN",
                            {
                              year: "numeric",
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            },
                          )
                        : "从未索引"}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">
                      总词元数
                    </label>
                    <p className="text-sm font-semibold">
                      {selectedPost.tokenCount
                        ? `${selectedPost.tokenCount.toLocaleString()} 个`
                        : "-"}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">
                      索引体积
                    </label>
                    <p className="text-sm font-semibold">
                      {selectedPost.tokenSize
                        ? (() => {
                            const bytes = selectedPost.tokenSize;
                            if (bytes < 1024) return `${bytes} B`;
                            if (bytes < 1024 * 1024)
                              return `${(bytes / 1024).toFixed(2)} KB`;
                            return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
                          })()
                        : "-"}
                    </p>
                  </div>
                </div>
              </div>

              {/* 分词详情 - 加载中或已加载 */}
              <AutoTransition>
                {detailLoading ? (
                  <div className="py-12 text-center" key="loading">
                    <LoadingIndicator />
                  </div>
                ) : tokenDetails ? (
                  <div key="tokenDetails" className="space-y-6">
                    {/* 标题分词 */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                        标题分词（{tokenDetails.titleTokenCount} 个）
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {tokenDetails.titleTokens.map((token, index) => (
                          <span
                            key={`${token}-${index}`}
                            className="inline-block px-2 py-1 text-xs bg-primary/10 text-primary rounded-xs"
                          >
                            {token}
                          </span>
                        ))}
                        {tokenDetails.titleTokens.length === 0 && (
                          <p className="text-sm text-muted-foreground">
                            暂无标题分词
                          </p>
                        )}
                      </div>
                    </div>

                    {/* 内容分词 */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                        内容分词（{tokenDetails.contentTokenCount} 个）
                      </h3>
                      <div>
                        <div className="flex flex-wrap gap-2">
                          {tokenDetails.contentTokens.map((token, index) => (
                            <span
                              key={`${token}-${index}`}
                              className="inline-block px-2 py-1 text-xs bg-muted text-foreground rounded-xs"
                            >
                              {token}
                            </span>
                          ))}
                          {tokenDetails.contentTokens.length === 0 && (
                            <p className="text-sm text-muted-foreground">
                              暂无内容分词
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 词频 */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                        词频
                      </h3>
                      <div className="pb-4">
                        <div className="flex flex-wrap gap-2">
                          {tokenDetails.wordCloud.map(({ word, count }) => {
                            // 根据出现次数计算字体大小和颜色深度
                            const maxCount = Math.max(
                              ...tokenDetails.wordCloud.map((w) => w.count),
                            );
                            const minCount = Math.min(
                              ...tokenDetails.wordCloud.map((w) => w.count),
                            );
                            const normalizedSize =
                              minCount === maxCount
                                ? 0.5
                                : (count - minCount) / (maxCount - minCount);

                            return (
                              <span
                                key={word}
                                className={`inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-xs text-xs`}
                                style={{
                                  opacity: normalizedSize * 0.7 + 0.3,
                                }}
                              >
                                {word}
                                <span className="text-xs opacity-60">
                                  ×{count}
                                </span>
                              </span>
                            );
                          })}
                          {tokenDetails.wordCloud.length === 0 && (
                            <p className="text-sm text-muted-foreground">
                              暂无词频数据
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </AutoTransition>
            </div>
          ) : null}
        </AutoResizer>
      </Dialog>
    </>
  );
}
