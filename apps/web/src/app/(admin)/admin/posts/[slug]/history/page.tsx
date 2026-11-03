"use client";

import { useEffect, useState } from "react";
import {
  RiArchiveLine,
  RiArrowLeftSLine,
  RiCodeSSlashLine,
  RiEyeLine,
  RiGitBranchLine,
  RiGitCommitLine,
  RiRefreshLine,
} from "@remixicon/react";
import type {
  PostHistoryItem,
  PostHistoryStats,
} from "@repo/shared-types/api/post";
import { useParams } from "next/navigation";

import { resetPostToVersion, squashPostToVersion } from "@/actions/post";
import AreaChart, {
  type AreaChartDataPoint,
  type SeriesConfig,
} from "@/components/client/charts/AreaChart";
import AdminSidebar from "@/components/client/layout/AdminSidebar";
import HorizontalScroll from "@/components/client/layout/HorizontalScroll";
import MainLayout from "@/components/client/layout/MainLayout";
import RowGrid, { GridItem } from "@/components/client/layout/RowGrid";
import type { ActionButton } from "@/components/ui/GridTable";
import GridTable from "@/components/ui/GridTable";
import Link, { useNavigateWithTransition } from "@/components/ui/Link";
import { getPostHistory } from "@/lib/client/api/post-read";
import { AlertDialog } from "@/ui/AlertDialog";
import { AutoTransition } from "@/ui/AutoTransition";
import Clickable from "@/ui/Clickable";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import type { TableColumn } from "@/ui/Table";
import { useToast } from "@/ui/Toast";

