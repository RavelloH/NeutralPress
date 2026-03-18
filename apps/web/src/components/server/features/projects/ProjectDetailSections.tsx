import React from "react";
import {
  RiCalendarLine,
  RiCodeLine,
  RiGitForkLine,
  RiHashtag,
  RiProfileLine,
  RiStarFill,
  RiTimeLine,
  RiUserLine,
} from "@remixicon/react";

import UniversalRenderer from "@/components/server/renderer/UniversalRenderer";
import CMSImage from "@/components/ui/CMSImage";
import Link from "@/components/ui/Link";
import type { PublicProjectDetail } from "@/lib/server/project-public";
import { formatDate, formatDateTime } from "@/lib/shared/date-format";
import type { MediaFileInfo } from "@/lib/shared/image-utils";
import type { ShikiTheme } from "@/lib/shared/mdx-config-shared";

type ProjectDetailVariant = "page" | "modal";

function formatPeriod(
  startedAt: Date | null,
  completedAt: Date | null,
): string | null {
  const start = formatDate(startedAt, "未记录");
  const end = completedAt ? formatDate(completedAt, "未记录") : "至今";

  if (start === "未记录" && end === "至今") {
    return null;
  }

  return `${start} - ${end}`;
}

function formatLinkLabel(link: string, index: number): string {
  try {
    const parsed = new URL(link);
    const path =
      parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
    return `${parsed.hostname}${path}`.slice(0, 48);
  } catch {
    return `LINK ${index + 1}`;
  }
}

function getProjectStatusBadge(status: PublicProjectDetail["status"]): {
  label: string;
  className: string;
} | null {
  if (status === "DEVELOPING") {
    return { label: "DEVELOPING", className: "text-success" };
  }

  if (status === "ARCHIVED") {
    return { label: "ARCHIVED", className: "text-warning" };
  }

  return null;
}

interface ProjectDetailHeaderProps {
  project: PublicProjectDetail;
  variant?: ProjectDetailVariant;
  heroHeightClassName?: string;
}

