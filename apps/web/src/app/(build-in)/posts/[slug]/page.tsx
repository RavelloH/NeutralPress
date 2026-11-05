import React from "react";
import {
  RiCalendarLine,
  RiEditLine,
  RiEye2Line,
  RiHashtag,
  RiInformationLine,
  RiListView,
  RiText,
  RiUserLine,
} from "@remixicon/react";
import { notFound } from "next/navigation";

import ProtectedPostContentClient from "@/app/(build-in)/posts/[slug]/ProtectedPostContentClient";
import BrowserDateTime from "@/components/client/BrowserDateTime";
import CommentCount from "@/components/client/features/posts/CommentCount";
import CommentsSection from "@/components/client/features/posts/CommentsSection";
import PostToc from "@/components/client/features/posts/PostToc";
import MainLayout from "@/components/client/layout/MainLayout";
import ViewCountBatchLoader from "@/components/client/logic/ViewCountBatchLoader";
import AdjacentPostCard from "@/components/server/features/posts/AdjacentPostCard";
import UniversalRenderer from "@/components/server/renderer/UniversalRenderer";
import JsonLdScript from "@/components/server/seo/JsonLdScript";
import CMSImage from "@/components/ui/CMSImage";
import ImageLightbox from "@/components/ui/ImageLightbox";
import Link from "@/components/ui/Link";
import {
  getCategoryNamePath,
  getCategoryPath,
} from "@/lib/server/category-utils";
import { getConfigs } from "@/lib/server/config-cache";
import { batchQueryMediaFiles } from "@/lib/server/image-query";
import { getFeaturedImageUrl } from "@/lib/server/media-reference";
import {
  getAdjacentPosts,
  getPostShell,
  getPublishedPost,
  getRecommendedPosts,
  renderPostContent,
} from "@/lib/server/post";
import { PUBLIC_POST_ACCESS_MODE } from "@/lib/server/post-access";
import prisma from "@/lib/server/prisma";
import { buildTocFromSource } from "@/lib/server/rich-text-outline";
import {
  generateJsonLdGraph,
  generateMetadata as generateSEOMetadata,
} from "@/lib/server/seo";
import {
  extractInternalHashes,
  processImageUrl,
} from "@/lib/shared/image-utils";
import {
  formatPostLicenseStatementSegments,
  renderPostLicenseIcon,
  resolvePostLicense,
} from "@/lib/shared/post-license";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export const revalidate = false;

const PREBUILD_POST_LIMIT = 12;

// 仅预构建少量热门/最新文章，其余走 ISR
export async function generateStaticParams() {
  const posts = await prisma.post.findMany({
    where: {
      status: {
        in: ["PUBLISHED", "ARCHIVED"],
      },
      accessMode: PUBLIC_POST_ACCESS_MODE,
      deletedAt: null,
    },
    select: {
      slug: true,
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: PREBUILD_POST_LIMIT,
  });

  const params = posts.map((post) => ({
    slug: post.slug,
  }));
  return params.length > 0 ? params : [{ slug: "__neutralpress__" }];
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;

  try {
    const post = await getPostShell(slug);

    return await generateSEOMetadata(
      {
        title: post.title,
        description:
          post.excerpt || post.metaDescription || `阅读文章《${post.title}》`,
        keywords: post.metaKeywords,
        robots:
          post.accessMode === "PUBLIC"
            ? {
                index: post.robotsIndex,
                follow: post.robotsIndex,
              }
            : {
                index: false,
                follow: false,
              },
      },
      {
        pathname: `/posts/${post.slug}`,
        article: {
          publishedTime: post.publishedAt
            ? new Date(post.publishedAt).toISOString()
            : undefined,
          modifiedTime: new Date(post.updatedAt).toISOString(),
        },
      },
    );
  } catch {
    return;
  }
}

export default async function PostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = await getPostShell(slug);

  if (post.accessMode === "PUBLIC") {
    return renderPostPage(slug);
  }

  return renderProtectedPostPage(slug);
}

