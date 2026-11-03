"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiDownloadLine,
  RiUploadCloud2Line,
  RiUploadLine,
} from "@remixicon/react";
import type {
  BackupExportOssResult,
  BackupImportUploadInitResult,
  BackupScope,
  BackupScopeItem,
  BackupSource,
} from "@repo/shared-types/api/backup";
import { put as putBlob } from "@vercel/blob/client";

import {
  dryRunBackupImport,
  exportBackup,
  initBackupImportUpload,
} from "@/actions/backup";
import { GridItem } from "@/components/client/layout/RowGrid";
import Link from "@/components/ui/Link";
import { getBackupScopes } from "@/lib/client/api/backup-scopes-read";
import { resolveApiResponse } from "@/lib/client/run-with-auth";
import runWithAuth from "@/lib/client/run-with-auth";
import { formatBytes } from "@/lib/shared/format";
import { useBackupStore } from "@/store/backup-store";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { useToast } from "@/ui/Toast";

const DIRECT_LIMIT_BYTES = 4 * 1024 * 1024;

type SourceMode = "DIRECT" | "OSS_UPLOAD";

type UploadedOssSource = {
  url: string;
  key: string;
  providerType: string;
  providerName: string;
  storageProviderId: string;
  fileName: string;
  sizeBytes: number;
};

function downloadJson(content: string, fileName: string): void {
  const blob = new Blob([content], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getUtf8Size(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

async function uploadToSignedS3(
  result: Extract<BackupImportUploadInitResult, { strategy: "CLIENT_S3" }>,
  file: File,
  onProgress: (progress: number) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`上传失败: ${xhr.status} ${xhr.statusText}`));
      }
    });
    xhr.addEventListener("error", () =>
      reject(new Error("上传失败: 网络错误")),
    );
    xhr.addEventListener("abort", () => reject(new Error("上传已取消")));

    xhr.open(result.uploadMethod, result.uploadUrl);
    for (const [name, value] of Object.entries(result.uploadHeaders || {})) {
      xhr.setRequestHeader(name, value);
    }
    xhr.send(file);
  });
}

