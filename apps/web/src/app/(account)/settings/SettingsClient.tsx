"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RiDatabase2Line,
  RiDeviceLine,
  RiNotification3Line,
  RiShieldKeyholeLine,
  RiUserLine,
} from "@remixicon/react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  BasicInfoDialogs,
  type BasicInfoDialogsRef,
} from "@/app/(account)/settings/BasicInfoDialogs";
import { BasicInfoSection } from "@/app/(account)/settings/BasicInfoSection";
import { LocalStorageSection } from "@/app/(account)/settings/LocalStorageSection";
import { NotificationSection } from "@/app/(account)/settings/NotificationSection";
import {
  PasswordDialogs,
  type PasswordDialogsRef,
} from "@/app/(account)/settings/PasswordDialogs";
import { SecuritySection } from "@/app/(account)/settings/SecuritySection";
import {
  SessionDialogs,
  type SessionDialogsRef,
} from "@/app/(account)/settings/SessionDialogs";
import { SessionSection } from "@/app/(account)/settings/SessionSection";
import {
  SSODialogs,
  type SSODialogsRef,
} from "@/app/(account)/settings/SSODialogs";
import { type TotpDialogsRef } from "@/app/(account)/settings/TotpDialogs";
import {
  type PendingAction,
  useReauth,
} from "@/app/(account)/settings/use-reauth";
import UnauthorizedPage from "@/app/unauthorized";
import { useMobile } from "@/hooks/use-mobile";
import { getUserProfile } from "@/lib/client/api/user-read";
import type { OAuthProvider } from "@/lib/server/oauth";
import { AutoTransition } from "@/ui/AutoTransition";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { useToast } from "@/ui/Toast";

interface LinkedAccount {
  provider: string;
  email: string;
}

interface UserProfile {
  uid: number;
  username: string;
  email: string;
  nickname: string | null;
  website: string | null;
  bio: string | null;
  role: "USER" | "ADMIN" | "EDITOR" | "AUTHOR";
  createdAt: string;
  hasPassword: boolean;
  linkedAccounts: LinkedAccount[];
}

interface SettingsClientProps {
  enabledSSOProviders: OAuthProvider[];
  passkeyEnabled: boolean;
}

