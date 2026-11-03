import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { PostEditorWrapper } from "@/components/client/features/editor/PostEditorWrapper";
import AdminSidebar from "@/components/client/layout/AdminSidebar";
import HorizontalScroll from "@/components/client/layout/HorizontalScroll";
import MainLayout from "@/components/client/layout/MainLayout";
import { generateMetadata as generateSeoMetadata } from "@/lib/server/seo";
import { getPostDetail } from "@/lib/server/services/post-domain";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata(props: Props) {
  const params = await props.params;
  const { slug } = params;

  return generateSeoMetadata(
    {
      title: `管理面板/文章管理/编辑文章/${slug}`,
      description: `编辑文章：${slug}`,
    },
    {
      pathname: `/admin/posts/${slug}`,
    },
  );
}

export default async function EditPostPage(props: Props) {
  const params = await props.params;
  const { slug } = params;

  // 获取 access_token
  const cookieStore = await cookies();
  const access_token = cookieStore.get("access_token")?.value;

  // 获取文章详情
  const response = await getPostDetail({ access_token, slug });

  if (!response.success || !response.data) {
    notFound();
  }

  const post = response.data;

  return (
    <MainLayout type="horizontal">
      <HorizontalScroll
        className="h-full"
        enableParallax={true}
        enableFadeElements={true}
        enableLineReveal={true}
        snapToElements={false}
      >
        <AdminSidebar />
        <div className="w-full overflow-y-auto">
          <PostEditorWrapper
            content={post.content}
            storageKey={slug}
            isEditMode={true}
            initialData={{
              title: post.title,
              slug: post.slug,
              excerpt: post.excerpt || "",
              status: post.status,
              isPinned: post.isPinned,
              allowComments: post.allowComments,
              accessMode: post.accessMode,
              minRole: post.minRole,
              accessPasswords: post.accessPasswords,
              robotsIndex: post.robotsIndex,
              metaDescription: post.metaDescription || "",
              metaKeywords: post.metaKeywords || "",
              featuredImage: post.featuredImage || "",
              license: post.license,
              categories: post.categories,
              tags: post.tags,
              postMode: post.postMode,
            }}
          />
        </div>
      </HorizontalScroll>
    </MainLayout>
  );
}