function generateCategoryLink(slugArray: string[], index: number) {
  const pathUpToIndex = slugArray.slice(0, index + 1).join("/");
  return `/categories/${pathUpToIndex}`;
}

function renderPostSupplementarySections(params: {
  post: {
    title: string;
    author: {
      uid: number;
      username: string;
      nickname: string | null;
    };
  };
  slug: string;
  siteURL: string;
  publishedDisplayDate: string;
  updatedDisplayDate: string;
  effectiveLicense: ReturnType<typeof resolvePostLicense>;
  licenseStatementSegments: ReturnType<
    typeof formatPostLicenseStatementSegments
  >;
  recommendedPosts: Awaited<ReturnType<typeof getRecommendedPosts>>;
  adjacentPosts: Awaited<ReturnType<typeof getAdjacentPosts>>;
  postMediaFileMap: Awaited<ReturnType<typeof batchQueryMediaFiles>>;
  previousFeaturedImage: string | null;
  nextFeaturedImage: string | null;
}) {
  const {
    post,
    slug,
    siteURL,
    publishedDisplayDate,
    updatedDisplayDate,
    effectiveLicense,
    licenseStatementSegments,
    recommendedPosts,
    adjacentPosts,
    postMediaFileMap,
    previousFeaturedImage,
    nextFeaturedImage,
  } = params;

  return (
    <>
      <div className="max-w-7xl mx-auto mt-12 border-t-2 py-8 border-border">
        <div className="text-sm text-muted-foreground space-y-2">
          <div className="flex flex-wrap gap-4 ">
            <span className="flex gap-1 items-center">
              <RiCalendarLine size="1.1em" />
              发布于 <BrowserDateTime value={publishedDisplayDate} />
            </span>
            <span>{"/"}</span>
            <span className="flex gap-1 items-center">
              <RiEditLine size="1.1em" />
              编辑于 <BrowserDateTime value={updatedDisplayDate} />
            </span>
            <span>{"/"}</span>
            <span>{post.title}</span>
          </div>
          <div className="flex flex-wrap gap-4 ">
            <span className="flex gap-1 items-center">
              <RiUserLine size="1.1em" />
              {post.author.nickname
                ? `${post.author.nickname} (@${post.author.username})`
                : `@${post.author.username}`}
            </span>
            <span>{"/"}</span>
            <span>{siteURL + "/posts/" + slug}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1 leading-relaxed">
            <span className="inline-flex items-center gap-1">
              <RiInformationLine size="1.1em" />
              {renderPostLicenseIcon(effectiveLicense)}
            </span>
            <span>
              {licenseStatementSegments.map((segment, index) =>
                segment.href ? (
                  <Link
                    key={`${segment.href}-${index}`}
                    href={segment.href}
                    target="_blank"
                    rel="noreferrer"
                    presets={["hover-color", "arrow-out"]}
                  >
                    {segment.text}
                  </Link>
                ) : (
                  <React.Fragment key={`plain-${index}`}>
                    {segment.text}
                  </React.Fragment>
                ),
              )}
            </span>
          </div>
        </div>
      </div>
      {recommendedPosts.length > 0 && (
        <div className="max-w-7xl mx-auto pt-16">
          <h2 className="text-2xl font-bold mb-6">相关文章</h2>
          <div className="relative border-y border-border">
            <div className="grid grid-cols-1 gap-0">
              {recommendedPosts.map((recommendedPost, index) => {
                const isLast = index === recommendedPosts.length - 1;
                const recommendedCoverImage = recommendedPost.featuredImage
                  ? processImageUrl(
                      recommendedPost.featuredImage,
                      postMediaFileMap,
                    )[0]
                  : null;
                const inlineTagLabels =
                  recommendedPost.tags.length > 0
                    ? recommendedPost.tags.slice(0, 3).map((tag) => tag.name)
                    : recommendedPost.matchedKeywords.slice(0, 3);

                return (
                  <div
                    key={recommendedPost.slug}
                    className={isLast ? "" : "border-b border-border/50"}
                  >
                    <Link
                      href={`/posts/${recommendedPost.slug}`}
                      className="group block h-full w-full bg-background overflow-hidden relative transition-colors duration-300 hover:bg-primary/5"
                    >
                      {recommendedCoverImage && (
                        <>
                          <div className="absolute inset-0 z-0 opacity-30 grayscale transition-all duration-500 ease-out group-hover:opacity-100 group-hover:scale-105 group-hover:grayscale-0 pointer-events-none">
                            <CMSImage
                              src={recommendedCoverImage.url}
                              alt={recommendedPost.title}
                              fill
                              className="object-cover"
                              sizes="(max-width: 768px) 100vw, 900px"
                              optimized={
                                !!(
                                  recommendedCoverImage.width &&
                                  recommendedCoverImage.height
                                )
                              }
                              width={recommendedCoverImage.width}
                              height={recommendedCoverImage.height}
                              blur={recommendedCoverImage.blur}
                              priority={false}
                            />
                          </div>
                          <div className="absolute inset-0 z-0 bg-gradient-to-r from-background via-background/60 to-background pointer-events-none" />
                        </>
                      )}
                      <div className="relative z-10 h-full flex flex-col p-5 md:p-8">
                        <div className="font-mono text-xs tracking-widest text-muted-foreground uppercase group-hover:text-foreground transition-colors">
                          Recommended
                        </div>

                        <div className="pt-4">
                          <h3 className="text-lg md:text-xl font-bold leading-tight tracking-tight text-foreground line-clamp-2 relative inline box-decoration-clone bg-[linear-gradient(currentColor,currentColor)] bg-left-bottom bg-no-repeat bg-[length:0%_2px] transition-[background-size] duration-300 ease-out group-hover:bg-[length:100%_2px]">
                            {recommendedPost.title}
                          </h3>
                        </div>

                        {recommendedPost.excerpt && (
                          <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                            {recommendedPost.excerpt}
                          </p>
                        )}

                        <div className="w-full mt-auto pt-4 font-mono text-xs text-muted-foreground">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 uppercase">
                            {recommendedPost.publishedAt && (
                              <BrowserDateTime
                                value={recommendedPost.publishedAt}
                                precision="date"
                              />
                            )}
                            {recommendedPost.categories.length > 0 && (
                              <span>
                                {recommendedPost.categories
                                  .slice(0, 2)
                                  .map((category) => category.name)
                                  .join(" / ")}
                              </span>
                            )}
                            {inlineTagLabels.map((tagLabel) => (
                              <span
                                key={`${recommendedPost.slug}-${tagLabel}`}
                                className="inline-flex items-center gap-0.5 normal-case"
                              >
                                <RiHashtag size="1em" />
                                {tagLabel}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {(adjacentPosts.previous || adjacentPosts.next) && (
        <div className="max-w-7xl mx-auto pt-16">
          <h2 className="text-2xl font-bold mb-6">继续阅读</h2>
          <div className="relative border-y border-border">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
              {adjacentPosts.previous ? (
                <div className="border-b md:border-b-0 border-border/50 md:border-r md:border-border/0 relative">
                  <AdjacentPostCard
                    title={adjacentPosts.previous.title}
                    slug={adjacentPosts.previous.slug}
                    date={
                      adjacentPosts.previous.publishedAt?.toISOString() || ""
                    }
                    category={adjacentPosts.previous.categories}
                    tags={adjacentPosts.previous.tags}
                    cover={
                      previousFeaturedImage
                        ? processImageUrl(
                            previousFeaturedImage,
                            postMediaFileMap,
                          )
                        : undefined
                    }
                    direction="previous"
                  />
                </div>
              ) : (
                <div className="hidden md:block" />
              )}

              {adjacentPosts.next && (
                <div className="relative">
                  <AdjacentPostCard
                    title={adjacentPosts.next.title}
                    slug={adjacentPosts.next.slug}
                    date={adjacentPosts.next.publishedAt?.toISOString() || ""}
                    category={adjacentPosts.next.categories}
                    tags={adjacentPosts.next.tags}
                    cover={
                      nextFeaturedImage
                        ? processImageUrl(nextFeaturedImage, postMediaFileMap)
                        : undefined
                    }
                    direction="next"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

async function renderProtectedPostPage(slug: string) {
  let post,
    categoryPath,
    categorySlugPath,
    adjacentPosts,
    recommendedPosts,
    postMediaFileMap,
    previousFeaturedImage,
    nextFeaturedImage;
  const [
    commentEnabled,
    placeholder,
    anonymousEnabled,
    anonymousEmailRequired,
    anonymousWebsiteEnabled,
    reviewAll,
    reviewAnonymous,
    locateEnabled,
    siteURL,
    defaultLicense,
    licenseTextTemplate,
  ] = await getConfigs([
    "comment.enable",
    "comment.placeholder",
    "comment.anonymous.enable",
    "comment.anonymous.email.required",
    "comment.anonymous.website.enable",
    "comment.review.enable",
    "comment.anonymous.review.enable",
    "comment.locate.enable",
    "site.url",
    "content.license.default",
    "content.license.textTemplate",
  ]);

  try {
    [post, adjacentPosts] = await Promise.all([
      getPostShell(slug),
      getAdjacentPosts(slug),
    ]);

    if (post.accessMode === "PUBLIC") {
      return renderPostPage(slug);
    }

    recommendedPosts = await getRecommendedPosts(post, {
      limit: 3,
      candidateLimit: 24,
    }).catch(() => []);

    if (post.categories.length > 0) {
      const categoryPaths = await Promise.all(
        post.categories.map((category) => getCategoryNamePath(category.id)),
      );
      const categorySlugPaths = await Promise.all(
        post.categories.map((category) => getCategoryPath(category.id)),
      );
      categoryPath = categoryPaths[0];
      categorySlugPath = categorySlugPaths[0];
    }

    const allImageUrls = new Set<string>();
    if (post.featuredImage) {
      allImageUrls.add(post.featuredImage);
    }

    previousFeaturedImage = getFeaturedImageUrl(
      adjacentPosts.previous?.mediaRefs,
    );
    nextFeaturedImage = getFeaturedImageUrl(adjacentPosts.next?.mediaRefs);

    if (previousFeaturedImage) {
      allImageUrls.add(previousFeaturedImage);
    }
    if (nextFeaturedImage) {
      allImageUrls.add(nextFeaturedImage);
    }

    for (const recommendedPost of recommendedPosts) {
      if (recommendedPost.featuredImage) {
        allImageUrls.add(recommendedPost.featuredImage);
      }
    }

    postMediaFileMap = await batchQueryMediaFiles(Array.from(allImageUrls));
  } catch {
    notFound();
  }

  const effectiveLicense = resolvePostLicense(post.license, defaultLicense);
  const licenseStatementSegments = formatPostLicenseStatementSegments(
    licenseTextTemplate,
    effectiveLicense,
  );
  const publishedDisplayDate = new Date(
    post.publishedAt || post.createdAt,
  ).toISOString();
  const updatedDisplayDate = new Date(post.updatedAt).toISOString();

  const horizontalPaddingClassName = "px-6 md:px-10";
  const featuredHeroHeightClassName = "h-[42.1em]";

  return (
    <MainLayout type="vertical" nopadding>
      <ViewCountBatchLoader />
      <ImageLightbox />
      <div className="h-full w-full">
        <div
          className={`py-10 ${horizontalPaddingClassName} text-xl flex flex-wrap gap-2 bg-primary text-primary-foreground`}
        >
          <span className="flex items-center gap-1">
            <RiCalendarLine size={"1em"} />
            <BrowserDateTime value={publishedDisplayDate} />
          </span>
          <span>/</span>
          <span className="flex items-center gap-1">
            <RiUserLine size={"1em"} />
            <Link
              href={"/user/" + post.author.uid}
              presets={["hover-underline"]}
            >
              {post.author.nickname || post.author.username}
            </Link>
          </span>
          {categoryPath && categoryPath.length > 0 && categorySlugPath && (
            <>
              <span>/</span>
              <span className="flex items-center gap-1">
                <RiListView size={"1em"} />
                {categoryPath.map((categoryName, index) => (
                  <span key={categoryName}>
                    <Link
                      href={generateCategoryLink(categorySlugPath, index)}
                      presets={["hover-underline"]}
                    >
                      {categoryName}
                    </Link>
                    {index < categoryPath.length - 1 && " > "}
                  </span>
                ))}
              </span>
            </>
          )}
          <span>/</span>
          <span className="flex items-center gap-1">
            <RiText size={"1em"} />
            <span>{post.contentLength}字</span>
          </span>
          <>
            <span className="opacity-0 transition-all" data-viewcount-separator>
              /
            </span>
            <span
              className="flex items-center gap-1 opacity-0 transition-all"
              data-viewcount-slug={slug}
            >
              <RiEye2Line size={"1em"} />
              <span>{post.viewCount || "---"}</span>
            </span>
          </>
          <CommentCount initialCount={post._count.comments} />
        </div>

        <div
          className={`relative ${post.featuredImage ? featuredHeroHeightClassName : ""}`}
        >
          {post.featuredImage && (
            <div className="absolute inset-0 z-0">
              {(() => {
                const processedImages = processImageUrl(
                  post.featuredImage,
                  postMediaFileMap,
                );
                const imageData = processedImages[0];
                return imageData ? (
                  <CMSImage
                    src={imageData.url}
                    alt={post.title}
                    fill
                    className="object-cover"
                    sizes="100vw"
                    optimized={!!(imageData.width && imageData.height)}
                    width={imageData.width}
                    height={imageData.height}
                    blur={imageData.blur}
                    priority
                  />
                ) : (
                  <CMSImage
                    src={post.featuredImage}
                    alt={post.title}
                    fill
                    className="object-cover"
                    sizes="100vw"
                    priority
                  />
                );
              })()}
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/90 to-transparent" />
            </div>
          )}

          <div
            className={`relative z-10 ${horizontalPaddingClassName} border-border border-b ${post.featuredImage ? "h-full flex flex-col justify-end py-10" : "py-10 pt-12"}`}
          >
            <h1 className="text-5xl md:text-7xl mb-2">{post.title}</h1>
            <div className="text-xl md:text-2xl font-mono pt-3 text-muted-foreground">
              #{post.slug}
            </div>

            {post.tags.length > 0 && (
              <div className="text-lg pt-3 mt-4 flex flex-wrap gap-2">
                {post.tags.map((tag) => (
                  <Link
                    key={tag.slug}
                    href={"/tags/" + tag.slug}
                    className="bg-muted text-muted-foreground px-3 py-2 rounded-sm inline-flex gap-1 items-center hover:bg-primary/5 hover:text-primary transition-colors duration-500"
                  >
                    <RiHashtag size={"1em"} />
                    {tag.name}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        <ProtectedPostContentClient
          slug={post.slug}
          accessMode={post.accessMode}
          minRole={post.minRole}
          authorUid={post.author.uid}
          excerpt={post.excerpt}
          commentEnabled={commentEnabled}
          commentConfig={{
            placeholder,
            anonymousEnabled,
            anonymousEmailRequired,
            anonymousWebsiteEnabled,
            reviewAll,
            reviewAnonymous,
            locateEnabled,
          }}
        >
          {renderPostSupplementarySections({
            post,
            slug,
            siteURL,
            publishedDisplayDate,
            updatedDisplayDate,
            effectiveLicense,
            licenseStatementSegments,
            recommendedPosts,
            adjacentPosts,
            postMediaFileMap,
            previousFeaturedImage,
            nextFeaturedImage,
          })}
        </ProtectedPostContentClient>
      </div>
    </MainLayout>
  );
}

async function renderPostPage(slug: string) {
  let post,
    renderedContent,
    categoryPath,
    categorySlugPath,
    postMediaFileMap,
    adjacentPosts,
    recommendedPosts,
    previousFeaturedImage,
    nextFeaturedImage;
  const [
    commentEnabled,
    placeholder,
    anonymousEnabled,
    anonymousEmailRequired,
    anonymousWebsiteEnabled,
    reviewAll,
    reviewAnonymous,
    locateEnabled,
    siteURL,
    shikiTheme,
    defaultLicense,
    licenseTextTemplate,
  ] = await getConfigs([
    "comment.enable",
    "comment.placeholder",
    "comment.anonymous.enable",
    "comment.anonymous.email.required",
    "comment.anonymous.website.enable",
    "comment.review.enable",
    "comment.anonymous.review.enable",
    "comment.locate.enable",
    "site.url",
    "site.shiki.theme",
    "content.license.default",
    "content.license.textTemplate",
  ]);

  try {
    // 获取文章数据和相邻文章
    [post, adjacentPosts] = await Promise.all([
      getPublishedPost(slug),
      getAdjacentPosts(slug),
    ]);

    [renderedContent, recommendedPosts] = await Promise.all([
      renderPostContent(post),
      getRecommendedPosts(post, { limit: 3, candidateLimit: 24 }).catch(
        () => [],
      ),
    ]);

    // 获取所有分类的路径
    if (post.categories.length > 0) {
      const categoryPaths = await Promise.all(
        post.categories.map((category) => getCategoryNamePath(category.id)),
      );
      const categorySlugPaths = await Promise.all(
        post.categories.map((category) => getCategoryPath(category.id)),
      );
      categoryPath = categoryPaths[0]; // 使用第一个分类的名称路径
      categorySlugPath = categorySlugPaths[0]; // 使用第一个分类的 slug 路径
    }

    // 查询文章特色图片的媒体文件信息
    postMediaFileMap = new Map();
    const allImageUrls = new Set<string>();

    if (post.featuredImage) {
      allImageUrls.add(post.featuredImage);
    }

    // 添加相邻文章的封面图片
    previousFeaturedImage = getFeaturedImageUrl(
      adjacentPosts.previous?.mediaRefs,
    );
    nextFeaturedImage = getFeaturedImageUrl(adjacentPosts.next?.mediaRefs);

    if (previousFeaturedImage) {
      allImageUrls.add(previousFeaturedImage);
    }
    if (nextFeaturedImage) {
      allImageUrls.add(nextFeaturedImage);
    }

    // 添加推荐文章的封面图片
    for (const recommendedPost of recommendedPosts) {
      if (recommendedPost.featuredImage) {
        allImageUrls.add(recommendedPost.featuredImage);
      }
    }

    // 查询文章内容中的所有图片
    const contentImageHashes = extractInternalHashes(post.content);
    contentImageHashes.forEach((hash) => {
      allImageUrls.add(`/p/${hash.fullHash}`);
    });

    // 批量查询所有图片媒体信息
    postMediaFileMap = await batchQueryMediaFiles(Array.from(allImageUrls));
  } catch {
    // 如果文章不存在或未发布，返回 404
    notFound();
  }

  const effectiveLicense = resolvePostLicense(post.license, defaultLicense);
  const licenseStatementSegments = formatPostLicenseStatementSegments(
    licenseTextTemplate,
    effectiveLicense,
  );
  const publishedDisplayDate = new Date(
    post.publishedAt || post.createdAt,
  ).toISOString();
  const updatedDisplayDate = new Date(post.updatedAt).toISOString();

  const breadcrumb = [
    { name: "首页", item: "/" },
    { name: "文章", item: "/posts" },
    ...(categoryPath && categorySlugPath
      ? categoryPath.map((categoryName, index) => ({
          name: categoryName,
          item: generateCategoryLink(categorySlugPath, index),
        }))
      : []),
    {
      name: post.title,
      item: `/posts/${post.slug}`,
    },
  ];

  const jsonLdGraph = await generateJsonLdGraph({
    kind: "article",
    pathname: `/posts/${post.slug}`,
    title: post.title,
    description:
      post.excerpt || post.metaDescription || `阅读文章《${post.title}》`,
    keywords: post.metaKeywords || post.tags.map((tag) => tag.name),
    robots: {
      index: post.robotsIndex,
    },
    publishedAt: post.publishedAt || post.createdAt,
    updatedAt: post.updatedAt,
    authors: [
      {
        name: post.author.nickname || post.author.username,
        url: `/user/${post.author.uid}`,
        type: "Person",
      },
    ],
    images: post.featuredImage ? [post.featuredImage] : [],
    breadcrumb,
    article: {
      section: post.categories[0]?.name,
      tags: post.tags.map((tag) => tag.name),
    },
  });

  const horizontalPaddingClassName = "px-6 md:px-10";
  const featuredHeroHeightClassName = "h-[42.1em]";
  const articleContentId = "post-detail-article-content";
  const contentSelector = `#${articleContentId}`;
  const tocItems = buildTocFromSource({
    source: post.content,
    mode: post.postMode === "MARKDOWN" ? "markdown" : "mdx",
    skipFirstH1: true,
  });

  return (
    <MainLayout type="vertical" nopadding>
      <JsonLdScript id="jsonld-post" graph={jsonLdGraph} />
      {/* 批量加载访问量 */}
      <ViewCountBatchLoader />

      <ImageLightbox />
      <div className="h-full w-full">
        {/* 文章头部信息 */}
        <div
          className={`py-10 ${horizontalPaddingClassName} text-xl flex flex-wrap gap-2 bg-primary text-primary-foreground`}
        >
          <span className="flex items-center gap-1">
            <RiCalendarLine size={"1em"} />
            <BrowserDateTime value={publishedDisplayDate} />
          </span>
          <span>/</span>
          <span className="flex items-center gap-1">
            <RiUserLine size={"1em"} />
            <Link
              href={"/user/" + post.author.uid}
              presets={["hover-underline"]}
            >
              {post.author.nickname || post.author.username}
            </Link>
          </span>
          {categoryPath && categoryPath.length > 0 && categorySlugPath && (
            <>
              <span>/</span>
              <span className="flex items-center gap-1">
                <RiListView size={"1em"} />
                {categoryPath.map((categoryName, index) => (
                  <span key={categoryName}>
                    <Link
                      href={generateCategoryLink(categorySlugPath, index)}
                      presets={["hover-underline"]}
                    >
                      {categoryName}
                    </Link>
                    {index < categoryPath.length - 1 && " > "}
                  </span>
                ))}
              </span>
            </>
          )}
          <span>/</span>
          <span className="flex items-center gap-1">
            <RiText size={"1em"} />
            <span>{post.content.length}字</span>
          </span>
          <>
            <span className="opacity-0 transition-all" data-viewcount-separator>
              /
            </span>
            <span
              className="flex items-center gap-1 opacity-0 transition-all"
              data-viewcount-slug={slug}
            >
              <RiEye2Line size={"1em"} />
              <span>---</span>
            </span>
          </>
          <CommentCount />
        </div>

        {/* 文章标题和元信息 - 封面图作为背景，内容放在固定高度区域内 */}
        <div
          className={`relative ${post.featuredImage ? featuredHeroHeightClassName : ""}`}
        >
          {post.featuredImage && (
            <div className="absolute inset-0 z-0">
              {(() => {
                const processedImages = processImageUrl(
                  post.featuredImage,
                  postMediaFileMap,
                );
                const imageData = processedImages[0];
                return imageData ? (
                  <CMSImage
                    src={imageData.url}
                    alt={post.title}
                    fill
                    className="object-cover"
                    sizes="100vw"
                    optimized={!!(imageData.width && imageData.height)}
                    width={imageData.width}
                    height={imageData.height}
                    blur={imageData.blur}
                    priority
                  />
                ) : (
                  <CMSImage
                    src={post.featuredImage}
                    alt={post.title}
                    fill
                    className="object-cover"
                    sizes="100vw"
                    priority
                  />
                );
              })()}
              {/* 渐变遮罩，确保文字可读性 */}
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/90 to-transparent" />
            </div>
          )}

          {/* 文章标题和标签内容 */}
          <div
            className={`relative z-10 ${horizontalPaddingClassName} border-border border-b ${post.featuredImage ? "h-full flex flex-col justify-end py-10" : "py-10 pt-12"}`}
          >
            <h1 className="text-5xl md:text-7xl mb-2">{post.title}</h1>
            <div className="text-xl md:text-2xl font-mono pt-3 text-muted-foreground">
              #{post.slug}
            </div>

            {/* 标签 */}
            {post.tags.length > 0 && (
              <div className="text-lg pt-3 mt-4 flex flex-wrap gap-2">
                {post.tags.map((tag) => (
                  <Link
                    key={tag.slug}
                    href={"/tags/" + tag.slug}
                    className="bg-muted text-muted-foreground px-3 py-2 rounded-sm inline-flex gap-1 items-center hover:bg-primary/5 hover:text-primary transition-colors duration-500"
                  >
                    <RiHashtag size={"1em"} />
                    {tag.name}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 文章内容 */}
        <div
          className={`${horizontalPaddingClassName} max-w-7xl mx-auto pt-10 flex gap-6 relative h-full`}
        >
          <div className="flex-[8] h-full min-w-0">
            <div id={articleContentId}>
              {/* 摘要 */}
              {post.excerpt && (
                <div className="pb-12 max-w-4xl mx-auto ">
                  <div className="border-l-[3px] border-primary/60 pl-4 py-1">
                    <p className="leading-loose text-muted-foreground text-sm">
                      {post.excerpt}
                    </p>
                  </div>
                </div>
              )}
              <UniversalRenderer
                source={renderedContent.content}
                mode={renderedContent.mode}
                mediaFileMap={postMediaFileMap}
                skipFirstH1
                shikiTheme={shikiTheme}
              />
            </div>
            {renderPostSupplementarySections({
              post,
              slug,
              siteURL,
              publishedDisplayDate,
              updatedDisplayDate,
              effectiveLicense,
              licenseStatementSegments,
              recommendedPosts,
              adjacentPosts,
              postMediaFileMap,
              previousFeaturedImage,
              nextFeaturedImage,
            })}
            {/* 评论区 */}{" "}
            {commentEnabled && (
              <CommentsSection
                slug={post.slug}
                allowComments={post.allowComments}
                authorUid={post.author.uid}
                commentConfig={{
                  placeholder,
                  anonymousEnabled,
                  anonymousEmailRequired,
                  anonymousWebsiteEnabled,
                  reviewAll,
                  reviewAnonymous,
                  locateEnabled,
                }}
              />
            )}
          </div>
          {/* 侧边栏容器 */}
          <div className="flex-[2] hidden lg:block max-w-screen h-full sticky top-10 self-start">
            {/* 目录（包含视口内容卡片） */}
            <PostToc tocItems={tocItems} contentSelector={contentSelector} />
          </div>

          {/* 移动端目录按钮 */}
          <div className="lg:hidden">
            <PostToc
              tocItems={tocItems}
              isMobile={true}
              contentSelector={contentSelector}
            />
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
