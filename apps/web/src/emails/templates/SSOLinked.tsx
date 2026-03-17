import * as React from "react";

import {
  EmailAlert,
  EmailHeading,
  EmailLayout,
  EmailParagraph,
} from "@/emails/components";

/**
 * SSO 账户绑定通知邮件模板属性
 */
export interface SSOLinkedTemplateProps {
  /** 用户名 */
  username: string;
  /** SSO 提供商（如 GOOGLE, GITHUB, MICROSOFT） */
  provider: string;
  /** 绑定时间 */
  linkedAt?: string;
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
 * SSO 账户绑定通知邮件模板
 */
export function SSOLinkedTemplate({
  username,
  provider,
  linkedAt,
  siteName = "NeutralPress",
  siteUrl = "https://example.com",
  logoUrl,
  primaryColor = "#2dd4bf",
}: SSOLinkedTemplateProps) {
  const providerNames: Record<string, string> = {
    GOOGLE: "Google",
    GITHUB: "GitHub",
    MICROSOFT: "Microsoft",
  };
  const providerName = providerNames[provider] || provider;
  const preview = `您的 ${siteName} 账户已绑定 ${providerName}`;

  return (
    <EmailLayout
      preview={preview}
      siteName={siteName}
      siteUrl={siteUrl}
      logoUrl={logoUrl}
      primaryColor={primaryColor}
    >
      <EmailHeading level={1}>SSO 账户绑定成功</EmailHeading>

      <EmailParagraph>您好 {username}，</EmailParagraph>

      <EmailParagraph>
        您在 {siteName} 的账户已成功绑定 {providerName} 登录方式。
      </EmailParagraph>

      {linkedAt && (
        <EmailParagraph>
          绑定时间：
          {new Date(linkedAt).toLocaleString("zh-CN", { timeZone: "UTC" })}{" "}
          (UTC)
        </EmailParagraph>
      )}

      <EmailParagraph>
        现在您可以使用 {providerName} 账户快速登录 {siteName}。
      </EmailParagraph>

      <EmailAlert variant="warning">
        如果您没有进行此操作，您的账户可能已被盗用。请立即访问账户设置页面解除绑定，并修改您的密码。
      </EmailAlert>

      <EmailParagraph>
        您可以随时在账户设置中管理已绑定的第三方登录方式。
      </EmailParagraph>
    </EmailLayout>
  );
}

export default SSOLinkedTemplate;
