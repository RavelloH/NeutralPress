"use client";

import { useEffect, useState } from "react";

import { GridItem } from "@/components/client/layout/RowGrid";
import { useBroadcastSender } from "@/hooks/use-broadcast";
import { AutoTransition } from "@/ui/AutoTransition";

const settings = [
  {
    name: "站点信息",
    key: "site",
  },
  {
    name: "作者信息",
    key: "author",
  },
  {
    name: "SEO配置",
    key: "seo",
  },
  {
    name: "用户策略",
    key: "user",
  },
  {
    name: "内容策略",
    key: "content",
  },
  {
    name: "友链管理",
    key: "friendlink",
  },
  {
    name: "媒体策略",
    key: "media",
  },
  {
    name: "评论策略",
    key: "comment",
  },
  {
    name: "通知策略",
    key: "notice",
  },
  {
    name: "私信策略",
    key: "message",
  },
  {
    name: "AI 集成",
    key: "ai",
  },
  {
    name: "访问统计",
    key: "analytics",
  },
  {
    name: "CDN 加速",
    key: "cdn",
  },
];

export interface SettingSelectMessage {
  type: "setting-select";
  category: string;
}

export default function SettingSelect() {
  const [selectedKey, setSelectedKey] = useState<string>("site"); // 默认选择站点信息
  const { broadcast } = useBroadcastSender<SettingSelectMessage>();

  const handleSelect = (key: string) => {
    setSelectedKey(key);
    broadcast({
      type: "setting-select",
      category: key,
    });
  };

  // 初始加载时自动发送站点信息的广播
  useEffect(() => {
    broadcast({
      type: "setting-select",
      category: "site",
    });
  }, [broadcast]);

  return (
    <GridItem areas={[5, 6, 7, 8, 9, 10, 11, 12]} width={1.5} height={0.5}>
      <AutoTransition type="scale" className="h-full">
        <div className="w-full h-full grid grid-cols-2 text-2xl" key="content">
          {settings.map((setting) => (
            <div
              key={setting.key}
              className={`border-border border flex items-center justify-center hover:bg-accent cursor-pointer transition-all ${
                selectedKey === setting.key
                  ? "bg-primary hover:bg-primary text-primary-foreground"
                  : ""
              }`}
              onClick={() => handleSelect(setting.key)}
            >
              {setting.name}
            </div>
          ))}
        </div>
      </AutoTransition>
    </GridItem>
  );
}
