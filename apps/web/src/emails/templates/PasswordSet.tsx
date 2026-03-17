import * as React from "react";

import {
  EmailAlert,
  EmailHeading,
  EmailLayout,
  EmailParagraph,
} from "@/emails/components";

/**
 * 首次设置密码通知邮件模板属性
 */
export interface PasswordSetTemplateProps {
  /** 用户名 */
  username: string;
  /** 设置时间 */
  setAt?: string;
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
 * 首次设置密码通知邮件模板
 */
export function PasswordSetTemplate({
  username,
  setAt,
  siteName = "NeutralPress",
  siteUrl = "https://example.com",
  logoUrl,
  primaryColor = "#2dd4bf",
}: PasswordSetTemplateProps) {
  const preview = `您在 ${siteName} 的账户已设置登录密码`;

  return (
    <EmailLayout
      preview={preview}
      siteName={siteName}
      siteUrl={siteUrl}
      logoUrl={logoUrl}
      primaryColor={primaryColor}
    >
      <EmailHeading level={1}>账户密码设置成功</EmailHeading>

      <EmailParagraph>您好 {username}，</EmailParagraph>

      <EmailParagraph>
        您在 {siteName} 的账户已成功设置登录密码。
      </EmailParagraph>

      {setAt && (
        <EmailParagraph>
          设置时间：{new Date(setAt).toLocaleString("zh-CN", { timeZone: "UTC" })} (UTC)
        </EmailParagraph>
      )}

      <EmailParagraph>
        现在您可以使用用户名/邮箱和密码的方式登录您的账户。这为您的账户提供了额外的登录选项。
      </EmailParagraph>

      <EmailAlert variant="warning">
        如果您没有进行此操作，您的账户可能已被盗用。请立即联系我们的支持团队。
      </EmailAlert>

      <EmailParagraph>
        为了保护您的账户安全，我们建议您采取以下措施：
      </EmailParagraph>

      <EmailParagraph>
        • 使用强密码，包含大小写字母、数字和特殊字符
        <br />
        • 不要在多个网站使用相同的密码
        <br />
        • 定期更换密码
        <br />• 妥善保管您的密码信息
      </EmailParagraph>
    </EmailLayout>
  );
}

export default PasswordSetTemplate;
