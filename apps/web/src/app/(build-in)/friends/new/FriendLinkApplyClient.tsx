"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RiDeleteBinLine, RiFileCopyLine } from "@remixicon/react";
import type {
  FriendLinkCheckHistoryItem,
  FriendLinkIssueType,
  FriendLinkListItem,
  FriendLinkStatus,
} from "@repo/shared-types/api/friendlink";

import {
  deleteOwnFriendLink,
  getOwnFriendLink,
  submitFriendLinkApplication,
  updateOwnFriendLink,
} from "@/actions/friendlink";
import type {
  FriendLinkApplySiteProfile,
  FriendLinkApplyUser,
} from "@/app/(build-in)/friends/new/apply-context";
import AreaChart, {
  type AreaChartDataPoint,
  type SeriesConfig,
} from "@/components/client/charts/AreaChart";
import { CaptchaButton } from "@/components/ui/CaptchaButton";
import { useNavigateWithTransition } from "@/components/ui/Link";
import { useBroadcast, useBroadcastSender } from "@/hooks/use-broadcast";
import { formatDateTimeLocale } from "@/lib/shared/date-format";
import { AlertDialog } from "@/ui/AlertDialog";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import Clickable from "@/ui/Clickable";
import { Input } from "@/ui/Input";
import { Table, type TableColumn } from "@/ui/Table";
import { useToast } from "@/ui/Toast";

interface FriendLinkApplyClientProps {
  currentUser: FriendLinkApplyUser | null;
  applyEnabled: boolean;
  checkBackLinkEnabled: boolean;
  siteProfile: FriendLinkApplySiteProfile;
  isModal: boolean;
  onRequestClose?: (targetPath?: string) => void;
}

type FriendLinkApplyForm = {
  name: string;
  url: string;
  avatar: string;
  slogan: string;
  friendLinkUrl: string;
  applyNote: string;
};

type CheckHistoryTableRow = {
  key: string;
  order: number;
  time: string;
  checkType: FriendLinkCheckHistoryItem["checkType"];
  ok: boolean;
  responseTime: number | null;
  statusCode: number | null | undefined;
  issueType: FriendLinkIssueType;
  hasBacklink?: boolean;
  targetUrl: string;
  note?: string;
};

const INITIAL_FORM: FriendLinkApplyForm = {
  name: "",
  url: "",
  avatar: "",
  slogan: "",
  friendLinkUrl: "",
  applyNote: "",
};

const statusText: Record<FriendLinkStatus, string> = {
  PENDING: "待审核",
  PUBLISHED: "已发布",
  WHITELIST: "白名单",
  REJECTED: "已拒绝",
  DISCONNECT: "无法访问",
  NO_BACKLINK: "无回链",
  BLOCKED: "已拉黑",
};

const statusClassName: Record<FriendLinkStatus, string> = {
  PENDING: "text-warning",
  PUBLISHED: "text-success",
  WHITELIST: "text-primary",
  REJECTED: "text-muted-foreground",
  DISCONNECT: "text-error",
  NO_BACKLINK: "text-error",
  BLOCKED: "text-error",
};

const issueText: Record<FriendLinkIssueType, string> = {
  NONE: "正常",
  DISCONNECT: "无法访问",
  NO_BACKLINK: "无回链",
};

const issueClassName: Record<FriendLinkIssueType, string> = {
  NONE: "text-success",
  DISCONNECT: "text-error",
  NO_BACKLINK: "text-error",
};

const responseTimeSeries: SeriesConfig[] = [
  {
    key: "responseTime",
    label: "响应时间",
    color: "var(--color-primary)",
  },
];

function buildFormFromRecord(
  record: FriendLinkListItem | null,
): FriendLinkApplyForm {
  if (!record) return { ...INITIAL_FORM };
  return {
    name: record.name,
    url: record.url,
    avatar: record.avatar || "",
    slogan: record.slogan || "",
    friendLinkUrl: record.friendLinkUrl || "",
    applyNote: record.applyNote || "",
  };
}

