import type { Metadata } from "next";

import PostToc from "@/components/client/features/posts/PostToc";
import MainLayout from "@/components/client/layout/MainLayout";
import {
  ProjectDetailBody,
  ProjectDetailHeader,
} from "@/components/server/features/projects/ProjectDetailSections";
import JsonLdScript from "@/components/server/seo/JsonLdScript";
import ImageLightbox from "@/components/ui/ImageLightbox";
import { getConfigs } from "@/lib/server/config-cache";
import {
  getPublishedProjectDetail,
  getPublishedProjectSeo,
  getPublishedProjectStaticParams,
} from "@/lib/server/project-public";
import {
  generateJsonLdGraph,
  generateMetadata as generateSEOMetadata,
} from "@/lib/server/seo";

interface ProjectDetailPageProps {
  params: Promise<{ slug: string }>;
}

export const revalidate = false;

const PREBUILD_PROJECT_LIMIT = 8;

export async function generateStaticParams() {
  const params = await getPublishedProjectStaticParams(PREBUILD_PROJECT_LIMIT);
  return params.length > 0 ? params : [{ slug: "__neutralpress__" }];
}

export async function generateMetadata({
  params,
}: ProjectDetailPageProps): Promise<Metadata> {
  const { slug } = await params;

  const project = await getPublishedProjectSeo(slug);

  if (!project) {
    return generateSEOMetadata({
      title: "项目不存在",
      robots: {
        index: false,
        follow: false,
      },
    });
  }

  return generateSEOMetadata(
    {
      title: project.title,
      description:
        project.metaDescription ||
        project.description ||
        `查看项目 ${project.title} 的详细介绍`,
      keywords: project.metaKeywords || undefined,
      robots: {
        index: project.robotsIndex,
      },
    },
    {
      pathname: `/projects/${project.slug}`,
    },
  );
}

export default async function ProjectDetailPage({
  params,
}: ProjectDetailPageProps) {
  const { slug } = await params;
  return renderProjectDetailPage(slug);
}

async function renderProjectDetailPage(slug: string) {
  const [{ project, mediaFileMap }, [siteURL, shikiTheme]] = await Promise.all([
    getPublishedProjectDetail(slug),
    getConfigs(["site.url", "site.shiki.theme"]),
  ]);

  const contentRootId = "project-detail-article-content";
  const contentSelector = `#${contentRootId}`;
  const featuredHeroHeightClassName = "h-[42.1em]";
  const description =
    project.metaDescription ||
    project.description ||
    `查看项目 ${project.title} 的详细介绍`;
  const keywords = project.metaKeywords || project.tags.map((tag) => tag.name);
  const firstCategory = project.categories[0];
  const breadcrumb = [
    { name: "首页", item: "/" },
    { name: "项目", item: "/projects" },
    ...(firstCategory
      ? [
          {
            name: firstCategory.name,
            item: `/categories/${firstCategory.fullSlug}`,
          },
        ]
      : []),
    {
      name: project.title,
      item: `/projects/${project.slug}`,
    },
  ];
  const jsonLdGraph = await generateJsonLdGraph({
    kind: "project",
    pathname: `/projects/${project.slug}`,
    title: project.title,
    description,
    keywords,
    robots: {
      index: project.robotsIndex,
    },
    publishedAt: project.publishedAt,
    updatedAt: project.updatedAt,
    authors: [
      {
        name: project.author.nickname || project.author.username,
        type: "Person",
        url: `/user/${project.author.uid}`,
      },
    ],
    images: project.coverImages.map((image) => ({
      url: image.url,
      width: image.width,
      height: image.height,
      alt: project.title,
    })),
    breadcrumb,
    project: {
      links: project.links,
      categories: project.categories.map((category) => category.name),
      techStack: [...project.techStack, ...project.tags.map((tag) => tag.name)],
    },
  });

  return (
    <MainLayout type="vertical" nopadding>
      <JsonLdScript id="jsonld-project" graph={jsonLdGraph} />
      <ImageLightbox />
      <div className="h-full w-full">
        <ProjectDetailHeader
          project={project}
          variant="page"
          heroHeightClassName={featuredHeroHeightClassName}
        />

        <div className="px-6 md:px-10 max-w-7xl mx-auto pt-10 pb-12 flex gap-6 relative h-full">
          <div className="min-w-0 flex-[8]">
            <ProjectDetailBody
              project={project}
              mediaFileMap={mediaFileMap}
              shikiTheme={shikiTheme}
              siteURL={siteURL}
              variant="page"
              contentRootId={contentRootId}
            />
          </div>

          <div className="sticky top-10 hidden h-full max-w-screen self-start lg:block lg:flex-[2]">
            <PostToc
              tocItems={project.tocItems}
              contentSelector={contentSelector}
            />
          </div>

          <div className="lg:hidden">
            <PostToc
              tocItems={project.tocItems}
              isMobile={true}
              contentSelector={contentSelector}
            />
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
