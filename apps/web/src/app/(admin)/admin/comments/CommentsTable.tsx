"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  RiAlertLine,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiInformationLine,
  RiSpamLine,
} from "@remixicon/react";
import type {
  AdminCommentItem,
  CommentStatus,
} from "@repo/shared-types/api/comment";

import { deleteComments, updateCommentStatus } from "@/actions/comment";
import GridTable, {
  type ActionButton,
  type FilterConfig,
} from "@/components/ui/GridTable";
import Link from "@/components/ui/Link";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getCommentsAdmin } from "@/lib/client/api/comment-read";
import runWithAuth, { resolveApiResponse } from "@/lib/client/run-with-auth";
import { Dialog } from "@/ui/Dialog";
import type { TableColumn } from "@/ui/Table";
import { useToast } from "@/ui/Toast";

const statusLabels: Record<CommentStatus, string> = {
  APPROVED: "已通过",
  PENDING: "待审核",
  REJECTED: "已拒绝",
  SPAM: "垃圾",
};

type SortKey = "createdAt" | "status" | "id" | "postSlug";
type AdminCommentRow = AdminCommentItem & { postTitle?: string | null };

function resolveCommentTargetHref(slug: string): string {
  if (!slug) return "#";
  return slug.startsWith("/") ? slug : `/posts/${slug}`;
}

