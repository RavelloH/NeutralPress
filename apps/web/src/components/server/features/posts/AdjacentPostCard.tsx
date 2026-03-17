import { RiArrowLeftLine, RiArrowRightLine, RiHashtag } from "@remixicon/react";

import CMSImage from "@/components/ui/CMSImage";
import Link from "@/components/ui/Link";
import { formatDateWithDots } from "@/lib/shared/date-format";

interface AdjacentPostCardProps {
  title: string;
  slug: string;
  date?: string;
  category?: { name: string; slug: string }[];
  tags?: { name: string; slug: string }[];
  cover?:
    | Array<{
        url: string;
        width?: number;
        height?: number;
        blur?: string;
      }>
    | string;
  direction: "previous" | "next";
}

export default function AdjacentPostCard({
  title,
  slug,
  date,
  category,
  tags,
  cover,
  direction,
}: AdjacentPostCardProps) {
  // 处理封面图片数据
  const coverImage = Array.isArray(cover)
    ? cover[0]
    : cover
      ? { url: cover }
      : null;

  const isNext = direction === "next";

  return (
    <Link
      href={"/posts/" + slug}
      className={`group block h-full w-full bg-background overflow-hidden relative transition-colors duration-300`}
    >
      {/* 背景图片层 - 作为纹理处理 */}
      {coverImage && (
        <>
          <div className="absolute inset-0 z-0 opacity-[0.05] grayscale transition-all duration-500 ease-out group-hover:opacity-20 group-hover:scale-105 group-hover:grayscale-0 pointer-events-none">
            <CMSImage
              src={coverImage.url}
              alt={title}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 50vw"
              optimized={!!(coverImage.width && coverImage.height)}
              width={coverImage.width}
              height={coverImage.height}
              blur={coverImage.blur}
              priority={false}
            />
          </div>
          {/* 边缘渐变遮罩 - 仅桌面端显示，用于制造中间的柔和过渡 */}
          <div
            className={`hidden md:block absolute inset-y-0 w-1/3 z-0 pointer-events-none ${
              isNext ? "left-0 bg-gradient-to-r" : "right-0 bg-gradient-to-l"
            } from-background to-transparent`}
          />
        </>
      )}

      {/* 内容结构 - Swiss Layout */}
      <div
        className={`relative z-10 h-full flex flex-col p-5 md:p-8 ${
          isNext ? "items-end text-right" : "items-start text-left"
        }`}
      >
        {/* 顶部：方向指示 */}
        <div
          className={`w-full flex items-center mb-auto ${isNext ? "justify-end" : "justify-start"}`}
        >
          <div className="flex items-center gap-2 font-mono text-xs tracking-widest text-muted-foreground uppercase group-hover:text-foreground transition-colors">
            {!isNext && <RiArrowLeftLine size={"1.1em"} />}
            <span>{isNext ? "Next" : "Previous"}</span>
            {isNext && <RiArrowRightLine size={"1.1em"} />}
          </div>
        </div>

        {/* 中部：标题 (增加垂直间距替代分隔线) */}
        <div className="py-4">
          <h3 className="text-lg md:text-xl font-bold leading-tight tracking-tight text-foreground line-clamp-2 relative inline box-decoration-clone bg-[linear-gradient(currentColor,currentColor)] bg-left-bottom bg-no-repeat bg-[length:0%_2px] transition-[background-size] duration-300 ease-out group-hover:bg-[length:100%_2px]  ">
            {title}
          </h3>
        </div>

        {/* 底部：标签与元信息 (互换位置，移除分隔线) */}
        <div
          className={`w-full flex flex-col gap-2 mt-auto font-mono text-xs text-muted-foreground ${
            isNext ? "items-end" : "items-start"
          }`}
        >
          {/* 标签 (现在在上方) */}
          {tags && tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.slice(0, 2).map((tag) => (
                <span
                  key={tag.slug}
                  className="inline-flex items-center px-1 py-0.5 rounded-xs gap-0.5"
                >
                  <RiHashtag size="1em" />
                  {tag.name}
                </span>
              ))}
            </div>
          )}

          {/* 日期与分类 (现在在最下方) */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 uppercase">
            {date && <span>{formatDateWithDots(date)}</span>}
            {category && category.length > 0 && (
              <span>{category.map((cat) => cat.name).join(" / ")}</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
