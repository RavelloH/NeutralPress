import { describe, expect, it } from "vitest";

import {
  CONFIG_DEFINITIONS,
  defaultConfigs,
  extractInputAttributes,
  isSensitiveConfigKey,
} from "@/data/default-configs";

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

  it("classifies the token as sensitive without requiring encryption", () => {
    expect(isSensitiveConfigKey("cdn.cloudflare.purgeToken")).toBe(true);
    expect(isSensitiveConfigKey("cdn.cloudflare.zoneId")).toBe(false);
    expect(isSensitiveConfigKey("secret.existingKey")).toBe(true);
    expect(
      extractInputAttributes(CONFIG_DEFINITIONS["cdn.cloudflare.purgeToken"]),
    ).toMatchObject({ type: "password" });
    expect(
      defaultConfigs.find((v) => v.key === "cdn.cloudflare.purgeToken")?.value,
    ).toEqual({ default: "" });
  });
});