export default function CommentsTable() {
  const [data, setData] = useState<AdminCommentRow[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [filterValues, setFilterValues] = useState<
    Record<string, string | string[] | { start?: string; end?: string }>
  >({});
  const [selectedKeys, setSelectedKeys] = useState<(string | number)[]>([]);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedComment, setSelectedComment] =
    useState<AdminCommentRow | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const { success: toastSuccess, error: toastError } = useToast();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const slugFilter =
        typeof filterValues.slug === "string" && filterValues.slug.trim()
          ? filterValues.slug.trim()
          : undefined;
      const rawUid =
        typeof filterValues.uid === "string" && filterValues.uid.trim()
          ? Number.parseInt(filterValues.uid, 10)
          : undefined;
      const uidFilter = Number.isNaN(rawUid ?? NaN) ? undefined : rawUid;

      const result = await runWithAuth(getCommentsAdmin, {
        page,
        pageSize,
        sortBy: sortKey || "createdAt",
        sortOrder: sortOrder || "desc",
        search: searchQuery.trim() || undefined,
        status: Array.isArray(filterValues.status)
          ? (filterValues.status as CommentStatus[])
          : undefined,
        slug: slugFilter,
        uid: uidFilter,
        parentOnly: Array.isArray(filterValues.parentOnly)
          ? (filterValues.parentOnly as string[]).includes("true")
          : undefined,
      } as never);
      const response = await resolveApiResponse(result);
      if (response?.success && Array.isArray(response.data)) {
        setData(response.data as AdminCommentRow[]);
        setTotalPages((response.meta?.totalPages as number) || 1);
        setTotalRecords((response.meta?.total as number) || 0);
      } else {
        toastError("获取评论列表失败", response?.message || "");
      }
    } catch (error) {
      console.error("获取评论列表失败", error);
      toastError("获取评论列表失败", "请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [
    filterValues,
    page,
    pageSize,
    searchQuery,
    sortKey,
    sortOrder,
    toastError,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 通过 broadcast 通知刷新时，重新获取数据
  useEffect(() => {
    if (refreshTrigger > 0) {
      fetchData();
    }
  }, [refreshTrigger, fetchData]);

  useBroadcast<{ type: string }>((message) => {
    if (message.type === "comments-refresh") {
      setRefreshTrigger((prev) => prev + 1);
    }
  });

  const operateStatus = async (
    ids: (string | number)[],
    status: CommentStatus,
  ) => {
    if (!ids.length) return;
    try {
      const res = await runWithAuth(updateCommentStatus, {
        ids: ids.map(String),
        status,
      } as never);
      const parsed = await resolveApiResponse(res);
      if (parsed?.success) {
        toastSuccess("操作成功");
        fetchData();
      } else {
        toastError("操作失败", parsed?.message || "");
      }
    } catch (error) {
      console.error("更新评论状态失败", error);
      toastError("更新评论状态失败", "请稍后重试");
    }
  };

  const handleDelete = async (ids: (string | number)[]) => {
    if (!ids.length) return;
    try {
      const res = await runWithAuth(deleteComments, {
        ids: ids.map(String),
      } as never);
      const parsed = await resolveApiResponse(res);
      if (parsed?.success) {
        toastSuccess("删除成功");
        fetchData();
      } else {
        toastError("删除失败", parsed?.message || "");
      }
    } catch (error) {
      console.error("删除评论失败", error);
      toastError("删除评论失败", "请稍后重试");
    }
  };

  const columns: TableColumn<AdminCommentRow>[] = [
    {
      key: "author",
      title: "作者",
      width: "10em",
      render: (_, record) => (
        <div className="flex flex-col text-sm">
          <span className="font-semibold">
            {record.author.nickname ||
              record.author.username ||
              record.author.displayName}
          </span>
          {record.author.uid ? (
            <Link
              href={`/admin/users?uid=${record.author.uid}`}
              presets={["hover-underline"]}
              className="text-muted-foreground text-xs"
            >
              UID: {record.author.uid}
            </Link>
          ) : record.email ? (
            <span className="text-muted-foreground text-xs truncate max-w-[15em]">
              {record.email}
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">
              IP: {record.ipAddress}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "content",
      title: "内容",
      width: "32em",
      render: (_, record) => (
        <div className="line-clamp-2">
          {record.replyTo && (
            <span className="text-muted-foreground mr-1">
              回复 @{record.replyTo.authorName}:
            </span>
          )}
          <span>{record.content}</span>
        </div>
      ),
    },
    {
      key: "status",
      title: "状态",
      sortable: true,
      render: (_, record) => {
        let statusColor = "";
        let statusIcon = null;

        switch (record.status) {
          case "REJECTED":
            statusColor = "text-error";
            statusIcon = <RiCloseLine size="1em" />;
            break;
          case "PENDING":
            statusColor = "text-warning";
            statusIcon = <RiInformationLine size="1em" />;
            break;
          case "APPROVED":
            statusColor = "text-success";
            statusIcon = <RiCheckLine size="1em" />;
            break;
          case "SPAM":
            statusColor = "text-muted-foreground";
            statusIcon = <RiSpamLine size="1em" />;
            break;
        }
        return (
          <span className={`${statusColor} flex items-center gap-1`}>
            {statusIcon}
            {statusLabels[record.status]}
          </span>
        );
      },
    },
    {
      key: "replyCount",
      title: "回复",
      align: "center",
      render: (_, record) => (
        <span
          className={`text-xs ${record.replyCount > 0 ? "text-foreground" : "text-muted-foreground"}`}
        >
          {record.replyCount}
        </span>
      ),
    },
    {
      key: "postSlug",
      title: "内容",
      width: "16em",
      sortable: true,
      render: (_, record) => (
        <div>
          <Link
            href={resolveCommentTargetHref(record.postSlug)}
            target="_blank"
            presets={["hover-color"]}
            title={record.postTitle || record.postSlug}
            className="line-clamp-1"
          >
            {record.postTitle || record.postSlug}
          </Link>
        </div>
      ),
    },
    {
      key: "ipAddress",
      title: "IP / 归属地",
      align: "center",
      render: (_, record) => (
        <div className="flex flex-col items-center text-xs">
          <span className="text-muted-foreground font-mono">
            {record.ipAddress || "-"}
          </span>
          {record.location && (
            <span className="text-muted-foreground/80 truncate max-w-[120px]">
              {record.location}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "createdAt",
      title: "时间",
      sortable: true,
      mono: true,
      render: (_, record) => (
        <span className="text-muted-foreground">
          {new Date(record.createdAt).toLocaleString("zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      ),
    },
  ];

  const filterConfig: FilterConfig[] = [
    {
      key: "status",
      label: "状态",
      type: "checkboxGroup",
      options: [
        { label: "待审核", value: "PENDING" },
        { label: "已通过", value: "APPROVED" },
        { label: "已拒绝", value: "REJECTED" },
        { label: "垃圾", value: "SPAM" },
      ],
    },
    {
      key: "slug",
      label: "内容 Slug",
      type: "input",
      placeholder: "按内容路径筛选",
    },
    {
      key: "uid",
      label: "用户 UID",
      type: "input",
      inputType: "number",
      placeholder: "按用户筛选",
    },
    {
      key: "parentOnly",
      label: "评论层级",
      type: "checkboxGroup",
      options: [{ label: "仅顶级评论", value: "true" }],
    },
  ];

  const selectedIds = selectedKeys.map(String);

  const batchActions: ActionButton[] = [
    {
      label: "通过",
      icon: <RiCheckLine size="1.1em" />,
      onClick: () => {
        void operateStatus(selectedIds, "APPROVED");
      },
      disabled: !selectedKeys.length,
      variant: "ghost",
    },
    {
      label: "拒绝",
      icon: <RiCloseLine size="1.1em" />,
      onClick: () => {
        void operateStatus(selectedIds, "REJECTED");
      },
      disabled: !selectedKeys.length,
      variant: "ghost",
    },
    {
      label: "标记垃圾",
      icon: <RiAlertLine size="1.1em" />,
      onClick: () => {
        void operateStatus(selectedIds, "SPAM");
      },
      disabled: !selectedKeys.length,
      variant: "ghost",
    },
    {
      label: "删除",
      icon: <RiDeleteBinLine size="1.1em" />,
      onClick: () => {
        void handleDelete(selectedIds);
      },
      disabled: !selectedKeys.length,
      variant: "danger",
    },
  ];

  const rowActions = (record: AdminCommentRow): ActionButton[] => [
    {
      label: "通过",
      icon: <RiCheckLine size="1.1em" />,
      onClick: () => {
        void operateStatus([record.id], "APPROVED");
      },
    },
    {
      label: "拒绝",
      icon: <RiCloseLine size="1.1em" />,
      onClick: () => {
        void operateStatus([record.id], "REJECTED");
      },
    },
    {
      label: "垃圾",
      icon: <RiAlertLine size="1.1em" />,
      onClick: () => {
        void operateStatus([record.id], "SPAM");
      },
    },
    {
      label: "删除",
      icon: <RiDeleteBinLine size="1.1em" />,
      variant: "danger",
      onClick: () => {
        void handleDelete([record.id]);
      },
    },
  ];

  const openDetailDialog = (record: AdminCommentItem) => {
    setSelectedComment(record);
    setDetailDialogOpen(true);
  };

  const closeDetailDialog = () => {
    setDetailDialogOpen(false);
    setSelectedComment(null);
  };

  return (
    <>
      <GridTable
        title="评论列表"
        columns={columns}
        data={data}
        loading={loading}
        rowKey="id"
        page={page}
        totalPages={totalPages}
        totalRecords={totalRecords}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        onSortChange={(key, order) => {
          setSortKey(order ? (key as SortKey) : "createdAt");
          setSortOrder(order || "desc");
          setPage(1);
        }}
        onSearchChange={(value) => {
          setPage(1);
          setSearchQuery(value);
        }}
        searchPlaceholder="搜索内容/作者/邮箱"
        filterConfig={filterConfig}
        onFilterChange={(values) => {
          setPage(1);
          setFilterValues(values);
        }}
        striped
        hoverable
        bordered={false}
        size="sm"
        stickyHeader
        maxHeight="100%"
        padding={2.5}
        enableActions
        batchActions={batchActions}
        rowActions={rowActions}
        onSelectionChange={(keys) => setSelectedKeys(keys)}
        onRowClick={(record) => openDetailDialog(record)}
        emptyText="暂无评论记录"
      />

      <Dialog
        open={detailDialogOpen}
        onClose={closeDetailDialog}
        title={`评论详情 - ID: ${selectedComment?.id || ""}`}
        size="lg"
      >
        {selectedComment && (
          <div className="px-6 py-6 space-y-6">
            {/* 评论内容 */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                评论内容
              </h3>
              {selectedComment.replyTo && (
                <div className="space-y-3">
                  <div className="text-sm font-medium text-foreground">
                    回复{" "}
                    <span className="text-primary">
                      @{selectedComment.replyTo.authorName}
                    </span>
                  </div>
                  <div className="bg-muted/30 p-4 text-sm border-l-4 border-primary">
                    <p className="whitespace-pre-wrap break-words leading-relaxed">
                      {selectedComment.replyTo.content}
                    </p>
                  </div>
                </div>
              )}
              <p className="text-base whitespace-pre-wrap break-words leading-relaxed">
                {selectedComment.content}
              </p>
            </div>

            {/* 基本信息 */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                基本信息
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">状态</label>
                  <p
                    className={
                      selectedComment.status === "APPROVED"
                        ? "text-green-600"
                        : selectedComment.status === "PENDING"
                          ? "text-orange-500"
                          : selectedComment.status === "SPAM"
                            ? "text-gray-500"
                            : "text-red-500"
                    }
                  >
                    {statusLabels[selectedComment.status]}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">层级</label>
                  <p className="text-sm">
                    {(selectedComment.depth ?? 0) === 0
                      ? "顶级评论"
                      : `L${selectedComment.depth}`}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    回复数
                  </label>
                  <p className="text-sm">{selectedComment.replyCount}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">时间</label>
                  <p className="text-sm font-mono">
                    {new Date(selectedComment.createdAt).toLocaleString(
                      "zh-CN",
                    )}
                  </p>
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm text-muted-foreground">内容</label>
                  <p className="text-sm">
                    <Link
                      href={resolveCommentTargetHref(selectedComment.postSlug)}
                      target="_blank"
                      presets={["hover-underline"]}
                      className="text-primary"
                    >
                      {selectedComment.postTitle || selectedComment.postSlug}
                    </Link>
                  </p>
                </div>
                {selectedComment.path && (
                  <div className="md:col-span-2">
                    <label className="text-sm text-muted-foreground">
                      物化路径
                    </label>
                    <p className="text-sm font-mono break-all">
                      {selectedComment.path
                        .split("/")
                        .map((segment, index, arr) => (
                          <span key={segment}>
                            {segment}
                            {index < arr.length - 1 && (
                              <span className="text-muted-foreground">
                                <br />
                                {"> ".repeat(2 * (index + 1))}
                              </span>
                            )}
                          </span>
                        ))}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* 作者信息 */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                作者信息
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">昵称</label>
                  <p className="text-sm">
                    {selectedComment.author.displayName}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">UID</label>
                  <p className="text-sm">
                    {selectedComment.author.uid ? (
                      <Link
                        href={`/admin/users?uid=${selectedComment.author.uid}`}
                        presets={["hover-underline"]}
                        className="text-primary"
                      >
                        {selectedComment.author.uid}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">匿名</span>
                    )}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">邮箱</label>
                  <p className="text-sm">
                    {selectedComment.email || (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">网站</label>
                  <p className="text-sm">
                    {selectedComment.author.website ? (
                      <Link
                        href={selectedComment.author.website}
                        target="_blank"
                        presets={["hover-underline"]}
                        className="text-primary break-all"
                      >
                        {selectedComment.author.website}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">IP</label>
                  <p className="text-sm font-mono">
                    {selectedComment.ipAddress || "-"}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">位置</label>
                  <p className="text-sm">
                    {selectedComment.location || (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </p>
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm text-muted-foreground">UA</label>
                  <p className="text-sm font-mono break-all">
                    {selectedComment.userAgent || "-"}
                  </p>
                </div>
              </div>
            </div>

            {/* ID 信息 */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                ID 信息
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">
                    评论 ID
                  </label>
                  <p className="text-sm font-mono">{selectedComment.id}</p>
                </div>
                {selectedComment.parentId && (
                  <div>
                    <label className="text-sm text-muted-foreground">
                      父评论 ID
                    </label>
                    <p className="text-sm font-mono">
                      {selectedComment.parentId}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