export default function BackupsPanel() {
  const toast = useToast();

  const [scopes, setScopes] = useState<BackupScopeItem[]>([]);
  const [selectedScope, setSelectedScope] = useState<BackupScope>("CORE_BASE");
  const [loadingScopes, setLoadingScopes] = useState(false);

  const [exportingDirect, setExportingDirect] = useState(false);
  const [exportingOss, setExportingOss] = useState(false);
  const [latestOssExport, setLatestOssExport] =
    useState<BackupExportOssResult | null>(null);

  const [sourceMode, setSourceMode] = useState<SourceMode>("DIRECT");

  const [directDragActive, setDirectDragActive] = useState(false);
  const [directContent, setDirectContent] = useState("");
  const [directFileName, setDirectFileName] = useState("");
  const [directSizeBytes, setDirectSizeBytes] = useState(0);

  const [ossDragActive, setOssDragActive] = useState(false);
  const [ossSelectedFile, setOssSelectedFile] = useState<File | null>(null);
  const [ossUploading, setOssUploading] = useState(false);
  const [ossUploadProgress, setOssUploadProgress] = useState<number | null>(
    null,
  );
  const [uploadedOssSource, setUploadedOssSource] =
    useState<UploadedOssSource | null>(null);

  const [runningDryRun, setRunningDryRun] = useState(false);

  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const dryRunResult = useBackupStore((state) => state.dryRunResult);
  const setDryRunResult = useBackupStore((state) => state.setDryRunResult);
  const clearDryRunResult = useBackupStore((state) => state.clearDryRunResult);

  const selectedScopeInfo = useMemo(
    () => scopes.find((item) => item.scope === selectedScope) || null,
    [scopes, selectedScope],
  );
  const scopeSegmentOptions = useMemo(
    () =>
      scopes.map((item) => ({
        value: item.scope,
        label: item.label,
      })),
    [scopes],
  );
  const sourceModeOptions = useMemo(
    () =>
      [
        {
          value: "DIRECT",
          label: "直连导入",
          description: "用于 <=4MB JSON 文件",
        },
        {
          value: "OSS_UPLOAD",
          label: "OSS 上传导入",
          description: "先上传到 OSS，再从 OSS 读取",
        },
      ] satisfies Array<{
        value: SourceMode;
        label: string;
        description: string;
      }>,
    [],
  );

  const loadScopes = useCallback(async () => {
    setLoadingScopes(true);
    try {
      const apiResponse = await getBackupScopes();
      if (!apiResponse?.success || !apiResponse.data) {
        toast.error(apiResponse?.message || "获取备份分组失败");
        return;
      }

      setScopes(apiResponse.data);
      if (apiResponse.data.length > 0 && apiResponse.data[0]) {
        setSelectedScope(apiResponse.data[0].scope);
      }
    } catch (error) {
      console.error("[BackupsPanel] 加载分组失败:", error);
      toast.error("加载备份分组失败");
    } finally {
      setLoadingScopes(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadScopes();
  }, [loadScopes]);

  const handleScopeChange = useCallback(
    (value: BackupScope) => {
      setSelectedScope(value);
      clearDryRunResult();
    },
    [clearDryRunResult],
  );

  const handleSourceModeChange = useCallback(
    (value: SourceMode) => {
      setSourceMode(value);
      clearDryRunResult();
      if (value === "DIRECT") {
        setOssDragActive(false);
      } else {
        setDirectDragActive(false);
      }
    },
    [clearDryRunResult],
  );

  const handleExportDirect = useCallback(async () => {
    setExportingDirect(true);
    try {
      const result = await runWithAuth(exportBackup, {
        access_token: undefined,
        scope: selectedScope,
        mode: "AUTO",
      });
      const apiResponse = await resolveApiResponse(result);
      if (!apiResponse?.success || !apiResponse.data) {
        toast.error(apiResponse?.message || "导出失败");
        return;
      }

      const data = apiResponse.data;
      if (data.mode === "DIRECT") {
        downloadJson(data.content, data.fileName);
        toast.success("导出成功", `已下载 ${data.fileName}`);
        return;
      }

      if (data.mode === "OSS_REQUIRED") {
        toast.warning(
          "文件超过直连上限",
          `大小 ${formatBytes(data.sizeBytes)}，请改用 OSS 导出`,
        );
        return;
      }

      setLatestOssExport(data);
      toast.success("已导出到 OSS", data.url);
    } catch (error) {
      console.error("[BackupsPanel] 直连导出失败:", error);
      toast.error("导出失败", "请稍后重试");
    } finally {
      setExportingDirect(false);
    }
  }, [selectedScope, toast]);

  const handleExportOss = useCallback(async () => {
    setExportingOss(true);
    try {
      const result = await runWithAuth(exportBackup, {
        access_token: undefined,
        scope: selectedScope,
        mode: "OSS",
      });
      const apiResponse = await resolveApiResponse(result);
      if (!apiResponse?.success || !apiResponse.data) {
        toast.error(apiResponse?.message || "OSS 导出失败");
        return;
      }

      const data = apiResponse.data;
      if (data.mode !== "OSS") {
        toast.warning("导出结果异常", "请重试或改用直连导出");
        return;
      }

      setLatestOssExport(data);
      toast.success("已导出到 OSS", data.url);
    } catch (error) {
      console.error("[BackupsPanel] OSS 导出失败:", error);
      toast.error("OSS 导出失败");
    } finally {
      setExportingOss(false);
    }
  }, [selectedScope, toast]);

  const setSelectedOssFile = useCallback(
    (file: File) => {
      setOssSelectedFile(file);
      setUploadedOssSource(null);
      setOssUploadProgress(null);
      clearDryRunResult();
    },
    [clearDryRunResult],
  );

  const processDirectFile = useCallback(
    async (file: File) => {
      if (file.size > DIRECT_LIMIT_BYTES) {
        setDirectContent("");
        setDirectFileName(file.name);
        setDirectSizeBytes(file.size);
        setSourceMode("OSS_UPLOAD");
        setDirectDragActive(false);
        setSelectedOssFile(file);
        toast.warning(
          "文件超过直连上限",
          `已切换为 OSS 上传模式，请点击“上传到 OSS”（${formatBytes(file.size)}）`,
        );
        return;
      }

      try {
        const content = await file.text();
        setDirectContent(content);
        setDirectFileName(file.name);
        setDirectSizeBytes(file.size);
        setDirectDragActive(false);
        clearDryRunResult();
        toast.success("已加载文件", file.name);
      } catch (error) {
        console.error("[BackupsPanel] 读取文件失败:", error);
        toast.error("读取文件失败");
      }
    },
    [clearDryRunResult, setSelectedOssFile, toast],
  );

  const handleDirectFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      await processDirectFile(file);
    },
    [processDirectFile],
  );

  const handleDirectDrag = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "dragenter" || event.type === "dragover") {
      setDirectDragActive(true);
    } else if (event.type === "dragleave") {
      setDirectDragActive(false);
    }
  }, []);

  const handleDirectDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDirectDragActive(false);
      const file = event.dataTransfer.files?.[0];
      if (!file) return;
      await processDirectFile(file);
    },
    [processDirectFile],
  );

  const handleOssFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setSelectedOssFile(file);
    },
    [setSelectedOssFile],
  );

  const handleOssDrag = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "dragenter" || event.type === "dragover") {
      setOssDragActive(true);
    } else if (event.type === "dragleave") {
      setOssDragActive(false);
    }
  }, []);

  const handleOssDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setOssDragActive(false);
      const file = event.dataTransfer.files?.[0];
      if (!file) return;
      setSelectedOssFile(file);
    },
    [setSelectedOssFile],
  );

  const uploadSelectedFileToOss = useCallback(async () => {
    if (!ossSelectedFile) {
      toast.warning("请先选择备份文件");
      return;
    }

    setOssUploading(true);
    setOssUploadProgress(0);
    try {
      const initResponse = await runWithAuth(initBackupImportUpload, {
        access_token: undefined,
        fileName: ossSelectedFile.name,
        fileSize: ossSelectedFile.size,
        contentType: ossSelectedFile.type || "application/json",
      });
      const initApiResponse = await resolveApiResponse(initResponse);
      if (!initApiResponse?.success || !initApiResponse.data) {
        toast.error(initApiResponse?.message || "初始化 OSS 上传失败");
        return;
      }

      const initResult = initApiResponse.data;
      if (initResult.strategy === "UNSUPPORTED") {
        toast.error(initResult.message);
        return;
      }

      let uploadedUrl = initResult.sourceUrl;
      if (initResult.strategy === "CLIENT_S3") {
        await uploadToSignedS3(
          initResult,
          ossSelectedFile,
          setOssUploadProgress,
        );
      } else if (initResult.strategy === "CLIENT_BLOB") {
        const blobResult = await putBlob(
          initResult.blobPathname,
          ossSelectedFile,
          {
            access: "public",
            token: initResult.blobClientToken,
            contentType: ossSelectedFile.type || "application/octet-stream",
            multipart: true,
            onUploadProgress: ({ loaded, total }) => {
              if (total > 0) {
                setOssUploadProgress(Math.round((loaded / total) * 100));
              }
            },
          },
        );
        uploadedUrl = blobResult.url || initResult.sourceUrl;
      }

      setUploadedOssSource({
        url: uploadedUrl,
        key: initResult.key,
        providerType: initResult.providerType,
        providerName: initResult.providerName,
        storageProviderId: initResult.storageProviderId,
        fileName: ossSelectedFile.name,
        sizeBytes: ossSelectedFile.size,
      });
      setOssUploadProgress(100);
      toast.success("上传成功", "已上传到 OSS，可执行 dry-run");
    } catch (error) {
      console.error("[BackupsPanel] 上传到 OSS 失败:", error);
      toast.error(error instanceof Error ? error.message : "上传失败");
    } finally {
      setOssUploading(false);
    }
  }, [ossSelectedFile, toast]);

  const buildSource = useCallback((): BackupSource | null => {
    if (sourceMode === "DIRECT") {
      if (!directContent.trim()) return null;
      return {
        type: "DIRECT",
        content: directContent,
      };
    }

    if (!uploadedOssSource?.url) return null;
    return {
      type: "OSS_URL",
      url: uploadedOssSource.url,
    };
  }, [directContent, sourceMode, uploadedOssSource]);

  const handleDryRun = useCallback(async (): Promise<boolean> => {
    const source = buildSource();
    if (!source) {
      if (sourceMode === "OSS_UPLOAD") {
        toast.warning("请先上传文件到 OSS");
      } else {
        toast.warning("请先提供备份来源");
      }
      return false;
    }

    if (
      source.type === "DIRECT" &&
      getUtf8Size(source.content) > DIRECT_LIMIT_BYTES
    ) {
      toast.warning("文件超过直连上限", "请改用 OSS 上传导入模式");
      return false;
    }

    setRunningDryRun(true);
    try {
      const result = await runWithAuth(dryRunBackupImport, {
        access_token: undefined,
        source,
        scope: selectedScope,
        mode: "REPLACE",
      });
      const apiResponse = await resolveApiResponse(result);
      if (!apiResponse?.success || !apiResponse.data) {
        toast.error(apiResponse?.message || "预检失败");
        return false;
      }

      setDryRunResult(apiResponse.data, source);
      toast.success(apiResponse.data.ready ? "预检通过" : "预检完成");
      return true;
    } catch (error) {
      console.error("[BackupsPanel] dry-run 失败:", error);
      toast.error("预检失败");
      return false;
    } finally {
      setRunningDryRun(false);
    }
  }, [buildSource, selectedScope, setDryRunResult, sourceMode, toast]);

  return (
    <>
      <GridItem areas={[5, 6]} width={6} height={0.2}>
        <AutoTransition type="scale" className="h-full">
          <button
            type="button"
            onClick={() => setExportDialogOpen(true)}
            disabled={loadingScopes}
            className="h-full w-full flex gap-2 items-center justify-center text-2xl hover:bg-primary hover:text-primary-foreground transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RiDownloadLine size="1.1em" /> 导出备份
          </button>
        </AutoTransition>
      </GridItem>

      <GridItem areas={[7, 8]} width={6} height={0.2}>
        <AutoTransition type="scale" className="h-full">
          <button
            type="button"
            onClick={() => setRestoreDialogOpen(true)}
            disabled={loadingScopes}
            className="h-full w-full flex gap-2 items-center justify-center text-2xl hover:bg-primary hover:text-primary-foreground transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RiUploadLine size="1.1em" /> 导入还原
          </button>
        </AutoTransition>
      </GridItem>

      <GridItem areas={[9, 10, 11, 12]} width={3} height={0.4}>
        <AutoTransition type="scale" className="h-full">
          {loadingScopes ? (
            <div className="h-full" key="loading">
              <LoadingIndicator />
            </div>
          ) : (
            <div className="flex h-full flex-col gap-3 p-10" key="detail">
              <p>
                参考{" "}
                <Link
                  href="https://neutralpress.net/docs/feature/backup"
                  className="text-primary"
                  presets={["hover-underline", "arrow-out"]}
                >
                  https://neutralpress.net/docs/feature/backup
                </Link>{" "}
                来获取详细说明文档。
              </p>
              <p>
                建议按 “核心基础” =&gt; “内容数据” =&gt; “媒体资产” =&gt;
                “访问分析” =&gt; “运维日志” 的顺序进行导入/导出。
              </p>
              <p>
                尽量在相同版本的 NeutralPress
                之间进行备份和还原，不同版本之间可能存在兼容性问题，建议先在测试环境进行验证。
              </p>
              <p>导入前，请先备份当前数据，并审阅预检结果，再执行导入。</p>
            </div>
          )}
        </AutoTransition>
      </GridItem>

      <Dialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        title="导出备份"
        size="lg"
      >
        <AutoResizer>
          <AutoTransition>
            {loadingScopes ? (
              <div key="loading">
                <LoadingIndicator className="py-32" />
              </div>
            ) : (
              <div className="space-y-6 px-6 py-6" key="content">
                <div className="text-sm text-muted-foreground">
                  优先直连导出。若文件超过 {formatBytes(DIRECT_LIMIT_BYTES)}
                  ，则需改用 OSS 导出。
                </div>

                <div>
                  <SegmentedControl
                    value={selectedScope}
                    onChange={handleScopeChange}
                    options={scopeSegmentOptions}
                    columns={5}
                  />
                  <div className="text-sm text-muted-foreground pt-6">
                    <AutoTransition>
                      <span key={selectedScopeInfo?.label}>
                        导出{selectedScopeInfo?.description}
                      </span>
                    </AutoTransition>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    label="直连导出"
                    size="sm"
                    loading={exportingDirect}
                    onClick={() => void handleExportDirect()}
                  />
                  <Button
                    label="导出到 OSS"
                    size="sm"
                    variant="secondary"
                    loading={exportingOss}
                    onClick={() => void handleExportOss()}
                  />
                </div>

                {latestOssExport && (
                  <div className="border border-border p-3 text-sm">
                    <div className="mb-2">最近 OSS 导出：</div>
                    <div className="break-all text-muted-foreground">
                      {latestOssExport.url}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Button
                        label="复制 URL"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void navigator.clipboard.writeText(
                            latestOssExport.url,
                          );
                          toast.success("已复制 OSS URL");
                        }}
                      />
                      <Button
                        label="打开链接"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          window.open(latestOssExport.url, "_blank")
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </AutoTransition>
        </AutoResizer>
      </Dialog>

      <Dialog
        open={restoreDialogOpen}
        onClose={() => setRestoreDialogOpen(false)}
        title="导入还原"
        size="lg"
      >
        <AutoResizer>
          <AutoTransition>
            {loadingScopes ? (
              <div key="loading">
                <LoadingIndicator className="py-32" />
              </div>
            ) : (
              <div className="space-y-6 px-6 py-6" key="content">
                <div className="space-y-6">
                  <SegmentedControl
                    value={selectedScope}
                    onChange={handleScopeChange}
                    options={scopeSegmentOptions}
                    columns={5}
                  />
                  <div className="text-sm text-muted-foreground">
                    <AutoTransition>
                      <span key={selectedScopeInfo?.label}>
                        {selectedScopeInfo?.description}
                      </span>
                    </AutoTransition>
                  </div>
                </div>

                <SegmentedControl
                  value={sourceMode}
                  onChange={handleSourceModeChange}
                  options={sourceModeOptions}
                  columns={2}
                />

                <AutoTransition>
                  {sourceMode === "DIRECT" ? (
                    <div
                      onDragEnter={handleDirectDrag}
                      onDragLeave={handleDirectDrag}
                      onDragOver={handleDirectDrag}
                      onDrop={handleDirectDrop}
                      key="direct"
                      className={`border-2 border-dashed rounded-lg p-6 text-center transition-color ${
                        directDragActive
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <RiUploadLine
                        className="mx-auto mb-3 text-muted-foreground"
                        size="2em"
                      />
                      <div className="mb-2 text-base font-medium">
                        拖拽 JSON 到此处，或点击按钮选择
                      </div>
                      <div className="mb-3 text-sm text-muted-foreground">
                        仅支持不超过 {formatBytes(DIRECT_LIMIT_BYTES)} 的文件
                      </div>
                      <input
                        id="backup-import-direct-file-input"
                        type="file"
                        placeholder="?"
                        accept=".json,application/json"
                        onChange={handleDirectFileChange}
                        className="hidden"
                      />
                      <Button
                        label="选择备份文件"
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          document
                            .getElementById("backup-import-direct-file-input")
                            ?.click()
                        }
                      />
                      <div className="pt-3 text-sm text-muted-foreground">
                        {directFileName
                          ? `${directFileName} (${formatBytes(directSizeBytes)})`
                          : "未选择文件"}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3" key="oss">
                      <div
                        onDragEnter={handleOssDrag}
                        onDragLeave={handleOssDrag}
                        onDragOver={handleOssDrag}
                        onDrop={handleOssDrop}
                        className={`border-2 border-dashed rounded-lg p-6 text-center transition-all ${
                          ossDragActive
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        <RiUploadCloud2Line
                          className="mx-auto mb-3 text-muted-foreground"
                          size="2em"
                        />
                        <div className="mb-2 text-base font-medium">
                          选择备份文件并上传到 OSS
                        </div>
                        <div className="mb-3 text-sm text-muted-foreground">
                          支持不超过 1.00 GB 的文件
                        </div>
                        <input
                          id="backup-import-oss-file-input"
                          placeholder="?"
                          type="file"
                          accept=".json,application/json"
                          onChange={handleOssFileChange}
                          className="hidden"
                        />
                        <Button
                          label="选择备份文件"
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            document
                              .getElementById("backup-import-oss-file-input")
                              ?.click()
                          }
                        />
                        <div className="pt-3 text-sm text-muted-foreground">
                          {ossSelectedFile
                            ? `${ossSelectedFile.name} (${formatBytes(ossSelectedFile.size)})`
                            : "未选择文件"}
                        </div>
                      </div>

                      <AutoResizer>
                        <AutoTransition>
                          {uploadedOssSource && (
                            <span className="text-sm text-success">
                              已上传完成，可执行预检
                            </span>
                          )}
                        </AutoTransition>
                      </AutoResizer>
                    </div>
                  )}
                </AutoTransition>

                <div className="flex flex-wrap justify-end gap-2">
                  <AutoTransition>
                    {sourceMode === "OSS_UPLOAD" && (
                      <Button
                        label={
                          ossUploading
                            ? `上传中${ossUploadProgress !== null ? ` ${ossUploadProgress}%` : "..."}`
                            : "上传到 OSS"
                        }
                        size="sm"
                        loading={ossUploading}
                        disabled={!ossSelectedFile}
                        onClick={() => void uploadSelectedFileToOss()}
                      />
                    )}
                  </AutoTransition>

                  <Button
                    label="执行预检"
                    size="sm"
                    loading={runningDryRun}
                    onClick={async () => {
                      const success = await handleDryRun();
                      if (success) {
                        setRestoreDialogOpen(false);
                      }
                    }}
                  />
                </div>

                {dryRunResult && (
                  <div className="space-y-3 border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        {dryRunResult.scope} ·{" "}
                        {formatBytes(dryRunResult.sizeBytes)}
                      </div>
                      <div
                        className={
                          dryRunResult.ready ? "text-success" : "text-warning"
                        }
                      >
                        {dryRunResult.ready ? "可导入" : "存在风险"}
                      </div>
                    </div>
                    <div className="break-all text-muted-foreground">
                      checksum: {dryRunResult.checksum}
                    </div>
                  </div>
                )}
              </div>
            )}
          </AutoTransition>
        </AutoResizer>
      </Dialog>
    </>
  );
}
