import * as React from "react";

import {
  EmailAlert,
  EmailHeading,
  EmailLayout,
  EmailParagraph,
} from "@/emails/components";

/**
 * SSO 账户解绑通知邮件模板属性
 */
export interface SSOUnlinkedTemplateProps {
  /** 用户名 */
  username: string;
  /** SSO 提供商（如 GOOGLE, GITHUB, MICROSOFT） */
  provider: string;
  /** 解绑时间 */
  unlinkedAt?: string;
  /** 站点名称 */
  siteName?: string;
  /** 站点URL */
  siteUrl?: string;
  /** Logo URL */
  logoUrl?: string;
  /** 主题色 */
  primaryColor?: string;
}

/**
 * SSO 账户解绑通知邮件模板
 */
export function SSOUnlinkedTemplate({
  username,
  provider,
  unlinkedAt,
  siteName = "NeutralPress",
  siteUrl = "https://example.com",
  logoUrl,
  primaryColor = "#2dd4bf",
}: SSOUnlinkedTemplateProps) {
  const providerNames: Record<string, string> = {
    GOOGLE: "Google",
    GITHUB: "GitHub",
    MICROSOFT: "Microsoft",
  };
  const providerName = providerNames[provider] || provider;
  const preview = `您的 ${siteName} 账户已解绑 ${providerName}`;

  return (
    <EmailLayout
      preview={preview}
      siteName={siteName}
      siteUrl={siteUrl}
      logoUrl={logoUrl}
      primaryColor={primaryColor}
    >
      <EmailHeading level={1}>SSO 账户解绑成功</EmailHeading>

      <EmailParagraph>您好 {username}，</EmailParagraph>

      <EmailParagraph>
        您在 {siteName} 的账户已成功解除与 {providerName} 的绑定。
      </EmailParagraph>

      {unlinkedAt && (
        <EmailParagraph>
          解绑时间：
          {new Date(unlinkedAt).toLocaleString("zh-CN", {
            timeZone: "UTC",
          })}{" "}
          (UTC)
        </EmailParagraph>
      )}

      <EmailParagraph>
        您将无法再使用 {providerName} 账户登录 {siteName}
        。如需继续使用，请重新绑定。
      </EmailParagraph>

      <EmailAlert variant="warning">
        如果您没有进行此操作，您的账户可能已被盗用。请立即登录账户并修改密码，确保账户安全。
      </EmailAlert>

      <EmailParagraph>
        您可以在账户设置中重新绑定第三方登录方式。
      </EmailParagraph>
    </EmailLayout>
  );
}

export default SSOUnlinkedTemplate;