export function ProjectDetailHeader({
  project,
  variant = "page",
  heroHeightClassName = "h-[42.1em]",
}: ProjectDetailHeaderProps) {
  const cover = project.coverImages[0] ?? null;
  const authorName = project.author.nickname || project.author.username;
  const periodText = formatPeriod(project.startedAt, project.completedAt);
  const containerClassName = variant === "page" ? "" : "mx-auto max-w-6xl";
  const statusBadge = getProjectStatusBadge(project.status);
  const heroRootClassName =
    cover && variant === "page"
      ? `relative overflow-hidden border-b border-border ${heroHeightClassName}`
      : "relative overflow-hidden border-b border-border";
  const heroPaddingClassName = cover
    ? variant === "page"
      ? "h-full px-6 py-10 md:px-10"
      : "px-6 pb-8 pt-[12rem] md:px-12 md:pb-12 md:pt-[16rem]"
    : variant === "page"
      ? "px-6 py-10 md:px-10 md:py-12"
      : "px-6 py-8 md:px-12 md:py-10";
  const heroContentClassName =
    cover && variant === "page" ? "h-full flex flex-col justify-end" : "";
  const titleClassName =
    variant === "page" ? "text-5xl md:text-7xl" : "text-4xl md:text-6xl";

  return (
    <section className="relative">
      {variant === "page" ? (
        <div className="bg-primary px-6 py-10 text-xl text-primary-foreground md:px-10">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1">
              <RiCalendarLine size="1em" />
              <span>
                {formatDateTime(project.publishedAt || project.createdAt)}
              </span>
            </span>
            <span>/</span>
            <span className="flex items-center gap-1">
              <RiUserLine size="1em" />
              <Link
                href={`/user/${project.author.uid}`}
                presets={["hover-underline"]}
              >
                {authorName}
              </Link>
            </span>
            {project.categories.length > 0 ? (
              <>
                <span>/</span>
                <span className="flex items-center gap-1">
                  <RiHashtag size="1em" />
                  <span className="flex flex-wrap items-center gap-1">
                    {project.categories.map((category, index) => (
                      <React.Fragment
                        key={`${category.fullSlug || category.name}-${index}`}
                      >
                        {category.fullSlug ? (
                          <Link
                            href={`/categories/${category.fullSlug}`}
                            presets={["hover-underline"]}
                          >
                            {category.name}
                          </Link>
                        ) : (
                          <span>{category.name}</span>
                        )}
                        {index < project.categories.length - 1 ? (
                          <span className="opacity-70">/</span>
                        ) : null}
                      </React.Fragment>
                    ))}
                  </span>
                </span>
              </>
            ) : null}
            <span>/</span>
            <span className="flex items-center gap-1">
              <RiTimeLine size="1em" />
              <span>{project.content.length}字</span>
            </span>
          </div>
        </div>
      ) : (
        <div className="px-3 py-5 font-medium uppercase tracking-[0.18em] text-primary-foreground bg-primary md:px-12">
          Project File / Public Release
        </div>
      )}

      <div className={heroRootClassName}>
        {cover ? (
          <div className="absolute inset-0 z-0">
            <CMSImage
              src={cover.url}
              alt={project.title}
              fill
              sizes={variant === "page" ? "100vw" : "90vw"}
              className="object-cover"
              optimized={Boolean(cover.width && cover.height)}
              width={cover.width}
              height={cover.height}
              blur={cover.blur}
              priority
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/95 to-transparent" />
          </div>
        ) : (
          <div className="absolute inset-0 z-0 bg-background" />
        )}

        <div className={`relative z-10 ${heroPaddingClassName}`}>
          <div
            className={[containerClassName, heroContentClassName]
              .filter(Boolean)
              .join(" ")}
          >
            <h1 className={`${titleClassName} leading-tight`}>
              <span>{project.title}</span>
            </h1>

            {project.links.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {project.links.map((link, index) => (
                  <Link
                    key={`${project.id}-project-link-${index}`}
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center rounded-sm border border-muted px-2 py-1 text-sm text-foreground transition-colors duration-500 hover:border-primary/50 hover:bg-primary/30 hover:text-primary"
                    presets={["dynamic-icon", "arrow-out"]}
                  >
                    {formatLinkLabel(link, index)}
                  </Link>
                ))}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs uppercase text-foreground md:text-sm">
              <span className="flex items-center gap-1">
                <RiStarFill size="1.2em" className="text-warning" />
                {project.stars}
              </span>
              <span className="flex items-center gap-1">
                <RiGitForkLine size="1.2em" />
                {project.forks}
              </span>
              {project.license ? (
                <span className="flex items-center gap-1">
                  <RiProfileLine size="1.2em" />
                  {project.license}
                </span>
              ) : null}
              {periodText ? (
                <span className="flex items-center gap-1">
                  <RiCalendarLine size="1.2em" />
                  {periodText}
                </span>
              ) : null}
              {statusBadge ? (
                <span className={statusBadge.className}>
                  {statusBadge.label}
                </span>
              ) : null}
              {project.isFeatured ? (
                <span className="text-primary">FEATURED</span>
              ) : null}
            </div>

            {project.languages.length > 0 ? (
              <div className="mt-4 flex items-center gap-1 text-xs text-foreground md:text-sm">
                <RiCodeLine size="1.2em" />
                <span className="w-full">{project.languages.join(" / ")}</span>
              </div>
            ) : null}

            {project.tags.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {project.tags.map((tag) => (
                  <Link
                    key={tag.slug}
                    href={`/tags/${tag.slug}`}
                    className="inline-flex items-center gap-1 rounded-sm border border-muted px-2 py-1 text-xs text-foreground/85 transition-colors duration-500 hover:border-primary/50 hover:bg-primary/20 hover:text-primary"
                  >
                    <RiHashtag size="1em" />
                    {tag.name}
                  </Link>
                ))}
              </div>
            ) : null}

            {project.description ? (
              <p className="mt-4 max-w-4xl text-sm leading-relaxed text-foreground md:text-lg">
                {project.description}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

interface ProjectDetailBodyProps {
  project: PublicProjectDetail;
  mediaFileMap: Map<string, MediaFileInfo>;
  shikiTheme?: ShikiTheme;
  siteURL?: string;
  variant?: ProjectDetailVariant;
}

export function ProjectDetailBody({
  project,
  mediaFileMap,
  shikiTheme,
  siteURL,
  variant = "page",
}: ProjectDetailBodyProps) {
  const footerClassName =
    variant === "page"
      ? "mt-12 border-t border-border pt-8"
      : "mt-10 border-t border-border/80 pt-7";
  const footerMetaRowClassName = "flex flex-wrap items-center gap-x-3 gap-y-2";
  const permalink = siteURL
    ? `${siteURL}/projects/${project.slug}`
    : `/projects/${project.slug}`;

  return (
    <article className="min-w-0">
      {project.content ? (
        <UniversalRenderer
          source={project.content}
          mode="markdown"
          mediaFileMap={mediaFileMap}
          skipFirstH1
          shikiTheme={shikiTheme}
        />
      ) : (
        <div className="max-w-4xl border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
          该项目暂未提供详细文档内容。
        </div>
      )}

      <div className={footerClassName}>
        <div className="space-y-2 text-sm text-muted-foreground">
          <div className={footerMetaRowClassName}>
            <span className="flex items-center gap-1">
              <RiCalendarLine size="1em" />
              发布于 {formatDateTime(project.publishedAt || project.createdAt)}
            </span>
            <span>/</span>
            <span className="flex items-center gap-1">
              <RiTimeLine size="1em" />
              编辑于 {formatDateTime(project.updatedAt)}
            </span>
            <span>/</span>
            <span>{project.title}</span>
          </div>

          <div className={footerMetaRowClassName}>
            <span className="flex items-center gap-1">
              <RiUserLine size="1em" />
              {project.author.nickname
                ? `${project.author.nickname} (@${project.author.username})`
                : `@${project.author.username}`}
            </span>
            <span>/</span>
            <span className="break-all">{permalink}</span>
          </div>
        </div>
      </div>
    </article>
  );
}