export default function FriendLinkApplyClient({
  currentUser,
  applyEnabled,
  checkBackLinkEnabled,
  siteProfile,
  isModal,
  onRequestClose,
}: FriendLinkApplyClientProps) {
  const toast = useToast();
  const navigate = useNavigateWithTransition();
  const { broadcast } = useBroadcastSender<{ type: string }>();
  const isLoggedIn = Boolean(currentUser);

  const [form, setForm] = useState<FriendLinkApplyForm>(INITIAL_FORM);
  const [captchaToken, setCaptchaToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [loadingOwnLink, setLoadingOwnLink] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [ownFriendLink, setOwnFriendLink] = useState<FriendLinkListItem | null>(
    null,
  );

  const canUpdateOwn =
    ownFriendLink != null &&
    ["PUBLISHED", "WHITELIST"].includes(ownFriendLink.status);
  const canDeleteOwn =
    ownFriendLink != null && ownFriendLink.status !== "BLOCKED";

  useBroadcast((message: { type: string; token?: string }) => {
    if (message?.type === "captcha-solved" && message.token) {
      setCaptchaToken(message.token);
    }
  });

  useBroadcast((message: { type: string }) => {
    if (message?.type === "captcha-error") {
      toast.error("安全验证失败，请刷新重试");
    }
  });

  const loadOwnFriendLink = useCallback(async () => {
    if (!isLoggedIn) {
      setOwnFriendLink(null);
      setForm({ ...INITIAL_FORM });
      setLoadingOwnLink(false);
      return;
    }

    setLoadingOwnLink(true);
    try {
      const result = await getOwnFriendLink({});
      if (!result.success) {
        toast.error(result.message || "获取你的友链信息失败");
        return;
      }

      const record = result.data || null;
      setOwnFriendLink(record);
      setForm(buildFormFromRecord(record));
    } catch (error) {
      console.error("[FriendLinkApply] 获取我的友链失败:", error);
      toast.error("获取你的友链信息失败");
    } finally {
      setLoadingOwnLink(false);
    }
  }, [isLoggedIn, toast]);

  useEffect(() => {
    void loadOwnFriendLink();
  }, [loadOwnFriendLink]);

  const validateAndBuildPayload = () => {
    const payload = {
      name: form.name.trim(),
      url: form.url.trim(),
      avatar: form.avatar.trim(),
      slogan: form.slogan.trim(),
      friendLinkUrl: form.friendLinkUrl.trim(),
      applyNote: form.applyNote.trim(),
    };

    if (
      !payload.name ||
      !payload.url ||
      !payload.avatar ||
      !payload.slogan ||
      !payload.friendLinkUrl
    ) {
      toast.error("请完整填写必填项");
      return null;
    }

    return payload;
  };

  const handleSubmitApply = async () => {
    if (submitting) return;
    if (!isLoggedIn) {
      toast.error("请先登录后再申请友链");
      return;
    }
    if (ownFriendLink) {
      toast.error("你已存在友链记录，请使用下方的修改或删除功能");
      return;
    }
    if (!applyEnabled) {
      toast.error("当前站点未开放友链申请");
      return;
    }

    const payload = validateAndBuildPayload();
    if (!payload) return;

    if (!captchaToken) {
      toast.error("请先完成安全验证");
      return;
    }

    setSubmitting(true);
    try {
      const result = await submitFriendLinkApplication({
        name: payload.name,
        url: payload.url,
        avatar: payload.avatar,
        slogan: payload.slogan,
        friendLinkUrl: payload.friendLinkUrl,
        applyNote: payload.applyNote || undefined,
        captcha_token: captchaToken,
      });

      if (!result.success) {
        toast.error(result.message || "提交申请失败");
        setCaptchaToken("");
        await broadcast({ type: "captcha-reset" });
        return;
      }

      toast.success(result.message || "友链申请已提交");
      setCaptchaToken("");
      await broadcast({ type: "captcha-reset" });
      await loadOwnFriendLink();
    } catch (error) {
      console.error("[FriendLinkApply] 提交失败:", error);
      toast.error("提交申请失败，请稍后重试");
      setCaptchaToken("");
      await broadcast({ type: "captcha-reset" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async () => {
    if (updating) return;
    if (!isLoggedIn) {
      toast.error("请先登录");
      return;
    }
    if (!ownFriendLink) {
      toast.error("未找到你的友链记录");
      return;
    }
    if (!canUpdateOwn) {
      toast.error("当前状态不可直接修改，请先删除后重新申请");
      return;
    }

    const payload = validateAndBuildPayload();
    if (!payload) return;

    setUpdating(true);
    try {
      const result = await updateOwnFriendLink({
        name: payload.name,
        url: payload.url,
        avatar: payload.avatar,
        slogan: payload.slogan,
        friendLinkUrl: payload.friendLinkUrl,
        applyNote: payload.applyNote || undefined,
      });

      if (!result.success) {
        toast.error(result.message || "更新失败");
        return;
      }

      toast.success(result.message || "友链信息已更新");
      await loadOwnFriendLink();
    } catch (error) {
      console.error("[FriendLinkApply] 更新失败:", error);
      toast.error("更新失败，请稍后重试");
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (deleting) return;

    setDeleting(true);
    try {
      const result = await deleteOwnFriendLink({});
      if (!result.success) {
        toast.error(result.message || "删除失败");
        return;
      }

      toast.success(result.message || "友链记录已删除");
      setOwnFriendLink(null);
      setForm({ ...INITIAL_FORM });
      setDeleteDialogOpen(false);
      setCaptchaToken("");
      await broadcast({ type: "captcha-reset" });
    } catch (error) {
      console.error("[FriendLinkApply] 删除失败:", error);
      toast.error("删除失败，请稍后重试");
    } finally {
      setDeleting(false);
    }
  };

  const handleGotoLogin = () => {
    const target = "/login?redirect=/friends/new";
    if (onRequestClose) {
      onRequestClose(target);
      return;
    }
    navigate(target);
  };

  const resolveAvatarUrl = (website: string, avatar: string): string => {
    const avatarText = avatar.trim();
    if (!avatarText) return "-";

    if (/^https?:\/\//i.test(avatarText)) {
      return avatarText;
    }

    const websiteText = website.trim();
    if (!websiteText) return avatarText;

    const baseCandidates = /^https?:\/\//i.test(websiteText)
      ? [websiteText]
      : [`https://${websiteText}`, `http://${websiteText}`];

    for (const candidate of baseCandidates) {
      try {
        return new URL(avatarText, candidate).toString();
      } catch {
        // ignore
      }
    }

    return avatarText;
  };

  const copyText = async (text: string, successText: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(successText);
    } catch (error) {
      console.error("[FriendLinkApply] 复制失败:", error);
      toast.error("复制失败，请手动复制");
    }
  };

  const resolvedAvatarUrl = resolveAvatarUrl(
    siteProfile.website || "",
    siteProfile.avatar || "",
  );

  const siteInfoItems = [
    {
      label: "名称",
      value: siteProfile.name || "-",
      copySuccess: "名称已复制",
    },
    {
      label: "网站地址",
      value: siteProfile.website || "-",
      copySuccess: "网站地址已复制",
    },
    {
      label: "头像 URL",
      value: resolvedAvatarUrl || "-",
      copySuccess: "头像地址已复制",
    },
    {
      label: "简介",
      value: siteProfile.description || "-",
      copySuccess: "简介已复制",
    },
  ] as const;

  const selectedHistory = useMemo<FriendLinkCheckHistoryItem[]>(
    () => ownFriendLink?.checkHistory || [],
    [ownFriendLink],
  );

  const responseChartData = useMemo<AreaChartDataPoint[]>(() => {
    return selectedHistory.map((event) => ({
      time: event.time,
      responseTime:
        typeof event.responseTime === "number" ? event.responseTime : 0,
    }));
  }, [selectedHistory]);

  const historyTableData = useMemo<CheckHistoryTableRow[]>(() => {
    return [...selectedHistory].reverse().map((event, index) => ({
      key: `${event.time}-${event.targetUrl}-${index}`,
      order: selectedHistory.length - index,
      time: event.time,
      checkType: event.checkType,
      ok: event.ok,
      responseTime: event.responseTime,
      statusCode: event.statusCode,
      issueType: event.issueType,
      hasBacklink: event.hasBacklink,
      targetUrl: event.targetUrl,
      note: event.note,
    }));
  }, [selectedHistory]);

  const historyColumns = useMemo<TableColumn<CheckHistoryTableRow>[]>(
    () => [
      {
        key: "order",
        title: "序号",
        dataIndex: "order",
        width: 72,
        mono: true,
      },
      {
        key: "time",
        title: "检查时间",
        dataIndex: "time",
        width: 180,
        mono: true,
        render: (value) =>
          formatDateTimeLocale(typeof value === "string" ? value : null),
      },
      {
        key: "result",
        title: "结果",
        dataIndex: "ok",
        width: 90,
        render: (value) =>
          value ? (
            <span className="text-success">通过</span>
          ) : (
            <span className="text-error">异常</span>
          ),
      },
      {
        key: "responseTime",
        title: "响应时间",
        dataIndex: "responseTime",
        width: 110,
        mono: true,
        render: (value) =>
          typeof value === "number" ? `${value}ms` : <span>-</span>,
      },
      {
        key: "statusCode",
        title: "HTTP",
        dataIndex: "statusCode",
        width: 80,
        mono: true,
        render: (value) =>
          typeof value === "number" ? (
            value
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      },
      {
        key: "issueType",
        title: "问题类型",
        dataIndex: "issueType",
        width: 120,
        render: (value) => {
          const issue = (value as FriendLinkIssueType) || "NONE";
          return (
            <span className={issueClassName[issue]}>{issueText[issue]}</span>
          );
        },
      },
      {
        key: "hasBacklink",
        title: "回链检测",
        dataIndex: "hasBacklink",
        width: 120,
        render: (value) =>
          typeof value === "boolean" ? (
            value ? (
              "存在回链"
            ) : (
              "未检测到回链"
            )
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      },
      {
        key: "note",
        title: "备注",
        dataIndex: "note",
        width: 220,
        render: (value, record) => {
          if (typeof value === "string" && value) return value;
          if (record.issueType === "NO_BACKLINK")
            return "未在友链页检测到本站域名";
          if (record.issueType === "DISCONNECT") return "访问失败或返回异常";
          return <span className="text-muted-foreground">-</span>;
        },
      },
    ],
    [],
  );

  const sectionClassName = isModal
    ? "space-y-4 py-3"
    : "space-y-4 rounded-sm border border-foreground/10 p-5 md:p-6";
  const sectionTitleClassName = isModal
    ? "border-b border-foreground/10 pb-2 text-lg font-medium text-foreground"
    : "text-lg font-medium";

  const renderProfileSection = siteProfile.showProfile ? (
    <section className={sectionClassName}>
      <h3 className={sectionTitleClassName}>本站友链信息</h3>
      <p className="text-sm text-muted-foreground">
        以下为本站友链信息，欢迎交换友链：
      </p>

      <div className="space-y-3 grid grid-cols-2 gap-x-4">
        {siteInfoItems.map((item) => (
          <div
            key={item.label}
            className="grid grid-cols-2 gap-3 md:grid-cols-[7rem_1fr_auto] md:items-start"
          >
            <div className="text-sm text-muted-foreground">{item.label}</div>
            <div className="text-sm break-all whitespace-pre-wrap flex items-center gap-2">
              {item.value}
              <span>
                <Clickable
                  onClick={() => void copyText(item.value, item.copySuccess)}
                  className="text-secondary-foreground"
                >
                  <RiFileCopyLine size="1em" />
                </Clickable>
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  ) : null;

  return (
    <>
      <div className={`${isModal ? "px-6 pb-6" : "py-6"}`}>
        <AutoTransition type="slideDown" initial={false}>
          {!isLoggedIn ? (
            <section
              className="bg-warning/10 px-4 py-3 mt-5"
              key="guest-warning"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-foreground">
                  当前未登录，无法提交或管理友链。你可以先查看填写要求，登录后再操作。
                </div>
                <Button
                  label="去登录"
                  variant="ghost"
                  size="sm"
                  onClick={handleGotoLogin}
                />
              </div>
            </section>
          ) : (
            <div key="guest-warning-empty" />
          )}
        </AutoTransition>

        <section className={sectionClassName}>
          <h3 className={sectionTitleClassName}>申请说明</h3>
          <AutoResizer>
            <AutoTransition type="fade" initial={false}>
              <div
                key={`apply-guide-${isLoggedIn ? "login" : "guest"}-${ownFriendLink?.status || "none"}-${applyEnabled ? "on" : "off"}-${checkBackLinkEnabled ? "backlink" : "url"}`}
                className="space-y-2 text-sm text-muted-foreground"
              >
                {currentUser ? (
                  <p>
                    当前登录用户：{currentUser.nickname || currentUser.username}
                  </p>
                ) : (
                  <p className="text-warning">当前未登录</p>
                )}
                {ownFriendLink ? (
                  <p>
                    当前友链状态：
                    <span
                      className={`ml-1 font-medium ${statusClassName[ownFriendLink.status]}`}
                    >
                      {statusText[ownFriendLink.status]}
                    </span>
                  </p>
                ) : (
                  <p>你当前尚未提交友链记录。</p>
                )}
                <p>提交后将进入待审核状态，由管理员审核后决定是否发布。</p>
                {checkBackLinkEnabled ? (
                  <p className="text-primary">
                    当前已开启回链检测：提交时会检查你填写的友链页是否包含本站域名。
                  </p>
                ) : (
                  <p>当前未开启提交前回链检测。</p>
                )}
                {!applyEnabled && !ownFriendLink && (
                  <p className="text-error">当前站点未开放友链申请。</p>
                )}
              </div>
            </AutoTransition>
          </AutoResizer>
        </section>

        {renderProfileSection}

        <AutoResizer>
          <AutoTransition type="scale" initial={false}>
            {isLoggedIn && loadingOwnLink ? (
              <section className={sectionClassName} key="own-link-loading">
                <p className="text-sm text-muted-foreground">
                  正在加载你的友链信息...
                </p>
              </section>
            ) : ownFriendLink ? (
              <div className="space-y-6" key={`own-link-${ownFriendLink.id}`}>
                <section className={sectionClassName}>
                  <h3 className={sectionTitleClassName}>我的友链信息</h3>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-sm text-muted-foreground">
                        记录 ID
                      </div>
                      <div className="mt-1 text-sm font-mono">
                        {ownFriendLink.id}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">状态</div>
                      <div className={`mt-1 text-sm`}>
                        {statusText[ownFriendLink.status]}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">
                        创建时间
                      </div>
                      <div className="mt-1 text-sm font-mono">
                        {formatDateTimeLocale(ownFriendLink.createdAt)}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">
                        最近更新时间
                      </div>
                      <div className="mt-1 text-sm font-mono">
                        {formatDateTimeLocale(ownFriendLink.updatedAt)}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">
                        成功检查
                      </div>
                      <div className="mt-1 text-sm font-mono">
                        {ownFriendLink.checkSuccessCount}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">
                        失败检查
                      </div>
                      <div className="mt-1 text-sm font-mono">
                        {ownFriendLink.checkFailureCount}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">
                        平均响应
                      </div>
                      <div className="mt-1 text-sm font-mono">
                        {typeof ownFriendLink.avgResponseTime === "number"
                          ? `${ownFriendLink.avgResponseTime}ms`
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">
                        最近检查
                      </div>
                      <div className="mt-1 text-sm font-mono">
                        {formatDateTimeLocale(ownFriendLink.lastCheckedAt)}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">
                        站点 URL
                      </div>
                      <div className="mt-1 text-sm break-all">
                        {ownFriendLink.url}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">
                        友链页 URL
                      </div>
                      <div className="mt-1 text-sm break-all">
                        {ownFriendLink.friendLinkUrl || "-"}
                      </div>
                    </div>
                  </div>
                </section>

                <section className={sectionClassName}>
                  <h3 className={sectionTitleClassName}>最近30次响应时间</h3>
                  <AutoResizer>
                    <AutoTransition type="fade" initial={false}>
                      {responseChartData.length > 0 ? (
                        <div className="h-80 w-full" key="response-chart">
                          <AreaChart
                            data={responseChartData}
                            series={responseTimeSeries}
                            className="h-full w-full"
                            timeGranularity="minute"
                            showYear="auto"
                            formatValue={(value) => `${value}ms`}
                          />
                        </div>
                      ) : (
                        <p
                          className="text-sm text-muted-foreground"
                          key="response-empty"
                        >
                          暂无检查记录
                        </p>
                      )}
                    </AutoTransition>
                  </AutoResizer>
                </section>

                <section className={sectionClassName}>
                  <h3 className={sectionTitleClassName}>最近30次检查记录</h3>
                  <AutoResizer>
                    <AutoTransition type="fade" initial={false}>
                      {historyTableData.length > 0 ? (
                        <div key="history-table">
                          <Table
                            columns={historyColumns}
                            data={historyTableData}
                            rowKey="key"
                            striped
                            hoverable={false}
                            bordered={false}
                            size="sm"
                            stickyHeader
                            maxHeight="420px"
                            emptyText="暂无检查明细"
                            className="rounded-sm border border-foreground/10"
                          />
                        </div>
                      ) : (
                        <p
                          className="text-sm text-muted-foreground"
                          key="history-empty"
                        >
                          暂无检查明细
                        </p>
                      )}
                    </AutoTransition>
                  </AutoResizer>
                </section>
              </div>
            ) : (
              <div key="own-link-empty" />
            )}
          </AutoTransition>
        </AutoResizer>

        <section className={sectionClassName}>
          <h3 className={sectionTitleClassName}>
            {ownFriendLink ? "修改你的站点信息" : "填写你的站点信息"}
          </h3>

          <AutoResizer>
            <AutoTransition type="fade" initial={false}>
              {ownFriendLink &&
              !canUpdateOwn &&
              ownFriendLink.status !== "BLOCKED" ? (
                <p className="text-sm text-warning" key="form-warning-readonly">
                  当前状态为 {statusText[ownFriendLink.status]}
                  ，暂不支持直接修改；你可以删除记录后重新申请。
                </p>
              ) : ownFriendLink?.status === "BLOCKED" ? (
                <p className="text-sm text-error" key="form-warning-blocked">
                  当前记录处于拉黑状态，不允许删除或重新申请，请联系管理员处理。
                </p>
              ) : (
                <p
                  className="text-sm text-muted-foreground"
                  key="form-warning-none"
                >
                  申请通过后，你可以随时更改这些信息。
                </p>
              )}
            </AutoTransition>
          </AutoResizer>

          <AutoResizer>
            <AutoTransition type="fade" initial={false}>
              <div
                key={`form-inputs-${ownFriendLink ? "existing" : "new"}-${canUpdateOwn ? "editable" : "readonly"}`}
                className=""
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Input
                    label="站点名称"
                    value={form.name}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                    required
                    size="sm"
                    disabled={ownFriendLink != null && !canUpdateOwn}
                  />
                  <Input
                    label="站点 URL"
                    value={form.url}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, url: event.target.value }))
                    }
                    required
                    size="sm"
                    disabled={ownFriendLink != null && !canUpdateOwn}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Input
                    label="头像 URL"
                    value={form.avatar}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        avatar: event.target.value,
                      }))
                    }
                    required
                    size="sm"
                    disabled={ownFriendLink != null && !canUpdateOwn}
                  />
                  <Input
                    label="站点标语"
                    value={form.slogan}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        slogan: event.target.value,
                      }))
                    }
                    required
                    size="sm"
                    disabled={ownFriendLink != null && !canUpdateOwn}
                  />
                </div>

                <div className="pt-1">
                  <Input
                    label="友链页 URL"
                    value={form.friendLinkUrl}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        friendLinkUrl: event.target.value,
                      }))
                    }
                    helperText={
                      checkBackLinkEnabled
                        ? "用于提交前回链检测，请确保该页面可访问并包含本站域名"
                        : "请填写你的友链页面地址"
                    }
                    required
                    size="sm"
                    disabled={ownFriendLink != null && !canUpdateOwn}
                  />
                </div>

                <div className="pt-1">
                  <Input
                    label="申请备注"
                    value={form.applyNote}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        applyNote: event.target.value,
                      }))
                    }
                    helperText="选填"
                    rows={3}
                    size="sm"
                    disabled={ownFriendLink != null && !canUpdateOwn}
                  />
                </div>
              </div>
            </AutoTransition>
          </AutoResizer>

          <div className="border-t border-foreground/10 pt-4">
            <AutoResizer>
              <AutoTransition type="fade" initial={false}>
                <div
                  className="flex flex-wrap justify-end gap-3"
                  key={`form-actions-${ownFriendLink ? "existing" : isLoggedIn ? "login" : "guest"}-${canUpdateOwn ? "editable" : "readonly"}`}
                >
                  {onRequestClose && (
                    <Button
                      label="关闭"
                      variant="ghost"
                      size="sm"
                      onClick={() => onRequestClose()}
                      disabled={submitting || updating || deleting}
                    />
                  )}

                  {ownFriendLink ? (
                    <>
                      <Button
                        label="删除记录"
                        variant="danger"
                        size="sm"
                        icon={<RiDeleteBinLine size="1em" />}
                        onClick={() => setDeleteDialogOpen(true)}
                        disabled={
                          !canDeleteOwn ||
                          deleting ||
                          updating ||
                          submitting ||
                          loadingOwnLink
                        }
                      />
                      <Button
                        label={canUpdateOwn ? "保存修改" : "当前状态不可修改"}
                        variant="primary"
                        size="sm"
                        onClick={() => void handleUpdate()}
                        loading={updating}
                        disabled={
                          !canUpdateOwn ||
                          deleting ||
                          submitting ||
                          loadingOwnLink
                        }
                      />
                    </>
                  ) : isLoggedIn ? (
                    <CaptchaButton
                      label={applyEnabled ? "提交申请" : "暂未开放申请"}
                      variant="primary"
                      size="sm"
                      onClick={() => void handleSubmitApply()}
                      loading={submitting}
                      disabled={!applyEnabled || loadingOwnLink}
                      verificationText="正在验证"
                    />
                  ) : (
                    <Button
                      label="登录后申请"
                      variant="primary"
                      size="sm"
                      onClick={handleGotoLogin}
                    />
                  )}
                </div>
              </AutoTransition>
            </AutoResizer>
          </div>
        </section>
      </div>

      <AlertDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={() => void handleDelete()}
        title="确认删除友链记录"
        description="删除后会清空你当前的友链记录，后续需要重新提交申请。"
        confirmText="确认删除"
        cancelText="取消"
        variant="danger"
        loading={deleting}
      />
    </>
  );
}
