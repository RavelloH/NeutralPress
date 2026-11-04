import { Feed } from "feed";

import { getFeedData } from "@/lib/server/feed-data";

export const dynamic = "force-static";
export const revalidate = false;

const FEED_XSL_PATH = "/feed.xsl";
const PREVIEW_MAX_LENGTH = 220;

function stripHtmlToPlainText(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&[a-zA-Z0-9#]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFeedDescription(excerpt: string | null): string | undefined {
  return excerpt?.trim() || undefined;
}

function stripFeedLeadHtml(content: string): string {
  return content.replace(
    /^\s*<p\b[^>]*class=["'][^"']*\bfeed-lead\b[^"']*["'][^>]*>[\s\S]*?<\/p>\s*/i,
    "",
  );
}

function buildContentPreview(content: string): string | undefined {
  const preview = stripHtmlToPlainText(stripFeedLeadHtml(content));
  if (!preview) {
    return undefined;
  }

  if (preview.length <= PREVIEW_MAX_LENGTH) {
    return preview;
  }

  return `${preview.slice(0, PREVIEW_MAX_LENGTH)}...`;
}

function injectFeedStylesheet(xml: string): string {
  const stylesheet = `<?xml-stylesheet type="text/xsl" href="${FEED_XSL_PATH}"?>`;

  if (!xml.startsWith("<?xml")) {
    return `${stylesheet}\n${xml}`;
  }

  const declarationEnd = xml.indexOf("?>");
  if (declarationEnd === -1) {
    return `${stylesheet}\n${xml}`;
  }

  const declaration = xml.slice(0, declarationEnd + 2);
  const body = xml.slice(declarationEnd + 2);
  return `${declaration}\n${stylesheet}\n${body}`;
}

async function generateRssFeed(): Promise<string | null> {
  const { posts, siteConfig, rssConfig } = await getFeedData();

  if (!rssConfig.enabled) {
    return null;
  }

  const feed = new Feed({
    title: siteConfig.title,
    description: siteConfig.description,
    id: siteConfig.url,
    link: siteConfig.url,
    language: "zh-CN",
    image: `${siteConfig.url}/icon/512x`,
    favicon: `${siteConfig.url}/favicon.ico`,
    copyright: `All rights reserved ${new Date().getFullYear()}, ${siteConfig.author}`,
    updated: posts.length > 0 ? new Date(posts[0]!.updatedAt) : new Date(),
    generator: "NeutralPress",
    feedLinks: {
      atom: `${siteConfig.url}/feed.xml`,
      rss: `${siteConfig.url}/feed.xml`,
      json: `${siteConfig.url}/feed.json`,
    },
    author: {
      name: siteConfig.author,
      link: siteConfig.url,
    },
  });

  posts.forEach((post) => {
    const contentPreview = buildContentPreview(post.content);

    feed.addItem({
      title: post.title,
      id: `${siteConfig.url}/posts/${post.slug}`,
      link: `${siteConfig.url}/posts/${post.slug}`,
      description: buildFeedDescription(post.excerpt),
      content: post.content,
      extensions: contentPreview
        ? [{ name: "contentPreview", objects: { _cdata: contentPreview } }]
        : undefined,
      author: [
        {
          name: post.author.nickname || post.author.username,
          link: siteConfig.url,
        },
      ],
      date: post.publishedAt ? new Date(post.publishedAt) : new Date(),
      image: post.featuredImage
        ? `${siteConfig.url}${post.featuredImage}`
        : undefined,
    });
  });

  return injectFeedStylesheet(feed.rss2());
}

export async function GET() {
  const rss = await generateRssFeed();

  if (rss === null) {
    return new Response("RSS feed is disabled", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  return new Response(rss, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
