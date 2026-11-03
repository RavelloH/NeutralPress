"use client";

import { useCallback, useEffect, useState } from "react";
import { RiAddLine, RiRefreshLine } from "@remixicon/react";

import { createUser } from "@/actions/user";
import { GridItem } from "@/components/client/layout/RowGrid";
import ErrorPage from "@/components/ui/Error";
import { useBroadcastSender } from "@/hooks/use-broadcast";
import { getUsersStats } from "@/lib/client/api/stats";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import Clickable from "@/ui/Clickable";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import type { SelectOption } from "@/ui/Select";
import { Select } from "@/ui/Select";
import { useToast } from "@/ui/Toast";

type StatsData = {
  updatedAt: string;
  cache: boolean;
  total: {
    total: number;
    user: number;
    admin: number;
    editor: number;
    author: number;
  };
  active: {
    lastDay: number;
    last7Days: number;
    last30Days: number;
  };
  new: {
    lastDay: number;
    last7Days: number;
    last30Days: number;
  };
};

type UserRole = "USER" | "ADMIN" | "EDITOR" | "AUTHOR";
type UserStatus = "ACTIVE" | "SUSPENDED" | "NEEDS_UPDATE";

type CreateFormData = {
  username: string;
  nickname: string;
  email: string;
  password: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  emailNotice: boolean;
};

const getInitialCreateFormData = (): CreateFormData => ({
  username: "",
  nickname: "",
  email: "",
  password: "",
  role: "USER",
  status: "ACTIVE",
  emailVerified: false,
  emailNotice: false,
});

const roleOptions: SelectOption[] = [
  { value: "USER", label: "用户" },
  { value: "AUTHOR", label: "作者" },
  { value: "EDITOR", label: "编辑" },
  { value: "ADMIN", label: "管理员" },
];

const statusOptions: SelectOption[] = [
  { value: "ACTIVE", label: "正常" },
  { value: "SUSPENDED", label: "已封禁" },
  { value: "NEEDS_UPDATE", label: "需更新" },
];

