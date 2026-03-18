import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { RiBookLine } from "@remixicon/react";

import AutoUpdateDialogButton from "@/app/(admin)/admin/version/AutoUpdateDialogButton";
import ContributorsBouncer from "@/app/(admin)/admin/version/ContributorsBouncer";
import ScrollGradientMask from "@/app/(admin)/admin/version/ScrollGradientMask";
import AdminSidebar from "@/components/client/layout/AdminSidebar";
import HorizontalScroll from "@/components/client/layout/HorizontalScroll";
import MainLayout from "@/components/client/layout/MainLayout";
import type { GridArea } from "@/components/client/layout/RowGrid";
import RowGrid, { GridItem } from "@/components/client/layout/RowGrid";
import MarkdownServerRenderer from "@/components/server/renderer/MarkdownServerRenderer";
import Link from "@/components/ui/Link";
import {
  fetchGithubContributors,
  type GithubContributor,
} from "@/lib/server/github-contributors";
import {
  fetchGithubReleases,
  type GithubRelease,
} from "@/lib/server/github-releases";
import { generateMetadata } from "@/lib/server/seo";
import { AutoTransition } from "@/ui/AutoTransition";

const REPO_OWNER = "RavelloH";
const REPO_NAME = "NeutralPress";
const REPO_RELEASES_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;
const FULL_AREAS: GridArea[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/i;

export const metadata = await generateMetadata(
  {
    title: "管理面板/版本信息",
    description: "查看 NeutralPress 的当前版本与完整发布历史",
  },
  {
    pathname: "/admin/version",
  },
);

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getReleaseDate(
  release: Pick<GithubRelease, "publishedAt" | "createdAt">,
): string {
  return release.publishedAt ?? release.createdAt;
}

function getReleaseStatusLabel(
  release: Pick<GithubRelease, "draft" | "prerelease">,
): string {
  if (release.draft) return "草稿";
  if (release.prerelease) return "预发布";
  return "正式版";
}

function getReleaseStatusClass(
  release: Pick<GithubRelease, "draft" | "prerelease">,
): string {
  if (release.draft) return "text-warning";
  if (release.prerelease) return "text-primary";
  return "text-success";
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "获取 GitHub Releases 失败";
}

function normalizeVersion(value: string | null | undefined): string {
  if (!value) return "";
  return value.trim().replace(/^v/i, "").toLowerCase();
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

    const partCompare = compareVersionPart(leftPart, rightPart);
    if (partCompare !== 0) return partCompare;
  }

  return 0;
}

function parseReleaseVersion(release: GithubRelease): ParsedVersion | null {
  return parseVersion(release.tagName) ?? parseVersion(release.name);
}