export default function SettingsClient({
  enabledSSOProviders,
  passkeyEnabled,
}: SettingsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<string>("basic");

  // Refs
  const passwordDialogsRef = useRef<PasswordDialogsRef>(null);
  const ssoDialogsRef = useRef<SSODialogsRef>(null);
  const sessionDialogsRef = useRef<SessionDialogsRef>(null);
  const totpDialogsRef = useRef<TotpDialogsRef>(null);
  const basicInfoDialogsRef = useRef<BasicInfoDialogsRef>(null);

  // 状态管理（简化）
  const [unlinkProvider, setUnlinkProvider] = useState<OAuthProvider | null>(
    null,
  );
  const [showUnlinkDialog, setShowUnlinkDialog] = useState(false);
  const [revokeSessionId, setRevokeSessionId] = useState<string | null>(null);
  const [showRevokeSessionDialog, setShowRevokeSessionDialog] = useState(false);
  const isMobile = useMobile();

  // Reauth Hook
  const {
    openReauthWindow,
    setPendingAction,
    getPendingAction,
    clearPendingAction,
    redirectToSSOBind,
  } = useReauth({
    onReauthSuccess: () => {
      toast.success("身份验证成功");
      retryPendingAction();
    },
    onReauthCancelled: () => {
      toast.error("身份验证已取消");
      clearPendingAction();
    },
  });

  const sections = useMemo(
    () => [
      { id: "basic", label: "基本信息", icon: RiUserLine },
      { id: "notifications", label: "通知管理", icon: RiNotification3Line },
      { id: "local-storage", label: "本地存储", icon: RiDatabase2Line },
      { id: "sessions", label: "会话管理", icon: RiDeviceLine },
      { id: "security", label: "安全设置", icon: RiShieldKeyholeLine },
    ],
    [],
  );

  const handleSectionChange = useCallback((sectionId: string) => {
    setActiveSection(sectionId);
    window.history.replaceState(null, "", `/settings#${sectionId}`);
  }, []);

  // 从 URL hash 读取当前分类
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash && sections.some((section) => section.id === hash)) {
      setActiveSection(hash);
    }
  }, [sections]);

  // 加载用户信息
  const loadUserInfo = useCallback(async () => {
    try {
      const result = await getUserProfile();
      if (result.success && result.data) {
        setUser(result.data);
      } else {
        toast.error(result.message || "加载失败");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // 重试待处理的操作
  const retryPendingAction = useCallback(async () => {
    const action = getPendingAction();
    if (!action) return;

    clearPendingAction();

    switch (action.type) {
      case "link":
        redirectToSSOBind(action.data.provider);
        break;
      case "unlink":
        // 直接执行解绑操作
        await ssoDialogsRef.current?.executeUnlinkSSO(action.data);
        break;
      case "setPassword":
        // 直接执行设置密码操作
        await passwordDialogsRef.current?.executeSetPassword(action.data);
        break;
      case "changePassword":
        // 直接执行修改密码操作
        await passwordDialogsRef.current?.executeChangePassword(action.data);
        break;
      case "revokeSession":
        // 直接执行撤销会话操作
        await sessionDialogsRef.current?.executeRevokeSession(action.data);
        break;
      case "enableTotp":
        // 直接执行启用 TOTP 操作
        await totpDialogsRef.current?.executeEnableTotp();
        break;
      case "disableTotp":
        // 直接执行禁用 TOTP 操作
        await totpDialogsRef.current?.executeDisableTotp();
        break;
      case "regenerateBackupCodes":
        // 直接执行重新生成备份码操作
        await totpDialogsRef.current?.executeRegenerateBackupCodes();
        break;
      case "updateProfile":
        // 直接执行更新个人资料操作
        await basicInfoDialogsRef.current?.executeUpdate(action.data);
        break;
    }
  }, [clearPendingAction, getPendingAction, redirectToSSOBind]);

  // 处理 URL 参数和初始化
  useEffect(() => {
    const successParam = searchParams.get("success");
    const errorParam = searchParams.get("error");
    const triggerReauth = searchParams.get("trigger_reauth");
    const provider = searchParams.get("provider");

    // 如果是绑定成功返回，恢复保存的 hash
    if (successParam && !window.location.hash) {
      const savedHash = localStorage.getItem("sso_bind_return_hash");
      if (savedHash) {
        localStorage.removeItem("sso_bind_return_hash");
        window.location.hash = savedHash;
      }
    }

    if (successParam) toast.success(successParam);
    if (errorParam) toast.error(errorParam);

    // 清除 URL 中的消息参数
    if (successParam || errorParam) {
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.delete("success");
      newSearchParams.delete("error");

      const newUrl = newSearchParams.toString()
        ? `/settings?${newSearchParams.toString()}${window.location.hash}`
        : `/settings${window.location.hash}`;
      router.replace(newUrl);
    }

    // 如果需要触发 reauth
    if (triggerReauth === "bind_sso" && provider) {
      setPendingAction({
        type: "link",
        data: { provider: provider as OAuthProvider },
      });
      openReauthWindow();

      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.delete("trigger_reauth");
      newSearchParams.delete("provider");

      const newUrl = newSearchParams.toString()
        ? `/settings?${newSearchParams.toString()}${window.location.hash}`
        : `/settings${window.location.hash}`;
      router.replace(newUrl);
    }

    loadUserInfo();
  }, [
    searchParams,
    loadUserInfo,
    router,
    toast,
    openReauthWindow,
    setPendingAction,
  ]);

  // 处理绑定 SSO
  const handleLinkSSO = async (provider: OAuthProvider) => {
    if (window.location.hash) {
      localStorage.setItem("sso_bind_return_hash", window.location.hash);
    }
    router.push(`/sso/${provider}/login?mode=bind&redirect_to=/settings`);
  };

  // 处理解绑 SSO
  const handleUnlinkSSO = (provider: OAuthProvider) => {
    setUnlinkProvider(provider);
    setShowUnlinkDialog(true);
  };

  // 处理密码操作
  const handlePasswordAction = (action: "set" | "change") => {
    if (action === "set") {
      passwordDialogsRef.current?.openSetPasswordDialog();
    } else {
      passwordDialogsRef.current?.openChangePasswordDialog();
    }
  };

  // 处理撤销会话
  const handleRevokeSession = (sessionId: string) => {
    setRevokeSessionId(sessionId);
    setShowRevokeSessionDialog(true);
  };

  // 处理 Reauth 需求
  const handleNeedReauth = (action: PendingAction) => {
    setPendingAction(action);
    openReauthWindow();
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <LoadingIndicator size="md" />
      </div>
    );
  }

  if (!user) {
    return <UnauthorizedPage redirect="/settings" />;
  }

  return (
    <div className="bg-background">
      <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {/* 头部 */}
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-foreground tracking-wider sm:text-3xl">
            账户设置
          </h1>
          <p className="mt-2 text-muted-foreground">
            管理你的账户信息和偏好设置
          </p>
        </div>

        {/* 左右两栏布局 */}
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
          {/* 左侧导航栏 */}
          <aside className="w-full lg:w-64 lg:flex-shrink-0">
            {isMobile ? (
              <nav className="w-full h-[4em] overflow-x-auto overflow-y-hidden mb-3">
                <div className="flex items-center h-full gap-2 min-w-max">
                  {sections.map((section) => {
                    const Icon = section.icon;
                    const isActive = activeSection === section.id;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => handleSectionChange(section.id)}
                        aria-current={isActive ? "page" : undefined}
                        className={`flex items-center gap-2 px-3 py-2 shrink-0 transition-all duration-200 ${
                          isActive
                            ? "bg-primary text-primary-foreground shadow-md"
                            : "bg-muted/50 hover:bg-muted"
                        }`}
                      >
                        <div className="flex items-center justify-center">
                          <Icon size="1.25em" />
                        </div>
                        <span className="text-sm font-medium whitespace-nowrap">
                          {section.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </nav>
            ) : (
              <nav className="lg:sticky lg:top-8 lg:block lg:space-y-1">
                {sections.map((section) => {
                  const Icon = section.icon;
                  const isActive = activeSection === section.id;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => handleSectionChange(section.id)}
                      aria-current={isActive ? "page" : undefined}
                      className={`
                        flex w-full items-center gap-3 whitespace-nowrap rounded-sm px-4 py-2.5
                        text-left transition-all duration-200
                        ${
                          isActive
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-foreground hover:bg-foreground/5"
                        }
                      `}
                    >
                      <Icon size="1.25em" />
                      <span>{section.label}</span>
                    </button>
                  );
                })}
              </nav>
            )}
          </aside>

          {/* 右侧内容区 */}
          <main className="flex-1 min-w-0">
            <AutoTransition type="fade" duration={0.3}>
              {activeSection === "basic" && (
                <BasicInfoSection
                  user={user}
                  basicInfoDialogsRef={basicInfoDialogsRef}
                />
              )}
              {activeSection === "notifications" && <NotificationSection />}
              {activeSection === "local-storage" && <LocalStorageSection />}
              {activeSection === "sessions" && (
                <SessionSection onRevokeSession={handleRevokeSession} />
              )}
              {activeSection === "security" && (
                <SecuritySection
                  user={user}
                  enabledSSOProviders={enabledSSOProviders}
                  passkeyEnabled={passkeyEnabled}
                  onPasswordAction={handlePasswordAction}
                  onLinkSSO={handleLinkSSO}
                  onUnlinkSSO={handleUnlinkSSO}
                  onNeedReauth={(action) => handleNeedReauth(action)}
                  totpDialogsRef={totpDialogsRef}
                />
              )}
            </AutoTransition>
          </main>
        </div>

        {/* 对话框组件 */}
        <BasicInfoDialogs
          ref={basicInfoDialogsRef}
          onFieldUpdated={loadUserInfo}
          onNeedReauth={(action) => handleNeedReauth(action)}
        />

        <PasswordDialogs
          ref={passwordDialogsRef}
          onPasswordSet={loadUserInfo}
          onNeedReauth={(action) => handleNeedReauth(action)}
        />

        <SSODialogs
          ref={ssoDialogsRef}
          provider={unlinkProvider}
          isOpen={showUnlinkDialog}
          onClose={() => {
            setShowUnlinkDialog(false);
            setUnlinkProvider(null);
          }}
          onUnlinkSuccess={loadUserInfo}
          onNeedReauth={(action) => handleNeedReauth(action)}
        />

        <SessionDialogs
          ref={sessionDialogsRef}
          sessionId={revokeSessionId}
          isOpen={showRevokeSessionDialog}
          onClose={() => {
            setShowRevokeSessionDialog(false);
            setRevokeSessionId(null);
          }}
          onRevokeSuccess={() => {
            /* 会话列表会自动刷新 */
          }}
          onNeedReauth={(action) => handleNeedReauth(action)}
        />
      </div>
    </div>
  );
}