export default function UsersReport() {
  const toast = useToast();
  const [result, setResult] = useState<StatsData | null>(null);
  const [refreshTime, setRefreshTime] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const { broadcast } = useBroadcastSender<{ type: "users-refresh" }>();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createFormData, setCreateFormData] = useState<CreateFormData>(
    getInitialCreateFormData,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchData = useCallback(
    async (forceRefresh: boolean = false) => {
      if (forceRefresh) {
        setResult(null);
      }
      setError(null);
      const res = await getUsersStats({ force: forceRefresh });
      if (!res.success) {
        setError(new Error(res.message || "获取用户统计失败"));
        return;
      }
      if (!res.data) return;
      setResult(res.data);
      setRefreshTime(new Date(res.data.updatedAt));

      // 刷新成功后广播消息,通知其他组件更新
      if (forceRefresh) {
        await broadcast({ type: "users-refresh" });
      }
    },
    [broadcast],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreateDialog = () => {
    setCreateFormData(getInitialCreateFormData());
    setCreateDialogOpen(true);
  };

  const closeCreateDialog = () => {
    setCreateDialogOpen(false);
  };

  const handleCreateUser = async () => {
    if (!createFormData.username.trim()) {
      toast.error("用户名不能为空");
      return;
    }
    if (!createFormData.email.trim()) {
      toast.error("邮箱不能为空");
      return;
    }
    if (!createFormData.password.trim()) {
      toast.error("密码不能为空");
      return;
    }

    setIsSubmitting(true);
    try {
      const createResult = await createUser({
        username: createFormData.username.trim(),
        nickname: createFormData.nickname.trim() || undefined,
        email: createFormData.email.trim(),
        password: createFormData.password,
        role: createFormData.role,
        status: createFormData.status,
        emailVerified: createFormData.emailVerified,
        emailNotice: createFormData.emailNotice,
      });

      if (createResult.success) {
        toast.success(`用户 "${createFormData.username}" 已创建`);
        closeCreateDialog();
        await fetchData(true);
      } else {
        toast.error(createResult.message || "未知错误");
      }
    } catch (createError) {
      console.error("创建用户失败:", createError);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <GridItem areas={[1, 2, 3, 4, 5, 6]} width={2} height={0.5}>
        <AutoTransition type="scale" className="h-full">
          {result ? (
            <div
              className="flex flex-col justify-between p-10 h-full"
              key="content"
            >
              <div>
                <div className="text-2xl py-2">用户统计</div>
                <div>
                  共 {result.total.total} 名用户，包括 {result.total.user}{" "}
                  名普通用户、
                  {result.total.admin} 名管理员、{result.total.editor} 名编辑、
                  {result.total.author} 名作者。
                </div>
              </div>
              <div>
                <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-2 w-fit">
                  <span className="text-right font-semibold">活跃用户：</span>
                  <span>
                    24小时 {result.active.lastDay} / 7天{" "}
                    {result.active.last7Days} / 30天 {result.active.last30Days}
                  </span>

                  <span className="text-right font-semibold">新增用户：</span>
                  <span>
                    24小时 {result.new.lastDay} / 7天 {result.new.last7Days} /
                    30天 {result.new.last30Days}
                  </span>

                  <span className="text-right font-semibold">角色分布：</span>
                  <span>
                    USER {result.total.user} / ADMIN {result.total.admin} /
                    EDITOR {result.total.editor} / AUTHOR {result.total.author}
                  </span>
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

      <GridItem areas={[7, 8]} width={6} height={0.2}>
        <AutoTransition type="scale" className="h-full">
          <button
            onClick={openCreateDialog}
            className="h-full w-full flex gap-2 items-center justify-center text-2xl hover:bg-primary hover:text-primary-foreground transition-all cursor-pointer"
          >
            <RiAddLine size="1.1em" /> 创建用户
          </button>
        </AutoTransition>
      </GridItem>

      <Dialog
        open={createDialogOpen}
        onClose={closeCreateDialog}
        title="创建用户"
        size="md"
      >
        <div className="px-6 py-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="用户名"
              value={createFormData.username}
              onChange={(e) =>
                setCreateFormData((prev) => ({
                  ...prev,
                  username: e.target.value,
                }))
              }
              required
              size="sm"
              helperText="只能包含小写字母、数字和下划线，且以字母开头"
            />
            <Input
              label="昵称（可选）"
              value={createFormData.nickname}
              onChange={(e) =>
                setCreateFormData((prev) => ({
                  ...prev,
                  nickname: e.target.value,
                }))
              }
              size="sm"
            />
            <Input
              label="邮箱"
              type="email"
              value={createFormData.email}
              onChange={(e) =>
                setCreateFormData((prev) => ({
                  ...prev,
                  email: e.target.value,
                }))
              }
              required
              size="sm"
            />
            <Input
              label="密码"
              type="password"
              value={createFormData.password}
              onChange={(e) =>
                setCreateFormData((prev) => ({
                  ...prev,
                  password: e.target.value,
                }))
              }
              required
              size="sm"
              helperText="最少 6 个字符"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-foreground mb-2">角色</label>
              <Select
                value={createFormData.role}
                onChange={(value) =>
                  setCreateFormData((prev) => ({
                    ...prev,
                    role: value as UserRole,
                  }))
                }
                options={roleOptions}
                size="sm"
              />
            </div>
            <div>
              <label className="block text-sm text-foreground mb-2">状态</label>
              <Select
                value={createFormData.status}
                onChange={(value) =>
                  setCreateFormData((prev) => ({
                    ...prev,
                    status: value as UserStatus,
                  }))
                }
                options={statusOptions}
                size="sm"
              />
            </div>
          </div>

          <div className="space-y-3 flex flex-col">
            <Checkbox
              label="邮箱已验证"
              checked={createFormData.emailVerified}
              onChange={(e) =>
                setCreateFormData((prev) => ({
                  ...prev,
                  emailVerified: e.target.checked,
                }))
              }
            />
            <Checkbox
              label="接收邮件通知"
              checked={createFormData.emailNotice}
              onChange={(e) =>
                setCreateFormData((prev) => ({
                  ...prev,
                  emailNotice: e.target.checked,
                }))
              }
            />
          </div>

          <div className="flex justify-end gap-4 pt-4 border-t border-foreground/10">
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
              onClick={handleCreateUser}
              size="sm"
              loading={isSubmitting}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}
