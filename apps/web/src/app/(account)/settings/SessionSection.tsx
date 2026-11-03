"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RiDeleteBinLine } from "@remixicon/react";

import { getDeviceIcon } from "@/app/(account)/settings/settingsHelpers";
import { getSessions } from "@/lib/client/api/account-security-read";
import { formatRelativeTime } from "@/lib/shared/relative-time";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import Clickable from "@/ui/Clickable";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { useToast } from "@/ui/Toast";

export interface Session {
  id: string;
  deviceType: string;
  deviceIcon: string;
  displayName: string;
  browserName: string;
  browserVersion: string;
  createdAt: string;
  lastUsedAt: string | null;
  ipAddress: string;
  ipLocation: string | null;
  revokedAt: string | null;
  isCurrent: boolean;
}

interface SessionSectionProps {
  onRevokeSession: (sessionId: string) => void;
}

/**
 * 会话管理板块组件
 */
export function SessionSection({ onRevokeSession }: SessionSectionProps) {
  const toast = useToast();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const hasLoadedRef = useRef(false);

  // 加载会话列表
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const result = await getSessions();
      if (result.success && result.data) {
        setSessions(result.data.sessions);
      } else {
        toast.error(result.message || "加载会话列表失败");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载会话列表失败");
    } finally {
      setSessionsLoading(false);
    }
  }, [toast]);

  // 自动加载会话列表（只加载一次）
  useEffect(() => {
    if (!hasLoadedRef.current) {
      loadSessions();
      hasLoadedRef.current = true;
    }
  }, [loadSessions]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground mb-2 tracking-wider">
          会话管理
        </h2>
        <p className="text-muted-foreground text-sm">
          管理你的登录会话，撤销可疑设备的访问权限
        </p>
      </div>

      <div className="bg-background border border-foreground/10 rounded-sm">
        <div className="px-4 py-4 border-b border-foreground/10 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-foreground font-medium">管理活跃的会话</p>
              <p className="text-sm text-muted-foreground mt-1">
                查看所有登录设备并撤销可疑会话
              </p>
            </div>
            <Button
              label="刷新"
              onClick={loadSessions}
              variant="ghost"
              size="sm"
              loading={sessionsLoading}
              disabled={sessionsLoading}
              className="flex-shrink-0"
            />
          </div>
        </div>
        <div className="p-4 sm:p-6">
          <AutoResizer duration={0.3}>
            <div>
              <AutoTransition type="fade" duration={0.2} initial={false}>
                {sessionsLoading ? (
                  <div
                    key="loading"
                    className="flex items-center justify-center py-12"
                  >
                    <LoadingIndicator size="md" />
                  </div>
                ) : sessions.length === 0 ? (
                  <div
                    key="empty"
                    className="flex flex-col items-center justify-center py-12"
                  >
                    <p className="text-sm text-muted-foreground">
                      尚未创建任何会话
                    </p>
                  </div>
                ) : (
                  <div key="list" className="space-y-0">
                    {sessions.map((session, index) => (
                      <div
                        key={session.id}
                        className={`
                          flex items-center justify-between gap-4 py-4 sm:pr-5
                          ${index !== sessions.length - 1 ? "border-b border-foreground/10" : ""}
                          ${session.revokedAt ? "opacity-50" : ""}
                        `}
                      >
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          <div className="w-10 h-10 flex items-center justify-center flex-shrink-0">
                            {getDeviceIcon(session.deviceIcon)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-foreground break-words sm:truncate">
                                {session.displayName}
                              </p>
                              {session.isCurrent && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
                                  当前会话
                                </span>
                              )}
                              {session.revokedAt && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                                  已撤销
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground mt-1">
                              {session.ipLocation && (
                                <>
                                  <span>{session.ipLocation}</span>
                                  <span className="opacity-50">·</span>
                                </>
                              )}
                              <span className="whitespace-nowrap">
                                登录于{" "}
                                {new Date(session.createdAt).toLocaleString(
                                  "zh-CN",
                                  {
                                    year: "numeric",
                                    month: "2-digit",
                                    day: "2-digit",
                                  },
                                )}
                              </span>
                              {session.lastUsedAt && (
                                <>
                                  <span className="opacity-50">·</span>
                                  <span className="whitespace-nowrap">
                                    上次活跃于{" "}
                                    {formatRelativeTime(session.lastUsedAt)}
                                  </span>
                                </>
                              )}
                              {session.revokedAt && (
                                <>
                                  <span className="opacity-50">·</span>
                                  <span className="whitespace-nowrap">
                                    撤销于{" "}
                                    {formatRelativeTime(session.revokedAt)}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        {!session.isCurrent && !session.revokedAt && (
                          <div className="flex gap-3 flex-shrink-0">
                            <Clickable
                              onClick={() => onRevokeSession(session.id)}
                              className="text-error transition-colors"
                            >
                              <RiDeleteBinLine size="1.25em" />
                            </Clickable>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </AutoTransition>
            </div>
          </AutoResizer>
        </div>
      </div>
    </div>
  );
}
