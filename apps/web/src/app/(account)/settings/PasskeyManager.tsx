"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RiAddLine,
  RiComputerLine,
  RiDeleteBinLine,
  RiKey2Line,
  RiPencilLine,
  RiSmartphoneLine,
} from "@remixicon/react";
import { startRegistration } from "@simplewebauthn/browser";

import {
  deletePasskey,
  generatePasskeyRegistrationOptions,
  renamePasskey,
  verifyPasskeyRegistration,
} from "@/actions/passkey";
import { listUserPasskeys } from "@/lib/client/api/passkey-read";
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

export default function PasskeyManager() {
  const toast = useToast();
  const [items, setItems] = useState<
    Array<{
      credentialId: string;
      name: string;
      deviceType: string | null;
      browser: string | null;
      createdAt: string;
      lastUsedAt: string | null;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const [newName, setNewName] = useState("");
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    credentialId: string;
    name: string;
  } | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const reauthWindowRef = useRef<Window | null>(null);
  const pendingActionRef = useRef<null | {
    type: "create" | "delete" | "rename";
    payload?: Record<string, unknown>;
  }>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listUserPasskeys();
      if (res.success && res.data) {
        setItems(res.data.items);
      } else {
        toast.error(res.message || "获取通行密钥失败");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "获取通行密钥失败");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  function openReauthWindow() {
    const reauthWindow = window.open("/reauth", "reauth");
    reauthWindowRef.current = reauthWindow;
  }

  const createPasskey = useCallback(
    async (name?: string) => {
      setActionLoading(true);
      try {
        const optResp = await generatePasskeyRegistrationOptions();
        if (!optResp.success) {
          const code = (optResp.error as { code?: string } | undefined)?.code;
          if (code === "NEED_REAUTH") {
            pendingActionRef.current = { type: "create", payload: { name } };
            openReauthWindow();
            return;
          }
          toast.error(optResp.message || "无法创建通行密钥");
          setActionLoading(false);
          return;
        }
        const assertion = await startRegistration({
          optionsJSON: optResp.data!.options,
        });
        const verifyResp = await verifyPasskeyRegistration({
          response: assertion,
          name: name || newName || "新密钥",
        });
        if (!verifyResp.success) {
          toast.error(verifyResp.message || "创建失败");
          setActionLoading(false);
          return;
        }
        toast.success("已创建通行密钥");
        setNewName("");
        setShowCreateDialog(false);
        await load();
        setActionLoading(false);
      } catch (e) {
        console.error(e);
        toast.error("创建通行密钥失败");
        setActionLoading(false);
      }
    },
    [load, newName, toast],
  );

  const handleRename = useCallback(
    async (credentialId: string, name: string) => {
      setActionLoading(true);
      const res = await renamePasskey({ credentialId, name });
      if (!res.success) {
        const code = (res.error as { code?: string } | undefined)?.code;
        if (code === "NEED_REAUTH") {
          pendingActionRef.current = {
            type: "rename",
            payload: { credentialId, name },
          };
          openReauthWindow();
          return;
        }
        toast.error(res.message || "重命名失败");
        setActionLoading(false);
        return;
      }
      toast.success("重命名成功");
      setNewName("");
      setShowRenameDialog(false);
      setRenameTarget(null);
      await load();
      setActionLoading(false);
    },
    [load, toast],
  );

  const handleDelete = useCallback(
    async (credentialId: string) => {
      setActionLoading(true);
      const res = await deletePasskey({ credentialId });
      if (!res.success) {
        const code = (res.error as { code?: string } | undefined)?.code;
        if (code === "NEED_REAUTH") {
          pendingActionRef.current = {
            type: "delete",
            payload: { credentialId },
          };
          openReauthWindow();
          return;
        }
        toast.error(res.message || "删除失败");
        setActionLoading(false);
        return;
      }
      toast.success("删除成功");
      setShowDeleteDialog(false);
      setDeleteTarget(null);
      await load();
      setActionLoading(false);
    },
    [load, toast],
  );

  const retryPendingAction = useCallback(async () => {
    const act = pendingActionRef.current;
    pendingActionRef.current = null;
    if (!act) return;
    const p = (act.payload || {}) as { name?: string; credentialId?: string };
    switch (act.type) {
      case "create":
        await createPasskey(p.name);
        break;
      case "delete":
        await handleDelete(p.credentialId as string);
        break;
      case "rename":
        await handleRename(p.credentialId as string, p.name as string);
        break;
    }
  }, [createPasskey, handleDelete, handleRename]);

  useEffect(() => {
    const channel = new BroadcastChannel("reauth-channel");
    channelRef.current = channel;
    channel.onmessage = (event) => {
      const { type } = event.data || {};
      if (type === "reauth-success") {
        toast.success("身份验证成功");
        retryPendingAction();
      } else if (type === "reauth-cancelled") {
        toast.error("身份验证已取消");
        pendingActionRef.current = null;
        setActionLoading(false);
      }
    };

    // 防止 React 严格模式下重复加载
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      load();
    }

    return () => channel.close();
  }, [load, retryPendingAction, toast]);

  // 根据设备类型获取图标
  function getDeviceIcon(deviceType: string | null) {
    switch (deviceType?.toLowerCase()) {
      case "singledevice":
      case "platform":
        return <RiComputerLine size="1.5em" className="text-foreground" />;
      case "multidevice":
        return <RiSmartphoneLine size="1.5em" className="text-foreground" />;
      default:
        return <RiKey2Line size="1.5em" className="text-foreground" />;
    }
  }

  // 获取设备类型显示文本
  function getDeviceTypeText(deviceType: string | null) {
    switch (deviceType?.toLowerCase()) {
      case "singledevice":
      case "platform":
        return "平台验证器";
      case "multidevice":
        return "跨设备验证器";
      default:
        return "通行密钥";
    }
  }

  return (
    <>
      <div className="space-y-6">
        {/* 添加通行密钥按钮 */}
        <div className="flex items-center justify-between gap-3 border-b border-foreground/10 pb-4">
          <div className="min-w-0 flex-1">
            <p className="text-foreground font-medium">管理通行密钥</p>
            <p className="text-sm text-muted-foreground mt-1">
              使用存储于设备上的生物学验证方式来实现无密码登录
            </p>
          </div>
          <Button
            onClick={() => setShowCreateDialog(true)}
            label="添加密钥"
            icon={<RiAddLine size="1.5em" />}
            variant="secondary"
            size="sm"
            disabled={loading || actionLoading}
            className="flex-shrink-0"
          />
        </div>

        {/* 通行密钥列表 */}
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
                    尚未创建任何通行密钥
                  </p>
                </div>
              ) : (
                <div key="list" className="space-y-0">
                  {items.map((item, index) => (
                    <div
                      key={item.credentialId}
                      className={`flex items-center justify-between gap-4 py-4 ${index !== items.length - 1 ? "border-b border-foreground/10" : ""}`}
                    >
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <div className="w-10 h-10 flex items-center justify-center flex-shrink-0">
                          {getDeviceIcon(item.deviceType)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground break-words sm:truncate">
                            {item.name}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground mt-1">
                            <span className="flex items-center gap-1">
                              {getDeviceTypeText(item.deviceType)}
                              {item.browser && (
                                <>
                                  <span className="opacity-50">·</span>
                                  <span>{item.browser}</span>
                                </>
                              )}
                            </span>
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
                                  {formatRelativeTime(item.lastUsedAt)}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-3 flex-shrink-0">
                        <Clickable
                          onClick={() => {
                            setRenameTarget(item.credentialId);
                            setNewName(item.name);
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
                              credentialId: item.credentialId,
                              name: item.name,
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

      {/* 创建通行密钥对话框 */}
      <Dialog
        open={showCreateDialog}
        onClose={() => {
          setShowCreateDialog(false);
          setNewName("");
        }}
        title="添加通行密钥"
        size="sm"
      >
        <div className="px-6 py-6 space-y-8">
          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                创建新的通行密钥
              </h3>
              <p className="text-sm text-muted-foreground mt-2">
                通行密钥使用设备的生物识别技术或设备密码进行身份验证，
                提供比传统密码更安全、更便捷的登录方式。
                <br />
                为保障安全，在执行操作前需要验证你的身份。
              </p>
            </div>
            <div>
              <Input
                label="设备名称"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                size="sm"
                helperText="为这个通行密钥指定一个易于识别的名称"
              />
            </div>
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
              label="创建"
              variant="secondary"
              onClick={() => createPasskey()}
              loading={actionLoading}
              size="sm"
            />
          </div>
        </div>
      </Dialog>

      {/* 重命名通行密钥对话框 */}
      <Dialog
        open={showRenameDialog}
        onClose={() => {
          setShowRenameDialog(false);
          setRenameTarget(null);
          setNewName("");
        }}
        title="重命名通行密钥"
        size="sm"
      >
        <div className="px-6 py-6 space-y-8">
          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                修改设备名称
              </h3>
              <p className="text-sm text-muted-foreground mt-2">
                为保障安全，在执行操作前需要验证你的身份。
              </p>
            </div>
            <div>
              <Input
                label="新名称"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                size="sm"
                placeholder="输入新的设备名称"
                helperText="为这个通行密钥指定一个新的名称"
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

      {/* 删除通行密钥确认对话框 */}
      <AlertDialog
        open={showDeleteDialog}
        onClose={() => {
          setShowDeleteDialog(false);
          setDeleteTarget(null);
        }}
        onConfirm={() =>
          deleteTarget && handleDelete(deleteTarget.credentialId)
        }
        title="确认删除"
        description={`你确定要删除通行密钥 "${deleteTarget?.name}" 吗？删除后将无法使用此通行密钥登录。为保障安全，在执行操作前需要验证你的身份。`}
        confirmText="确认删除"
        cancelText="取消"
        variant="danger"
        loading={actionLoading}
      />
    </>
  );
}
