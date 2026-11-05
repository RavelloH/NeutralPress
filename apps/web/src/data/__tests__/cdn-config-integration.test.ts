import { describe, expect, it } from "vitest";

import { CONFIG_DEFINITIONS, defaultConfigs } from "@/data/default-configs";

describe("CDN uses the canonical CONFIG_DEFINITIONS system", () => {
  it("declares all public and private keys in defaultConfigs", () => {
    const list = new Set(defaultConfigs.map((item) => item.key));
    for (const key of [
      "cdn.cloudflare.zoneId",
      "cdn.cloudflare.siteUrl",
      "cdn.cloudflare.purgeToken",
    ]) {
      expect(list.has(key)).toBe(true);
      expect(
        CONFIG_DEFINITIONS[key as keyof typeof CONFIG_DEFINITIONS],
      ).toBeDefined();
    }
  });

  it("treats the token exactly as an ordinary editable string setting", () => {
    const token = CONFIG_DEFINITIONS["cdn.cloudflare.purgeToken"];
    const regularToken = CONFIG_DEFINITIONS["comment.akismet.apiKey"];
    expect(typeof token.default).toBe(typeof regularToken.default);
    expect("meta" in token).toBe(false);
    expect(
      defaultConfigs.find((v) => v.key === "cdn.cloudflare.purgeToken")?.value,
    ).toEqual({ default: "" });
    expect(token.description).not.toContain("明文存入 Config");
  });
});
