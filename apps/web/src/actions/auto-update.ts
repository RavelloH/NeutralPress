"use server";

import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  AutoUpdateConfig,
  AutoUpdateMode,
  AutoUpdateOverview,
  GetAutoUpdateOverview,
  GetRuntimeVersionInfo,
  RepoSyncStatus,
  RepoUpdateStatus,
  RuntimeVersionInfo,
  TriggerAutoUpdate,
  TriggerAutoUpdateResult,
  UpdateAutoUpdateConfig,
} from "@repo/shared-types/api/auto-update";
import {
  GetAutoUpdateOverviewSchema,
  GetRuntimeVersionInfoSchema,
  TriggerAutoUpdateSchema,
  UpdateAutoUpdateConfigSchema,
} from "@repo/shared-types/api/auto-update";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import { updateTag } from "next/cache";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { logAuditEvent } from "@/lib/server/audit";
import { authVerify } from "@/lib/server/auth-verify";
import { getConfigs } from "@/lib/server/config-cache";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import { validateData } from "@/lib/server/validator";
import { deriveWatchtowerApiToken } from "@/lib/shared/cache-bootstrap-auth";

import { Prisma } from ".prisma/client";

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

const AUTO_UPDATE_CONFIG_KEYS = [
  "autoupdate.mode",
  "autoupdate.repo.fullName",
  "autoupdate.repo.branch",
  "autoupdate.repo.pat",
  "autoupdate.watchtower.baseUrl",
] as const;

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_UPSTREAM_OWNER = "RavelloH";
const GITHUB_UPSTREAM_REPO = "NeutralPress";
const GITHUB_UPSTREAM_FULL_NAME = `${GITHUB_UPSTREAM_OWNER}/${GITHUB_UPSTREAM_REPO}`;
const DEFAULT_WATCHTOWER_UPDATE_URL = "http://watchtower:8080/v1/update";
const WATCHTOWER_TIMEOUT_MS = 20000;

type GithubCompareResponse = {
  status?: string;
  ahead_by?: number;
  behind_by?: number;
  html_url?: string;
  base_commit?: {
    sha?: string;
  } | null;
  head_commit?: {
    sha?: string;
  } | null;
};

type GithubErrorResponse = {
  message?: string;
};

type GithubContentResponse = {
  content?: string;
  encoding?: string;
};

type GithubReleaseResponse = {
  tag_name?: string;
  name?: string;
};

type GithubReleaseListItem = {
  tag_name?: string;
  name?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  created_at?: string | null;
};

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

function normalizeVersionLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^v/i, "");
  return normalized.length > 0 ? normalized : null;
}

function normalizeAutoUpdateMode(value: unknown): AutoUpdateMode {
  return value === "CONTAINER" ? "CONTAINER" : "REPOSITORY";
}

function normalizeRepoFullName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRepoBranch(value: unknown): string {
  const branch = typeof value === "string" ? value.trim() : "";
  return branch || "main";
}

function normalizeRepoPat(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeWatchtowerBaseUrl(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return DEFAULT_WATCHTOWER_UPDATE_URL;

  try {
    const parsed = new URL(raw);
    if (parsed.pathname === "/" || parsed.pathname.trim().length === 0) {
      parsed.pathname = "/v1/update";
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_WATCHTOWER_UPDATE_URL;
  }
}

function parseRepoFullName(
  fullName: string,
): { owner: string; repo: string } | null {
  const match = /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/.exec(fullName.trim());
  if (!match) return null;
  return {
    owner: match[1]!,
    repo: match[2]!,
  };
}

function createGithubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "NeutralPress-CMS",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (typeof token === "string" && token.trim().length > 0) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  return headers;
}

async function requestGithubJson<T>(
  url: string,
  init: RequestInit,
): Promise<
  | {
      ok: true;
      status: number;
      data: T;
    }
  | {
      ok: false;
      status: number;
      message: string;
    }
> {
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as
      | GithubErrorResponse
      | T
      | null;

    if (!response.ok) {
      const message =
        (payload as GithubErrorResponse | null)?.message ||
        `GitHub API 请求失败（HTTP ${response.status}）`;
      return {
        ok: false,
        status: response.status,
        message,
      };
    }

    return {
      ok: true,
      status: response.status,
      data: payload as T,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: toErrorMessage(error, "GitHub API 请求失败"),
    };
  }
}

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

