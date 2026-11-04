import { getFeedData } from "@/lib/server/feed-data";

interface JsonFeedItem {
  id: string;
  url: string;
  title: string;
  content_html?: string;
  summary?: string;
  date_published?: string;
  date_modified?: string;
  authors?: { name: string; url?: string }[];
  tags?: string[];
  image?: string;
}

interface JsonFeed {
  version: string;
  title: string;
  home_page_url: string;
  feed_url: string;
  description?: string;
  icon?: string;
  favicon?: string;
  language: string;
  authors: { name: string; url?: string }[];
  items: JsonFeedItem[];
}

export const dynamic = "force-static";
export const revalidate = false;

async function generateJsonFeed(): Promise<JsonFeed | null> {
  const { posts, siteConfig, rssConfig } = await getFeedData();

  if (!rssConfig.enabled) {
    return null;
  }

  const items: JsonFeedItem[] = posts.map((post) => {
    const item: JsonFeedItem = {
      id: `${siteConfig.url}/posts/${post.slug}`,
      url: `${siteConfig.url}/posts/${post.slug}`,
      title: post.title,
      date_published: post.publishedAt
        ? new Date(post.publishedAt).toISOString()
        : undefined,
      date_modified: new Date(post.updatedAt).toISOString(),
      authors: [
        {
          name: post.author.nickname || post.author.username,
          url: siteConfig.url,
        },
      ],
    };

    if (post.content) {
      item.content_html = post.content;
    }

    if (post.excerpt) {
      item.summary = post.excerpt;
    }

    if (post.categories.length > 0) {
      item.tags = post.categories.map((c) => c.name);
    }

    if (post.featuredImage) {
      item.image = `${siteConfig.url}${post.featuredImage}`;
    }

    return item;
  });

  return {
    version: "https://jsonfeed.org/version/1.1",
    title: siteConfig.title,
    home_page_url: siteConfig.url,
    feed_url: `${siteConfig.url}/feed.json`,
    description: siteConfig.description || undefined,
    icon: `${siteConfig.url}/icon/512x`,
    favicon: `${siteConfig.url}/favicon.ico`,
    language: "zh-CN",
    authors: [
      {
        name: siteConfig.author,
        url: siteConfig.url,
      },
    ],
    items,
  };
}

export async function GET() {
  const feed = await generateJsonFeed();

  if (feed === null) {
    return new Response("JSON Feed is disabled", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  return new Response(JSON.stringify(feed, null, 2), {
    headers: {
      "Content-Type": "application/feed+json; charset=utf-8",
    },
  });
}