export default function PostHistoryPage() {
  const params = useParams();
  const slug = params?.slug as string;
  const toast = useToast();
  const navigate = useNavigateWithTransition();

  const [data, setData] = useState<PostHistoryItem[]>([]);
  const [stats, setStats] = useState<PostHistoryStats | null>(null);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortKey, setSortKey] = useState<string | null>("timestamp");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | null>("desc");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [selectedVersions, setSelectedVersions] = useState<(string | number)[]>(
    [],
  );
  const [userRole, setUserRole] = useState<string | null>(null);

  // Reset 对话框状态
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetTargetVersion, setResetTargetVersion] =
    useState<PostHistoryItem | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  // Squash 对话框状态
  const [squashDialogOpen, setSquashDialogOpen] = useState(false);
  const [squashTargetVersion, setSquashTargetVersion] =
    useState<PostHistoryItem | null>(null);
  const [isSquashing, setIsSquashing] = useState(false);

  // 从 localStorage 读取用户角色
  useEffect(() => {
    try {
      const userInfo = localStorage.getItem("user_info");
      if (userInfo) {
        const parsed = JSON.parse(userInfo);
        setUserRole(parsed.role);
      }
    } catch (error) {
      console.error("Failed to parse user_info from localStorage:", error);
    }
  }, []);

  // 处理选中状态变化
  const handleSelectionChange = (selectedKeys: (string | number)[]) => {
    setSelectedVersions(selectedKeys);
  };

  // 处理排序变化
  const handleSortChange = (key: string, order: "asc" | "desc" | null) => {
    setSortKey(order ? key : null);
    setSortOrder(order);
    setPage(1);
  };

  // 打开 Reset 对话框
  const openResetDialog = (version: PostHistoryItem) => {
    setResetTargetVersion(version);
    setResetDialogOpen(true);
  };

  // 关闭 Reset 对话框
  const closeResetDialog = () => {
    setResetDialogOpen(false);
    setResetTargetVersion(null);
  };

  // 确认 Reset
  const handleConfirmReset = async () => {
    if (!resetTargetVersion) return;

    setIsResetting(true);
    try {
      const result = await resetPostToVersion({
        slug,
        timestamp: resetTargetVersion.timestamp,
      });

      if (result.success) {
        toast.success(
          `已重置到版本「${resetTargetVersion.commitMessage}」，删除了 ${result.data?.deletedVersionsCount || 0} 个后续版本`,
        );
        closeResetDialog();
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error(result.message || "重置失败");
      }
    } catch (error) {
      console.error("Reset version error:", error);
      toast.error("重置失败，请稍后重试");
    } finally {
      setIsResetting(false);
    }
  };

  // 打开 Squash 对话框
  const openSquashDialog = (version: PostHistoryItem) => {
    setSquashTargetVersion(version);
    setSquashDialogOpen(true);
  };

  // 关闭 Squash 对话框
  const closeSquashDialog = () => {
    setSquashDialogOpen(false);
    setSquashTargetVersion(null);
  };

  // 确认 Squash
  const handleConfirmSquash = async () => {
    if (!squashTargetVersion) return;

    setIsSquashing(true);
    try {
      const result = await squashPostToVersion({
        slug,
        timestamp: squashTargetVersion.timestamp,
      });

      if (result.success) {
        toast.success(
          `已压缩到版本「${squashTargetVersion.commitMessage}」，删除了 ${result.data?.compressedVersionsCount || 0} 个之前的版本`,
        );
        closeSquashDialog();
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error(result.message || "压缩失败");
      }
    } catch (error) {
      console.error("Squash version error:", error);
      toast.error("压缩失败，请稍后重试");
    } finally {
      setIsSquashing(false);
    }
  };

  // 批量操作：对比两个版本
  const handleCompareVersions = () => {
    if (selectedVersions.length !== 2) {
      toast.warning("请选择两个版本进行对比");
      return;
    }

    const [from, to] = selectedVersions.map((ts) =>
      encodeURIComponent(String(ts)),
    );
    navigate(`/admin/posts/${slug}/history/compare?from=${from}&to=${to}`);
  };

  // 批量操作按钮
  const batchActions: ActionButton[] = [
    {
      label: "对比版本",
      onClick: handleCompareVersions,
      icon: <RiGitBranchLine size="1em" />,
      variant: "primary",
      disabled: selectedVersions.length !== 2,
    },
  ];

  // 行操作按钮
  const rowActions = (record: PostHistoryItem): ActionButton[] => {
    const actions: ActionButton[] = [
      {
        label: "预览此版本",
        onClick: () =>
          navigate(
            `/admin/posts/${slug}/preview/${encodeURIComponent(record.timestamp)}`,
          ),
        icon: <RiEyeLine size="1em" />,
        variant: "ghost",
      },
      {
        label: "查看源代码",
        onClick: () =>
          navigate(
            `/admin/posts/${slug}/source/${encodeURIComponent(record.timestamp)}`,
          ),
        icon: <RiCodeSSlashLine size="1em" />,
        variant: "ghost",
      },
      {
        label: "与上一版本对比",
        onClick: () => {
          const currentIndex = data.findIndex(
            (item) => item.timestamp === record.timestamp,
          );
          if (currentIndex < data.length - 1) {
            const previousVersion = data[currentIndex + 1];
            if (previousVersion) {
              navigate(
                `/admin/posts/${slug}/history/compare?from=${encodeURIComponent(previousVersion.timestamp)}&to=${encodeURIComponent(record.timestamp)}`,
              );
            }
          } else {
            toast.info("这是第一个版本,没有更早的版本可对比");
          }
        },
        icon: <RiGitCommitLine size="1em" />,
        variant: "ghost",
      },
    ];

    // 只有管理员才能 Reset 和 Squash
    if (userRole === "ADMIN") {
      actions.push({
        label: "重置到此版本",
        onClick: () => openResetDialog(record),
        icon: <RiRefreshLine size="1em" />,
        variant: "ghost",
      });

      actions.push({
        label: "压缩到此版本",
        onClick: () => openSquashDialog(record),
        icon: <RiArchiveLine size="1em" />,
        variant: "danger",
      });
    }

    return actions;
  };

  // 获取数据
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const result = await getPostHistory({
          slug,
          page,
          pageSize,
          sortBy: "timestamp",
          sortOrder: sortOrder || "desc",
        });

        if (result.success && result.data) {
          setStats(result.data.stats);
          setData(result.data.versions);
          setTotalRecords(result.meta?.total || 0);
          if (result.meta) {
            setTotalPages(result.meta.totalPages);
          }
        }
      } catch (error) {
        console.error("Failed to fetch post history:", error);
      } finally {
        setLoading(false);
      }
    }

    if (slug) {
      fetchData();
    }
  }, [slug, page, pageSize, sortKey, sortOrder, refreshTrigger]);

  const columns: TableColumn<PostHistoryItem>[] = [
    {
      key: "timestamp",
      title: "提交时间",
      dataIndex: "timestamp",
      align: "left",
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
            second: "2-digit",
          });
        }
        return "-";
      },
    },
    {
      key: "commitMessage",
      title: "提交信息",
      dataIndex: "commitMessage",
      align: "left",
      render: (value: unknown) => {
        return (
          <span className="truncate max-w-xs block" title={String(value)}>
            {String(value)}
          </span>
        );
      },
    },
    {
      key: "author",
      title: "提交人",
      dataIndex: "username",
      align: "left",
      render: (value: unknown, record: PostHistoryItem) => {
        return (
          <Link
            href={`/admin/users?uid=${record.userUid}`}
            presets={["hover-underline"]}
            title={`@${record.username}`}
          >
            {record.nickname || `@${record.username}`}
          </Link>
        );
      },
    },
    {
      key: "isSnapshot",
      title: "快照",
      dataIndex: "isSnapshot",
      align: "center",
      render: (value: unknown) => {
        return value === true ? (
          <span className="text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap bg-primary/20 text-primary">
            快照
          </span>
        ) : (
          <span className="text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap bg-muted/20 text-muted-foreground">
            差异
          </span>
        );
      },
    },
  ];

  // 生成图表数据：显示每次编辑的时间戳（精确到秒）
  const generateChartData = (): AreaChartDataPoint[] => {
    if (!stats || stats.editTimestamps.length === 0) return [];

    // 先排序时间戳（从早到晚）
    const sortedTimestamps = [...stats.editTimestamps]
      .filter((timestamp) => timestamp) // 过滤掉 undefined 或空值
      .sort((a, b) => {
        if (!a || !b) return 0;
        return new Date(a).getTime() - new Date(b).getTime();
      });

    // 将每个编辑时间戳转换为图表数据点
    return sortedTimestamps.map((timestamp, index) => {
      const date = new Date(timestamp!);
      return {
        time: date.toISOString(), // 使用完整的 ISO 时间戳
        edits: index + 1, // 累计编辑次数
      };
    });
  };

  const chartData = generateChartData();
  const chartSeries: SeriesConfig[] = [
    {
      key: "edits",
      label: "累计编辑次数",
      color: "var(--color-primary)",
    },
  ];

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
        <RowGrid>
          <GridItem
            areas={[1, 2, 3, 4, 5, 6, 7, 8]}
            width={12 / 8}
            height={0.5}
          >
            <AutoTransition type="scale" className="h-full">
              {stats ? (
                <div
                  className="flex flex-col justify-between p-10 h-full"
                  key="stats-content"
                >
                  <div>
                    <div className="flex justify-between gap-x-4 py-2">
                      <div>
                        <h1 className="text-2xl text-foreground">
                          文章历史版本
                        </h1>
                      </div>
                      <Clickable onClick={() => navigate("/admin/posts")}>
                        <RiArrowLeftSLine size="2em" />
                      </Clickable>
                    </div>
                    <div className="space-y-2 mt-4">
                      <div className="flex items-center gap-2">
                        <span>
                          总编辑次数：
                          <span className="font-bold">{stats.totalEdits}</span>
                        </span>
                      </div>
                      <div className="flex items-start gap-2">
                        <div>
                          <div>
                            参与编辑人员：
                            {stats.editors.map((editor, index) => (
                              <span key={editor.userUid}>
                                <Link
                                  href={`/admin/users?uid=${editor.userUid}`}
                                  presets={["hover-underline"]}
                                >
                                  {editor.nickname || `@${editor.username}`}
                                </Link>
                                {index < stats.editors.length - 1 && "、"}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <div>
                          <div>
                            编辑时间范围：
                            {stats.editTimestamps.length > 0 &&
                              stats.editTimestamps[0] &&
                              stats.editTimestamps[
                                stats.editTimestamps.length - 1
                              ] && (
                                <>
                                  {new Date(
                                    stats.editTimestamps[0]!,
                                  ).toLocaleString("zh-CN", {
                                    year: "numeric",
                                    month: "2-digit",
                                    day: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    second: "2-digit",
                                  })}{" "}
                                  -{" "}
                                  {new Date(
                                    stats.editTimestamps[
                                      stats.editTimestamps.length - 1
                                    ]!,
                                  ).toLocaleString("zh-CN", {
                                    year: "numeric",
                                    month: "2-digit",
                                    day: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    second: "2-digit",
                                  })}
                                </>
                              )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-mono">
                      Slug：<span className="font-mono">{slug}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  className="flex flex-col justify-between p-10 h-full"
                  key="stats-loading"
                >
                  <LoadingIndicator />
                </div>
              )}
            </AutoTransition>
          </GridItem>
          <GridItem
            areas={[9, 10, 11, 12]}
            width={3}
            height={0.5}
            className="py-10"
            fixedHeight
          >
            <AutoTransition type="slideUp" className="h-full">
              {chartData.length > 0 ? (
                <>
                  <div className="text-2xl mb-2 px-10">编辑趋势</div>
                  <div className="w-full h-full" key="chart-content">
                    <AreaChart
                      data={chartData}
                      series={chartSeries}
                      className="w-full h-full"
                      timeGranularity="minute"
                      showYear="auto"
                    />
                  </div>
                </>
              ) : (
                <div className="px-10 h-full flex items-center justify-center text-muted-foreground">
                  暂无编辑趋势数据
                </div>
              )}
            </AutoTransition>
          </GridItem>
        </RowGrid>
        <RowGrid>
          <GridTable
            title="版本列表"
            columns={columns}
            data={data}
            loading={loading}
            rowKey="timestamp"
            page={page}
            totalPages={totalPages}
            totalRecords={totalRecords}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            onSortChange={handleSortChange}
            striped
            hoverable
            bordered={false}
            size="sm"
            emptyText="暂无历史版本"
            stickyHeader
            maxHeight="100%"
            padding={2.5}
            enableActions={true}
            batchActions={batchActions}
            rowActions={rowActions}
            onSelectionChange={handleSelectionChange}
          />

          {/* Reset 确认对话框 */}
          <AlertDialog
            open={resetDialogOpen}
            onClose={closeResetDialog}
            onConfirm={handleConfirmReset}
            title="确认重置版本"
            description={
              resetTargetVersion
                ? `确定要将文章重置到版本「${resetTargetVersion.commitMessage}」吗？此操作将删除该版本之后的所有历史记录，且不可恢复。`
                : ""
            }
            confirmText="重置"
            cancelText="取消"
            variant="danger"
            loading={isResetting}
          />

          {/* Squash 确认对话框 */}
          <AlertDialog
            open={squashDialogOpen}
            onClose={closeSquashDialog}
            onConfirm={handleConfirmSquash}
            title="确认压缩版本"
            description={
              squashTargetVersion
                ? `确定要将文章压缩到版本「${squashTargetVersion.commitMessage}」吗？此操作将删除该版本之前的所有历史记录，且不可恢复。`
                : ""
            }
            confirmText="压缩"
            cancelText="取消"
            variant="danger"
            loading={isSquashing}
          />
        </RowGrid>
      </HorizontalScroll>
    </MainLayout>
  );
}