function parseVersion(value: string | null | undefined): ParsedVersion | null {
  if (!value) return null;

  const trimmed = value.trim().replace(/^v/i, "");
  const match =
    /^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      trimmed,
    );
  if (!match) return null;

  const major = Number.parseInt(match[1] || "0", 10);
  const minor = Number.parseInt(match[2] || "0", 10);
  const patch = Number.parseInt(match[3] || "0", 10);
  const prereleaseRaw = (match[4] || "").trim();
  const prerelease = prereleaseRaw
    ? prereleaseRaw.split(".").filter((part) => part.length > 0)
    : [];

  if (
    !Number.isFinite(major) ||
    !Number.isFinite(minor) ||
    !Number.isFinite(patch)
  ) {
    return null;
  }

  return {
    major,
    minor,
    patch,
    prerelease,
  };
}

function compareVersionPart(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);

  if (leftNumeric && rightNumeric) {
    return Number.parseInt(left, 10) - Number.parseInt(right, 10);
  }
  if (leftNumeric && !rightNumeric) return -1;
  if (!leftNumeric && rightNumeric) return 1;
  return left.localeCompare(right);
}

function compareParsedVersion(
  left: ParsedVersion,
  right: ParsedVersion,
): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;

  const leftPre = left.prerelease;
  const rightPre = right.prerelease;

  if (leftPre.length === 0 && rightPre.length === 0) return 0;
  if (leftPre.length === 0) return 1;
  if (rightPre.length === 0) return -1;

  const maxLength = Math.max(leftPre.length, rightPre.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftPre[index];
    const rightPart = rightPre[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;

    const compared = compareVersionPart(leftPart, rightPart);
    if (compared !== 0) return compared;
  }

  return 0;
}

function toConfigJsonValue(value: unknown): Prisma.InputJsonValue {
  if (value === null) {
    return Prisma.JsonNull as unknown as Prisma.InputJsonValue;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toConfigJsonValue(item));
  }

  if (typeof value === "object") {
    const result: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = toConfigJsonValue(item);
    }
    return result;
  }

  return String(value);
}

function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 6) return "*".repeat(token.length);
  return `${token.slice(0, 3)}***${token.slice(-3)}`;
}

function sanitizeConfigForAudit(config: AutoUpdateConfig): AutoUpdateConfig {
  return {
    ...config,
    repo: {
      ...config.repo,
      pat: maskToken(config.repo.pat),
    },
  };
}

async function readPackageVersion(): Promise<string | null> {
  const candidates = [
    path.resolve(process.cwd(), "apps/web/package.json"),
    path.resolve(process.cwd(), "package.json"),
    path.resolve(process.cwd(), "../package.json"),
    path.resolve(process.cwd(), "../../package.json"),
  ];

  for (const packageJsonPath of candidates) {
    try {
      const raw = await fs.readFile(packageJsonPath, "utf8");
      const parsed = JSON.parse(raw) as { version?: unknown };
      const version =
        typeof parsed.version === "string" ? parsed.version.trim() : "";
      if (version.length > 0) return version;
    } catch {
      // ignore
    }
  }
  return null;
}