function normalizeCommitHash(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || !COMMIT_HASH_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

function isCommitHashMatch(
  releaseCommitish: string | null | undefined,
  currentHash: string | null | undefined,
): boolean {
  const releaseHash = normalizeCommitHash(releaseCommitish);
  const runtimeHash = normalizeCommitHash(currentHash);
  if (!releaseHash || !runtimeHash) {
    return false;
  }

  return (
    releaseHash === runtimeHash ||
    releaseHash.startsWith(runtimeHash) ||
    runtimeHash.startsWith(releaseHash)
  );
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

function resolveCurrentCommitHash(): string | null {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.COMMIT_SHA ||
    resolveGitCommitHash()
  );
}

function formatCommitHash(hash: string | null): string {
  if (!hash) return "-";
  const trimmed = hash.trim();
  if (!trimmed) return "-";
  return trimmed;
}

function shortCommitHash(hash: string | null): string {
  const full = formatCommitHash(hash);
  if (full === "-") return "-";
  return full.length > 12 ? full.slice(0, 12) : full;
}

async function readCurrentPackageVersion(): Promise<string | null> {
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
      if (version.length > 0) {
        return version;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

async function loadVersionData(): Promise<{
  packageVersion: string | null;
  currentCommitHash: string | null;
  releases: GithubRelease[];
  contributors: GithubContributor[];
  errorMessage: string | null;
  contributorsErrorMessage: string | null;
  fetchedAt: string;
}> {
  const packageVersion = await readCurrentPackageVersion();
  const currentCommitHash = resolveCurrentCommitHash();
  const [releasesResult, contributorsResult] = await Promise.allSettled([
    fetchGithubReleases(REPO_OWNER, REPO_NAME),
    fetchGithubContributors(REPO_OWNER, REPO_NAME, {
      limit: 30,
    }),
  ]);

  const releases =
    releasesResult.status === "fulfilled" ? releasesResult.value : [];
  const contributors =
    contributorsResult.status === "fulfilled" ? contributorsResult.value : [];

  if (releasesResult.status === "rejected") {
    console.error("[admin/version] 获取 releases 失败:", releasesResult.reason);
  }
  if (contributorsResult.status === "rejected") {
    console.error(
      "[admin/version] 获取 contributors 失败:",
      contributorsResult.reason,
    );
  }

  return {
    packageVersion,
    currentCommitHash,
    releases,
    contributors,
    errorMessage:
      releasesResult.status === "rejected"
        ? toErrorMessage(releasesResult.reason)
        : null,
    contributorsErrorMessage:
      contributorsResult.status === "rejected"
        ? toErrorMessage(contributorsResult.reason)
        : null,
    fetchedAt: new Date().toISOString(),
  };
}

export default async function AdminVersionPage() {
  const {
    packageVersion,
    currentCommitHash,
    releases,
    contributors,
    errorMessage,
    contributorsErrorMessage,
  } = await loadVersionData();

  const normalizedPackageVersion = normalizeVersion(packageVersion);
  const localParsedVersion = parseVersion(packageVersion);
  const versionMatchedRelease =
    releases.find((item) => {
      return (
        normalizeVersion(item.tagName) === normalizedPackageVersion ||
        normalizeVersion(item.name) === normalizedPackageVersion
      );
    }) ?? null;
  const currentRelease =
    releases.find((item) => {
      const versionMatched =
        normalizeVersion(item.tagName) === normalizedPackageVersion ||
        normalizeVersion(item.name) === normalizedPackageVersion;
      if (!versionMatched) return false;
      return isCommitHashMatch(item.targetCommitish, currentCommitHash);
    }) ?? null;

  const latestRelease = releases[0] ?? null;
  const latestStableRelease =
    releases.find((item) => !item.draft && !item.prerelease) ?? latestRelease;
  const latestStableParsedVersion = latestStableRelease
    ? parseReleaseVersion(latestStableRelease)
    : null;
  const hashMatchedInReleases = Boolean(currentRelease);
  const isFormalBuild = hashMatchedInReleases;
  const isDevBuild = !isFormalBuild;
  const buildStatusLabel = isFormalBuild ? "正式版" : "开发版本";
  const buildStatusClass = isFormalBuild
    ? "text-success"
    : "text-muted-foreground";

  const hasUpdate =
    localParsedVersion && latestStableParsedVersion
      ? compareParsedVersion(latestStableParsedVersion, localParsedVersion) > 0
      : Boolean(
          latestStableRelease &&
            currentRelease &&
            currentRelease.id !== latestStableRelease.id,
        );
  const displayCurrentRelease = currentRelease ?? versionMatchedRelease;
  const displayCurrentReleaseId = displayCurrentRelease?.id ?? null;
  const currentReleaseIndex =
    displayCurrentReleaseId === null
      ? -1
      : releases.findIndex((item) => item.id === displayCurrentReleaseId);

  return (
    <MainLayout type="horizontal">
      <HorizontalScroll
        className="h-full"
        enableParallax
        enableFadeElements
        enableLineReveal
        snapToElements={false}
      >
        <AdminSidebar />
        <RowGrid>
          <GridItem areas={[1, 2, 3, 4]} width={3} height={0.8}>
            <AutoTransition type="scale" className="h-full">
              <div className="flex h-full flex-col justify-between p-10">
                <div className="py-2 text-2xl">版本信息</div>
                <div className="space-y-1">
                  <div className="flex flex-col">
                    <div className="flex gap-2 items-center">
                      <span>
                        当前版本：
                        <span className="font-mono">
                          {packageVersion ? `v${packageVersion}` : "-"}
                        </span>
                      </span>
                      <span className="font-mono">
                        #{shortCommitHash(currentCommitHash)}
                      </span>
                      <span className={buildStatusClass}>
                        {buildStatusLabel}
                      </span>
                    </div>
                    <div className="flex gap-2 items-center">
                      <span>
                        最新版本：
                        <span className="font-mono">
                          {latestStableRelease
                            ? latestStableRelease.tagName
                            : "-"}
                        </span>
                      </span>
                      <span className="font-mono">
                        #
                        {shortCommitHash(
                          latestStableRelease?.targetCommitish || null,
                        )}
                      </span>
                      <span>
                        {versionMatchedRelease &&
                          formatDateTime(getReleaseDate(versionMatchedRelease))}
                      </span>
                    </div>
                  </div>
                  {versionMatchedRelease ? (
                    <div className="space-y-1">
                      {isDevBuild ? (
                        <div className="text-muted-foreground">
                          当前正在使用开发版本。
                        </div>
                      ) : null}
                    </div>
                  ) : packageVersion ? (
                    <div className="mt-2 text-warning">
                      未在 GitHub Releases 中找到与 &quot;{packageVersion}&quot;
                      对应的版本。
                    </div>
                  ) : (
                    <div className="mt-2 text-warning">
                      无法读取 package.json 版本信息。
                    </div>
                  )}
                  {hasUpdate && latestStableRelease ? (
                    <div className="mt-2 text-success">
                      {isFormalBuild &&
                        `检测到新版本：当前 ${currentRelease?.tagName || "-"}，最新正式版为 ${latestStableRelease.tagName}。`}
                    </div>
                  ) : null}
                </div>
                <div className="text-sm text-muted-foreground">
                  数据来源：GitHub Releases
                  {" · "}
                  <Link
                    href={REPO_RELEASES_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary"
                    presets={["hover-underline"]}
                  >
                    {REPO_OWNER}/{REPO_NAME}
                  </Link>
                </div>
              </div>
            </AutoTransition>
          </GridItem>
          <GridItem areas={[5, 6]} width={6} height={0.2}>
            <AutoTransition type="scale" className="h-full">
              <Link
                href="https://neutralpress.net/docs"
                className="h-full flex gap-2 items-center justify-center text-2xl hover:bg-primary hover:text-primary-foreground transition-all"
              >
                <RiBookLine size="1.1em" /> 查看更新指南
              </Link>
            </AutoTransition>
          </GridItem>
          <GridItem areas={[7, 8]} width={6} height={0.2}>
            <AutoTransition type="scale" className="h-full">
              <AutoUpdateDialogButton />
            </AutoTransition>
          </GridItem>

          <GridItem areas={[9, 10, 11, 12]} width={3} height={0.8}>
            <AutoTransition type="scale" className="h-full">
              <div className="relative h-full">
                <div className="absolute inset-0">
                  <ContributorsBouncer
                    contributors={contributors}
                    errorMessage={contributorsErrorMessage}
                  />
                </div>
                <div className="pointer-events-none relative z-10 flex h-full flex-col justify-between p-10">
                  <div className="py-2 text-2xl">贡献者</div>
                </div>
              </div>
            </AutoTransition>
          </GridItem>
        </RowGrid>

        <RowGrid>
          {releases.length === 0 ? (
            <GridItem areas={FULL_AREAS} width={2.2} height={1.5}>
              <AutoTransition type="scale" className="h-full">
                <div className="flex h-full items-center justify-center text-warning p-8">
                  {errorMessage || "未获取到任何发布记录"}
                </div>
              </AutoTransition>
            </GridItem>
          ) : (
            releases.map((release, index, array) => {
              const releaseNote = release.body?.trim() || "暂无更新说明";
              const isCurrentVersionCard =
                displayCurrentReleaseId !== null &&
                release.id === displayCurrentReleaseId;
              const releaseParsedVersion = parseReleaseVersion(release);
              const isNewVersionCard =
                !isCurrentVersionCard &&
                hasUpdate &&
                !release.draft &&
                (localParsedVersion && releaseParsedVersion
                  ? compareParsedVersion(
                      releaseParsedVersion,
                      localParsedVersion,
                    ) > 0
                  : currentReleaseIndex >= 0
                    ? index < currentReleaseIndex
                    : false);

              return (
                <GridItem
                  key={release.id}
                  areas={FULL_AREAS}
                  width={1.15}
                  height={1.5}
                  className="bg-background"
                >
                  <AutoTransition type="scale" className="h-full">
                    <article
                      className={`flex h-full flex-col p-8 ${
                        isCurrentVersionCard
                          ? "bg-primary/5 border border-primary"
                          : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-mono text-3xl font-bold flex gap-2">
                            {release.tagName}
                            <span className="text-sm text-muted-foreground font-normal">
                              #{array.length - index}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isCurrentVersionCard ? (
                            <span className="text-xs px-2 py-0.5 border border-primary text-primary">
                              当前版本
                            </span>
                          ) : null}
                          {isNewVersionCard ? (
                            <span className="text-xs px-2 py-0.5 border border-success text-success">
                              新版本
                            </span>
                          ) : null}
                          <span className={`${getReleaseStatusClass(release)}`}>
                            {getReleaseStatusLabel(release)}
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 min-h-0 flex-1">
                        <ScrollGradientMask>
                          <div className="space-y-1 text-sm border-b border-border pb-4 mb-4">
                            <div>
                              发布时间：
                              {formatDateTime(getReleaseDate(release))}
                            </div>
                            <div>发布者：{release.authorLogin || "-"}</div>
                            <div>
                              提交哈希：
                              <span className="font-mono">
                                {shortCommitHash(release.targetCommitish)}
                              </span>
                            </div>
                          </div>
                          <MarkdownServerRenderer
                            source={releaseNote}
                            className="md-content mini-md-content max-w-none text-sm"
                          />
                        </ScrollGradientMask>
                      </div>

                      <div className="mt-4 flex items-center justify-between gap-2 text-sm">
                        <Link
                          href={release.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary"
                          presets={["hover-underline"]}
                        >
                          查看 Release
                        </Link>
                      </div>
                    </article>
                  </AutoTransition>
                </GridItem>
              );
            })
          )}
        </RowGrid>
      </HorizontalScroll>
    </MainLayout>
  );
}
