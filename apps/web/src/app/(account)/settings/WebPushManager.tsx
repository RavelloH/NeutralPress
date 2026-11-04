"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  RiAddLine,
  RiComputerLine,
  RiDeleteBinLine,
  RiNotification3Line,
  RiPencilLine,
  RiSmartphoneLine,
} from "@remixicon/react";
import type { ApiResponse } from "@repo/shared-types/api/common";

import { useWebPush } from "@/hooks/use-webpush";
import { formatRelativeTime } from "@/lib/shared/relative-time";
import { AlertDialog } from "@/ui/AlertDialog";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import Clickable from "@/ui/Clickable";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { useToast } from "@/ui/Toast";

export default function WebPushManager() {
  const toast = useToast();
  const {
    isSupported,
    permission,
    subscribe,
    unsubscribe,
    rename,
    sendTestWebPush,
    getUserPushSubscriptions,
  } = useWebPush();

  const [items, setItems] = useState<
    Array<{
      id: string;
      deviceName: string;
      browser: string | null;
      os: string | null;
      isActive: boolean;
      createdAt: Date;
      lastUsedAt: Date | null;
      endpoint: string;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const [newName, setNewName] = useState("");
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    endpoint: string;
    name: string;
  } | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await getUserPushSubscriptions()) as ApiResponse<{
        subscriptions: Array<{
          id: string;
          deviceName: string;
          browser: string | null;
          os: string | null;
          isActive: boolean;
          createdAt: Date;
          lastUsedAt: Date | null;
          endpoint: string;
        }>;
      } | null>;
      if (res.success && res.data) {
        setItems(res.data.subscriptions);
      } else {
        toast.error(res.message || "获取订阅列表失败");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "获取订阅列表失败");
    } finally {
      setLoading(false);
    }
  }, [toast, getUserPushSubscriptions]);

  useEffect(() => {
    // 防止 React 严格模式下重复加载
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      load();
    }
  }, [load]);

  async function handleSubscribe() {
    setActionLoading(true);
    try {
      const result = (await subscribe(newName || "新设备")) as ApiResponse<{
        message: string;
      } | null>;
      if (result.success) {
        toast.success("订阅成功");
        setNewName("");
        setShowCreateDialog(false);
        await load();
      } else {
        toast.error(result.message || "订阅失败");
      }
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "订阅失败");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRename(endpoint: string, name: string) {
    setActionLoading(true);
    try {
      const res = (await rename(endpoint, name)) as ApiResponse<{
        message: string;
      } | null>;
      if (res.success) {
        toast.success("重命名成功");
        setNewName("");
        setShowRenameDialog(false);
        setRenameTarget(null);
        await load();
      } else {
        toast.error(res.message || "重命名失败");
      }
    } catch (e) {
      console.error(e);
      toast.error("重命名失败");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDelete(endpoint: string) {
    setActionLoading(true);
    try {
      const res = (await unsubscribe(endpoint)) as ApiResponse<{
        message: string;
      } | null>;
      if (res.success) {
        toast.success("删除成功");
        setShowDeleteDialog(false);
        setDeleteTarget(null);
        await load();
      } else {
        toast.error(res.message || "删除失败");
      }
    } catch (e) {
      console.error(e);
      toast.error("删除失败");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSendTest() {
    setActionLoading(true);
    try {
      const res = (await sendTestWebPush()) as ApiResponse<{
        message: string;
      } | null>;
      if (res.success) {
        toast.success(res.message || "测试通知已发送");
      } else {
        toast.error(res.message || "发送测试通知失败");
      }
    } catch (e) {
      console.error(e);
      toast.error("发送测试通知失败");
    } finally {
      setActionLoading(false);
    }
  }

  // 根据设备类型获取图标
  function getDeviceIcon(os: string | null) {
    const osLower = os?.toLowerCase();
    if (osLower === "android" || osLower === "ios") {
      return <RiSmartphoneLine size="1.5em" className="text-foreground" />;
    }
    return <RiComputerLine size="1.5em" className="text-foreground" />;
  }

  // 浏览器不支持
  if (!isSupported) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-foreground mb-2 tracking-wider">
            Web Push 通知
          </h2>
          <p className="text-muted-foreground text-sm">
            接收浏览器原生推送通知，在未打开站点时也能收到实时通知。
          </p>
        </div>

        <div className="bg-background border border-foreground/10 rounded-sm p-6">
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">
              你的浏览器不支持 Web Push 通知功能
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        {/* 添加订阅按钮 */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 pb-4">
          <div className="min-w-0 flex-1">
            <p className="text-foreground font-medium">管理 Web Push 订阅</p>
            <p className="text-sm text-muted-foreground mt-1">
              接收浏览器原生推送通知，在未打开站点时也能收到实时通知。
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              onClick={handleSendTest}
              label="发送测试通知"
              icon={<RiNotification3Line size="1.25em" />}
              variant="ghost"
              size="sm"
              disabled={loading || actionLoading || items.length === 0}
            />
            <Button
              onClick={() => setShowCreateDialog(true)}
              label="添加订阅"
              icon={<RiAddLine size="1.5em" />}
              variant="secondary"
              size="sm"
              disabled={loading || actionLoading}
            />
          </div>
        </div>

        {/* 订阅列表 */}
        <AutoResizer duration={0.3}>
          <div>
            <AutoTransition type="fade" duration={0.2} initial={false}>
              {loading ? (
                <div
                  key="loading"
                  className="flex items-center justify-center py-12"
                >
                  <LoadingIndicator size="md" />
                </div>
              ) : items.length === 0 ? (
                <div
                  key="empty"
                  className="flex flex-col items-center justify-center py-12"
                >
                  <p className="text-sm text-muted-foreground">
                    尚未有订阅设备
                  </p>
                </div>
              ) : (
                <div key="list" className="space-y-0">
                  {items.map((item, index) => (
                    <div
                      key={item.id}
                      className={`flex items-center justify-between gap-4 py-4 ${index !== items.length - 1 ? "border-b border-foreground/10" : ""}`}
                    >
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <div className="w-10 h-10 flex items-center justify-center flex-shrink-0">
                          {getDeviceIcon(item.os)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-foreground break-words sm:truncate">
                              {item.deviceName}
                            </p>
                            {!item.isActive && (
                              <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                                已失效
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground mt-1">
                            {item.browser && (
                              <>
                                <span>{item.browser}</span>
                                {item.os && (
                                  <span className="opacity-50">·</span>
                                )}
                              </>
                            )}
                            {item.os && <span>{item.os}</span>}
                            <span className="opacity-50">·</span>
                            <span className="whitespace-nowrap">
                              创建于{" "}
                              {new Date(item.createdAt).toLocaleString(
                                "zh-CN",
                                {
                                  year: "numeric",
                                  month: "2-digit",
                                  day: "2-digit",
                                },
                              )}
                            </span>
                            {item.lastUsedAt && (
                              <>
                                <span className="opacity-50">·</span>
                                <span className="whitespace-nowrap">
                                  上次使用于{" "}
                                  {formatRelativeTime(
                                    item.lastUsedAt.toString(),
                                  )}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-3 flex-shrink-0 pr-0 sm:pr-5">
                        <Clickable
                          onClick={() => {
                            setRenameTarget(item.endpoint);
                            setNewName(item.deviceName);
                            setShowRenameDialog(true);
                          }}
                          disabled={actionLoading}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <RiPencilLine size="1.25em" />
                        </Clickable>
                        <Clickable
                          onClick={() => {
                            setDeleteTarget({
                              endpoint: item.endpoint,
                              name: item.deviceName,
                            });
                            setShowDeleteDialog(true);
                          }}
                          disabled={actionLoading}
                          className="text-error transition-colors"
                        >
                          <RiDeleteBinLine size="1.25em" />
                        </Clickable>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </AutoTransition>
          </div>
        </AutoResizer>
      </div>

      {/* 创建订阅对话框 */}
      <Dialog
        open={showCreateDialog}
        onClose={() => {
          setShowCreateDialog(false);
          setNewName("");
        }}
        title="添加 Web Push 订阅"
        size="sm"
      >
        <div className="px-6 py-6 space-y-8">
          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                订阅推送通知
              </h3>
              <p className="text-sm text-muted-foreground mt-2">
                订阅后，即使浏览器关闭，你也能收到系统通知。
                <br />
                你的浏览器会请求通知权限，请点击&quot;允许&quot;以继续。
              </p>
            </div>
            <div>
              <Input
                label="设备名称"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                size="sm"
                helperText="为这个设备指定一个易于识别的名称"
              />
            </div>
            {permission === "denied" && (
              <div className="p-4 bg-error/10 rounded-sm">
                <p className="text-sm text-error">
                  你已拒绝通知权限。请在浏览器设置中允许此网站的通知权限。
                </p>
              </div>
            )}
          </section>

          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end sm:gap-4">
            <Button
              label="取消"
              variant="ghost"
              onClick={() => {
                setShowCreateDialog(false);
                setNewName("");
              }}
              size="sm"
              disabled={actionLoading}
            />
            <Button
              label="订阅"
              variant="secondary"
              onClick={handleSubscribe}
              loading={actionLoading}
              size="sm"
              disabled={permission === "denied"}
            />
          </div>
        </div>
      </Dialog>

      {/* 重命名对话框 */}
      <Dialog
        open={showRenameDialog}
        onClose={() => {
          setShowRenameDialog(false);
          setRenameTarget(null);
          setNewName("");
        }}
        title="重命名订阅"
        size="sm"
      >
        <div className="px-6 py-6 space-y-8">
          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                修改设备名称
              </h3>
            </div>
            <div>
              <Input
                label="新名称"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                size="sm"
                helperText="为这个设备订阅指定一个新的名称"
              />
            </div>
          </section>

          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end sm:gap-4">
            <Button
              label="取消"
              variant="ghost"
              onClick={() => {
                setShowRenameDialog(false);
                setRenameTarget(null);
                setNewName("");
              }}
              size="sm"
              disabled={actionLoading}
            />
            <Button
              label="确认重命名"
              variant="secondary"
              onClick={() =>
                renameTarget && handleRename(renameTarget, newName)
              }
              loading={actionLoading}
              size="sm"
              disabled={!newName.trim() || actionLoading}
            />
          </div>
        </div>
      </Dialog>

      {/* 删除确认对话框 */}
      <AlertDialog
        open={showDeleteDialog}
        onClose={() => {
          setShowDeleteDialog(false);
          setDeleteTarget(null);
        }}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget.endpoint)}
        title="确认删除"
        description={`你确定要删除设备订阅 "${deleteTarget?.name}" 吗？删除后将无法在此设备上收到推送通知。`}
        confirmText="确认删除"
        cancelText="取消"
        variant="danger"
        loading={actionLoading}
      />
    </>
  );
}