function resolveGitCommitHash(): string | null {
  try {
    const full = execSync("git rev-parse HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    return full || null;
  } catch {
    return null;
  }
}

function resolveBuildId(commit: string | null): string | null {
  return (
    process.env.VERCEL_BUILD_ID ||
    process.env.GITHUB_RUN_ID ||
    process.env.BUILD_ID ||
    (commit ? commit.slice(0, 12) : null)
  );
}

async function loadRuntimeVersionInfo(): Promise<RuntimeVersionInfo> {
  const appVersion = await readPackageVersion();
  const commit =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.COMMIT_SHA ||
    resolveGitCommitHash();

  return {
    appVersion,
    commit: commit || null,
    buildId: resolveBuildId(commit),
    builtAt:
      process.env.BUILD_TIME || process.env.VERCEL_GIT_COMMIT_TIMESTAMP || null,
    collectedAt: new Date().toISOString(),
  };
}

async function loadAutoUpdateConfig(): Promise<AutoUpdateConfig> {
  const [modeRaw, repoFullNameRaw, repoBranchRaw, repoPatRaw, watchtowerRaw] =
    await getConfigs([...AUTO_UPDATE_CONFIG_KEYS]);

  const updatedRecords = await prisma.config.findMany({
    where: {
      key: {
        in: [...AUTO_UPDATE_CONFIG_KEYS],
      },
    },
    select: {
      updatedAt: true,
    },
  });

  const updatedAt =
    updatedRecords.length > 0
      ? updatedRecords
          .reduce(
            (latest, current) =>
              current.updatedAt.getTime() > latest.getTime()
                ? current.updatedAt
                : latest,
            updatedRecords[0]!.updatedAt,
          )
          .toISOString()
      : new Date().toISOString();

  return {
    mode: normalizeAutoUpdateMode(modeRaw),
    repo: {
      fullName: normalizeRepoFullName(repoFullNameRaw),
      branch: normalizeRepoBranch(repoBranchRaw),
      pat: normalizeRepoPat(repoPatRaw),
    },
    container: {
      watchtowerBaseUrl: normalizeWatchtowerBaseUrl(watchtowerRaw),
    },
    updatedAt,
  };
}

async function fetchGithubPackageVersion(
  owner: string,
  repo: string,
  branch: string,
  headersInit: Record<string, string>,
): Promise<string | null> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/apps/web/package.json?ref=${encodeURIComponent(
    branch,
  )}`;
  const response = await requestGithubJson<GithubContentResponse>(url, {
    method: "GET",
    headers: headersInit,
  });
  if (!response.ok) {
    return null;
  }

  const content = response.data.content;
  const encoding = response.data.encoding;
  if (typeof content !== "string" || encoding !== "base64") {
    return null;
  }

  try {
    const decoded = Buffer.from(content.replace(/\n/g, ""), "base64").toString(
      "utf8",
    );
    const parsed = JSON.parse(decoded) as { version?: unknown };
    return normalizeVersionLabel(parsed.version);
  } catch {
    return null;
  }
}

async function fetchGithubLatestReleaseVersion(
  owner: string,
  repo: string,
  headersInit: Record<string, string>,
): Promise<string | null> {
  const listUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases?per_page=30&page=1`;
  const listResponse = await requestGithubJson<GithubReleaseListItem[]>(
    listUrl,
    {
      method: "GET",
      headers: headersInit,
    },
  );
  if (listResponse.ok && Array.isArray(listResponse.data)) {
    const releases = [...listResponse.data].sort((left, right) => {
      const leftSource = left.published_at ?? left.created_at ?? "";
      const rightSource = right.published_at ?? right.created_at ?? "";
      const leftTs = new Date(leftSource).getTime();
      const rightTs = new Date(rightSource).getTime();
      const normalizedLeft = Number.isFinite(leftTs) ? leftTs : 0;
      const normalizedRight = Number.isFinite(rightTs) ? rightTs : 0;
      return normalizedRight - normalizedLeft;
    });

    const stableRelease =
      releases.find((item) => !item.draft && !item.prerelease) ?? releases[0];
    const version =
      normalizeVersionLabel(stableRelease?.tag_name) ||
      normalizeVersionLabel(stableRelease?.name);
    if (version) {
      return version;
    }
  }

  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/latest`;
  const response = await requestGithubJson<GithubReleaseResponse>(url, {
    method: "GET",
    headers: headersInit,
  });
  if (!response.ok) {
    return null;
  }

  return (
    normalizeVersionLabel(response.data.tag_name) ||
    normalizeVersionLabel(response.data.name)
  );
}

function mapGithubCompareStatus(value: string | undefined): RepoSyncStatus {
  if (value === "behind") return "BEHIND";
  if (value === "ahead") return "AHEAD";
  if (value === "diverged") return "DIVERGED";
  if (value === "identical") return "IDENTICAL";
  return "UNKNOWN";
}

async function resolveRepoUpdateStatus(
  config: AutoUpdateConfig,
  runtime: RuntimeVersionInfo,
): Promise<RepoUpdateStatus> {
  const repoFullName = config.repo.fullName;
  const branch = config.repo.branch;
  const token = config.repo.pat;
  const latestReleaseVersion = await fetchGithubLatestReleaseVersion(
    GITHUB_UPSTREAM_OWNER,
    GITHUB_UPSTREAM_REPO,
    createGithubHeaders(),
  );

  if (!repoFullName || !branch || !token) {
    return {
      available: false,
      status: "MISSING_CONFIG",
      message: "仓库更新模式缺少仓库名、分支或 PAT",
      currentVersion: runtime.appVersion,
      targetVersion: latestReleaseVersion,
      localSha: null,
      upstreamSha: null,
      aheadBy: null,
      behindBy: null,
      compareUrl: null,
    };
  }

  const parsedRepo = parseRepoFullName(repoFullName);
  if (!parsedRepo) {
    return {
      available: false,
      status: "ERROR",
      message: "仓库名格式错误，应为 owner/repo",
      currentVersion: runtime.appVersion,
      targetVersion: latestReleaseVersion,
      localSha: null,
      upstreamSha: null,
      aheadBy: null,
      behindBy: null,
      compareUrl: null,
    };
  }

  const headersInit = createGithubHeaders(token);
  const compareRef = `${branch}...${GITHUB_UPSTREAM_OWNER}:${branch}`;
  const compareUrl = `${GITHUB_API_BASE}/repos/${parsedRepo.owner}/${parsedRepo.repo}/compare/${encodeURIComponent(
    compareRef,
  )}`;
  const compareResponse = await requestGithubJson<GithubCompareResponse>(
    compareUrl,
    {
      method: "GET",
      headers: headersInit,
    },
  );

  const branchTargetVersion = await fetchGithubPackageVersion(
    GITHUB_UPSTREAM_OWNER,
    GITHUB_UPSTREAM_REPO,
    branch,
    headersInit,
  );
  const targetVersion = latestReleaseVersion || branchTargetVersion;

  if (!compareResponse.ok) {
    return {
      available: false,
      status: "ERROR",
      message: compareResponse.message,
      currentVersion: runtime.appVersion,
      targetVersion,
      localSha: null,
      upstreamSha: null,
      aheadBy: null,
      behindBy: null,
      compareUrl: null,
    };
  }

  const mappedStatus = mapGithubCompareStatus(compareResponse.data.status);
  const aheadBy = Number.isFinite(compareResponse.data.ahead_by)
    ? Math.max(0, Number(compareResponse.data.ahead_by))
    : null;
  const behindBy = Number.isFinite(compareResponse.data.behind_by)
    ? Math.max(0, Number(compareResponse.data.behind_by))
    : null;
  const localSha = compareResponse.data.base_commit?.sha?.trim() || null;
  const upstreamSha = compareResponse.data.head_commit?.sha?.trim() || null;

  let available = mappedStatus === "BEHIND" && (behindBy ?? 0) > 0;
  let status: RepoSyncStatus = mappedStatus;
  let message: string | null = null;

  if (mappedStatus === "IDENTICAL") {
    message = "目标仓库分支已与上游一致";
  } else if (mappedStatus === "AHEAD") {
    message = "目标仓库分支领先上游，禁止回退";
  } else if (mappedStatus === "DIVERGED") {
    message = "目标仓库分支与上游已分叉，请先手动处理冲突";
  } else if (mappedStatus === "UNKNOWN") {
    message = "无法判断目标仓库分支是否可更新";
  } else if (mappedStatus === "BEHIND") {
    message = "检测到可更新提交";
  }

  const compareTargetVersion = branchTargetVersion || targetVersion;
  if (runtime.appVersion && compareTargetVersion) {
    const currentParsed = parseVersion(runtime.appVersion);
    const targetParsed = parseVersion(compareTargetVersion);
    if (currentParsed && targetParsed) {
      const compared = compareParsedVersion(targetParsed, currentParsed);
      if (compared <= 0) {
        available = false;
        status = "BLOCKED_VERSION";
        message =
          compared === 0
            ? "当前已是最新版本，无需更新"
            : `当前版本高于上游 ${compareTargetVersion}，禁止回退`;
      }
    }
  }

  return {
    available,
    status,
    message,
    currentVersion: runtime.appVersion,
    targetVersion,
    localSha,
    upstreamSha,
    aheadBy,
    behindBy,
    compareUrl: compareResponse.data.html_url || null,
  };
}

function resolveWatchtowerToken(): string | null {
  const masterSecret = process.env.MASTER_SECRET?.trim();
  if (!masterSecret) {
    return null;
  }

  try {
    return deriveWatchtowerApiToken(masterSecret);
  } catch {
    return null;
  }
}

async function triggerContainerUpdateInternal(
  watchtowerBaseUrl: string,
): Promise<{ ok: boolean; message: string }> {
  const token = resolveWatchtowerToken();
  if (!token) {
    return {
      ok: false,
      message: "MASTER_SECRET 不可用，无法派生 Watchtower API Token",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WATCHTOWER_TIMEOUT_MS);

  try {
    const response = await fetch(watchtowerBaseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: "{}",
      cache: "no-store",
      signal: controller.signal,
    });

    const text = (await response.text().catch(() => "")).trim();
    if (!response.ok) {
      return {
        ok: false,
        message: text || `Watchtower API 请求失败（HTTP ${response.status}）`,
      };
    }

    return {
      ok: true,
      message: text || "容器更新请求已提交",
    };
  } catch (error) {
    return {
      ok: false,
      message: toErrorMessage(error, "调用 Watchtower API 失败"),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function triggerRepositoryUpdateInternal(
  config: AutoUpdateConfig,
  status: RepoUpdateStatus,
): Promise<{ ok: boolean; message: string }> {
  if (!status.available) {
    return {
      ok: false,
      message: status.message || "当前无可更新版本",
    };
  }

  const parsedRepo = parseRepoFullName(config.repo.fullName);
  if (!parsedRepo) {
    return {
      ok: false,
      message: "仓库名格式错误，应为 owner/repo",
    };
  }

  const headersInit = {
    ...createGithubHeaders(config.repo.pat),
    "content-type": "application/json",
  };
  const url = `${GITHUB_API_BASE}/repos/${parsedRepo.owner}/${parsedRepo.repo}/merge-upstream`;
  const response = await requestGithubJson<GithubErrorResponse>(url, {
    method: "POST",
    headers: headersInit,
    body: JSON.stringify({
      branch: config.repo.branch,
    }),
  });

  if (!response.ok) {
    return {
      ok: false,
      message: response.message,
    };
  }

  return {
    ok: true,
    message: "仓库同步请求已提交",
  };
}

export async function getAutoUpdateOverview(
  params: GetAutoUpdateOverview,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<AutoUpdateOverview | null>>>;
export async function getAutoUpdateOverview(
  params: GetAutoUpdateOverview,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<AutoUpdateOverview | null>>;
export async function getAutoUpdateOverview(
  { access_token }: GetAutoUpdateOverview,
  serverConfig?: ActionConfig,
): Promise<ActionResult<AutoUpdateOverview | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getAutoUpdateOverview"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
    },
    GetAutoUpdateOverviewSchema,
  );
  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });
  if (!user) {
    return response.unauthorized();
  }

  try {
    const [config, runtime] = await Promise.all([
      loadAutoUpdateConfig(),
      loadRuntimeVersionInfo(),
    ]);

    const repoStatus = await resolveRepoUpdateStatus(config, runtime);

    return response.ok({
      data: {
        config,
        runtime,
        repoStatus,
      },
    });
  } catch (error) {
    console.error("Get auto update overview error:", error);
    return response.serverError();
  }
}

export async function updateAutoUpdateConfig(
  params: UpdateAutoUpdateConfig,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<AutoUpdateConfig | null>>>;
export async function updateAutoUpdateConfig(
  params: UpdateAutoUpdateConfig,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<AutoUpdateConfig | null>>;
export async function updateAutoUpdateConfig(
  {
    access_token,
    mode,
    repoFullName,
    repoBranch,
    repoPat,
    watchtowerBaseUrl,
  }: UpdateAutoUpdateConfig,
  serverConfig?: ActionConfig,
): Promise<ActionResult<AutoUpdateConfig | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "updateAutoUpdateConfig"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      mode,
      repoFullName,
      repoBranch,
      repoPat,
      watchtowerBaseUrl,
    },
    UpdateAutoUpdateConfigSchema,
  );
  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });
  if (!user) {
    return response.unauthorized();
  }

  try {
    const beforeConfig = await loadAutoUpdateConfig();

    const updates: Array<{ key: string; value: unknown }> = [];
    if (mode !== undefined) {
      updates.push({
        key: "autoupdate.mode",
        value: mode,
      });
    }
    if (repoFullName !== undefined) {
      updates.push({
        key: "autoupdate.repo.fullName",
        value: repoFullName.trim(),
      });
    }
    if (repoBranch !== undefined) {
      updates.push({
        key: "autoupdate.repo.branch",
        value: repoBranch.trim() || "main",
      });
    }
    if (repoPat !== undefined) {
      updates.push({
        key: "autoupdate.repo.pat",
        value: repoPat.trim(),
      });
    }
    if (watchtowerBaseUrl !== undefined) {
      updates.push({
        key: "autoupdate.watchtower.baseUrl",
        value: normalizeWatchtowerBaseUrl(watchtowerBaseUrl),
      });
    }

    if (updates.length === 0) {
      return response.badRequest({
        message: "必须提供至少一个配置项",
      });
    }

    await prisma.$transaction(async (tx) => {
      for (const item of updates) {
        await tx.config.upsert({
          where: {
            key: item.key,
          },
          update: {
            value: {
              default: toConfigJsonValue(item.value),
            },
          },
          create: {
            key: item.key,
            value: {
              default: toConfigJsonValue(item.value),
            },
          },
        });
      }
    });

    updateTag("config");
    for (const item of updates) {
      updateTag(`config/${item.key}`);
    }

    const data = await loadAutoUpdateConfig();
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: {
          uid: String(user.uid),
        },
        details: {
          action: "UPDATE",
          resourceType: "AUTO_UPDATE_CONFIG",
          resourceId: "global",
          value: {
            old: sanitizeConfigForAudit(beforeConfig),
            new: sanitizeConfigForAudit(data),
          },
          description: "管理员更新自动更新配置",
        },
      });
    });

    return response.ok({
      message: "自动更新配置已保存",
      data,
    });
  } catch (error) {
    console.error("Update auto update config error:", error);
    return response.serverError();
  }
}

export async function triggerAutoUpdate(
  params: TriggerAutoUpdate,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<TriggerAutoUpdateResult | null>>>;
export async function triggerAutoUpdate(
  params: TriggerAutoUpdate,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<TriggerAutoUpdateResult | null>>;
export async function triggerAutoUpdate(
  { access_token, mode }: TriggerAutoUpdate,
  serverConfig?: ActionConfig,
): Promise<ActionResult<TriggerAutoUpdateResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "triggerAutoUpdate"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      mode,
    },
    TriggerAutoUpdateSchema,
  );
  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });
  if (!user) {
    return response.unauthorized();
  }

  try {
    const [config, runtimeBefore] = await Promise.all([
      loadAutoUpdateConfig(),
      loadRuntimeVersionInfo(),
    ]);

    const effectiveMode = mode ?? config.mode;
    const startedAt = new Date().toISOString();

    if (effectiveMode === "REPOSITORY") {
      const repoStatusBefore = await resolveRepoUpdateStatus(
        config,
        runtimeBefore,
      );
      const repoTriggerResult = await triggerRepositoryUpdateInternal(
        config,
        repoStatusBefore,
      );

      if (!repoTriggerResult.ok) {
        return response.conflict({
          message: repoTriggerResult.message,
        });
      }

      const data: TriggerAutoUpdateResult = {
        mode: "REPOSITORY",
        accepted: true,
        startedAt,
        message: repoTriggerResult.message,
        runtimeBefore,
        repoStatusBefore,
      };

      const { after } = await import("next/server");
      after(async () => {
        await logAuditEvent({
          user: {
            uid: String(user.uid),
          },
          details: {
            action: "SYNC",
            resourceType: "AUTO_UPDATE",
            resourceId: config.repo.fullName || GITHUB_UPSTREAM_FULL_NAME,
            value: {
              old: repoStatusBefore,
              new: data,
            },
            description: "管理员触发仓库更新",
          },
        });
      });

      return response.ok({
        message: "仓库更新请求已提交",
        data,
      });
    }

    const watchtowerBaseUrl = normalizeWatchtowerBaseUrl(
      config.container.watchtowerBaseUrl,
    );
    const containerTriggerResult =
      await triggerContainerUpdateInternal(watchtowerBaseUrl);

    if (!containerTriggerResult.ok) {
      return response.badGateway({
        message: containerTriggerResult.message,
      });
    }

    const data: TriggerAutoUpdateResult = {
      mode: "CONTAINER",
      accepted: true,
      startedAt,
      message: containerTriggerResult.message,
      runtimeBefore,
      repoStatusBefore: null,
    };

    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: {
          uid: String(user.uid),
        },
        details: {
          action: "SYNC",
          resourceType: "AUTO_UPDATE",
          resourceId: watchtowerBaseUrl,
          value: {
            old: null,
            new: data,
          },
          description: "管理员触发容器更新",
        },
      });
    });

    return response.ok({
      message: "容器更新请求已提交",
      data,
    });
  } catch (error) {
    console.error("Trigger auto update error:", error);
    return response.serverError();
  }
}

export async function getRuntimeVersionInfo(
  params: GetRuntimeVersionInfo,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<RuntimeVersionInfo | null>>>;
export async function getRuntimeVersionInfo(
  params: GetRuntimeVersionInfo,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<RuntimeVersionInfo | null>>;
export async function getRuntimeVersionInfo(
  { access_token }: GetRuntimeVersionInfo,
  serverConfig?: ActionConfig,
): Promise<ActionResult<RuntimeVersionInfo | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getRuntimeVersionInfo"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
    },
    GetRuntimeVersionInfoSchema,
  );
  if (validationError) return response.badRequest(validationError);

  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });
  if (!user) {
    return response.unauthorized();
  }

  try {
    const data = await loadRuntimeVersionInfo();
    return response.ok({ data });
  } catch (error) {
    console.error("Get runtime version info error:", error);
    return response.serverError();
  }
}
