"use client";

import { useCallback, useEffect, useState } from "react";

import { GridItem } from "@/components/client/layout/RowGrid";
import { Button } from "@/ui/Button";
import { Input } from "@/ui/Input";

interface Settings {
  zoneId: string;
  siteUrl: string;
  tokenConfigured: boolean;
  source: "database" | "environment" | "none";
}
interface Result {
  success: boolean;
  message?: string;
  data?: Settings;
}
const ENDPOINT = "/api/public/admin/settings/cdn";

export default function CloudflareCacheSettings() {
  const [config, setConfig] = useState<Settings>({
    zoneId: "",
    siteUrl: "",
    tokenConfigured: false,
    source: "none",
  });
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"loading" | "saving" | "testing" | null>(
    "loading",
  );
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    setBusy("loading");
    try {
      const response = await fetch(ENDPOINT, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const result: Result = await response.json();
      if (!response.ok || !result.success || !result.data) {
        throw new Error(result.message || "读取 CDN 设置失败");
      }
      setConfig(result.data);
      setToken("");
      setFailed(false);
      setMessage("");
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "读取配置失败");
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async (action: "save" | "test") => {
    setBusy(action === "save" ? "saving" : "testing");
    setMessage("");
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          zoneId: config.zoneId.trim(),
          siteUrl: config.siteUrl.trim(),
          ...(token.trim() ? { token: token.trim() } : {}),
        }),
      });
      const result: Result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || "操作失败");
      }
      if (result.data) setConfig(result.data);
      if (action === "save") setToken("");
      setFailed(false);
      setMessage(result.message || "操作成功");
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(null);
    }
  };

  return (
    <GridItem areas={[1, 2, 3, 4]} width={3} height={1.2}>
      <section className="flex h-full flex-col gap-5 rounded-xl p-8 text-foreground">
        <div>
          <h2 className="text-2xl font-medium">Cloudflare CDN</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            通过内置配置管理 CDN，不需要修改容器环境变量或重新部署。 Purge Token
            与其他站点配置一样保存在数据库中（暂不加密），仅后台管理员可操作；缓存队列每次使用时读取最新配置。
          </p>
        </div>
        <div className="text-sm text-muted-foreground">
          {config.tokenConfigured
            ? "Purge Token：已配置（不会回传明文）"
            : "Purge Token：尚未配置"}
          {" · "}
          {config.source === "database"
            ? "使用数据库配置"
            : config.source === "environment"
              ? "当前为旧环境变量配置，保存后自动迁移"
              : "尚未初始化"}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            label="Cloudflare Zone ID"
            value={config.zoneId}
            placeholder="32 位 Zone ID"
            onChange={(e) =>
              setConfig((old) => ({ ...old, zoneId: e.target.value }))
            }
            disabled={busy !== null}
          />
          <Input
            label="站点公开地址"
            value={config.siteUrl}
            placeholder="https://example.com"
            onChange={(e) =>
              setConfig((old) => ({ ...old, siteUrl: e.target.value }))
            }
            disabled={busy !== null}
          />
          <div className="md:col-span-2">
            <Input
              label={
                config.tokenConfigured
                  ? "替换 Purge Token（留空保持原值）"
                  : "Purge Token"
              }
              type="password"
              autoComplete="new-password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={busy !== null}
              helperText="仅通过受保护接口提交，不展示已存凭据；保存前会验证 Cloudflare Purge 权限。"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            label="测试连接"
            variant="outline"
            size="sm"
            onClick={() => void submit("test")}
            loading={busy === "testing"}
            disabled={busy !== null}
          />
          <Button
            label="保存并立即生效"
            size="sm"
            onClick={() => void submit("save")}
            loading={busy === "saving"}
            disabled={busy !== null}
          />
          <Button
            label="刷新"
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            disabled={busy !== null}
          />
        </div>
        {message && (
          <p
            role={failed ? "alert" : "status"}
            className={
              failed ? "text-sm text-error" : "text-sm text-muted-foreground"
            }
          >
            {message}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          当前 HTML 缓存策略为：60 秒新鲜期 + 60 秒
          SWR，匿名的首页、文章列表、项目列表和画廊允许共享缓存；
          私有页面及受保护文章不参与共享 HTML 缓存。
        </p>
      </section>
    </GridItem>
  );
}
