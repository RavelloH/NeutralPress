"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RiGithubFill,
  RiGoogleFill,
  RiMicrosoftFill,
  RiShieldKeyholeLine,
} from "@remixicon/react";
import { useRouter, useSearchParams } from "next/navigation";

import { verifyPasswordForReauth, verifyTotpForReauth } from "@/actions/reauth";
import PasskeyReauthButton from "@/app/(account)/reauth/PasskeyReauthButton";
import UnauthorizedPage from "@/app/unauthorized";
import { CaptchaButton } from "@/components/ui/CaptchaButton";
import { useBroadcast, useBroadcastSender } from "@/hooks/use-broadcast";
import { getCurrentUserForReauth } from "@/lib/client/api/admin-infra-read";
import type { OAuthProvider } from "@/lib/server/oauth";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import { Input } from "@/ui/Input";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { OtpInput } from "@/ui/OtpInput";
import { useToast } from "@/ui/Toast";

interface ReauthClientProps {
  passkeyEnabled: boolean;
}

export default function ReauthClient({ passkeyEnabled }: ReauthClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { broadcast } = useBroadcastSender<{ type: string }>();

  const [user, setUser] = useState<{
    uid: number;
    username: string;
    email: string;
    hasPassword: boolean;
    linkedProviders: string[];
    hasTotpEnabled: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [ssoRedirecting, setSsoRedirecting] = useState(false);

  // TOTP 相关状态
  const [requiresTotp, setRequiresTotp] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [totpError, setTotpError] = useState(false);
  const [totpVerifying, setTotpVerifying] = useState(false);
  const [totpMessage, setTotpMessage] = useState("");
  const [timeRemaining, setTimeRemaining] = useState(300); // 5 minutes in seconds
  const totpTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 标志：是否正在进行 SSO 验证
  const isSSORedirectingRef = useRef(false);
  // BroadcastChannel 用于通知父窗口
  const [channel] = useState(() => {
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      return new BroadcastChannel("reauth-channel");
    }
    return null;
  });

  // 统一的消息发送函数，确保只发送一次
  const sendReauthMessage = useCallback(
    (type: "reauth-success" | "reauth-cancelled") => {
      if (channel) {
        channel.postMessage({ type });
      }
    },
    [channel],
  );

  // 监听验证码解决事件
  useBroadcast((message: { type: string; token?: string }) => {
    if (message?.type === "captcha-solved" && message.token) {
      setCaptchaToken(message.token);
    }
  });

  // TOTP 倒计时器
  useEffect(() => {
    if (requiresTotp && timeRemaining > 0) {
      totpTimerRef.current = setTimeout(() => {
        setTimeRemaining((prev) => prev - 1);
      }, 1000);
    } else if (timeRemaining === 0) {
      // 超时，返回到密码输入
      setRequiresTotp(false);
      setTotpCode("");
      setTimeRemaining(300);
      toast.error("验证超时，请重新验证");
    }

    return () => {
      if (totpTimerRef.current) {
        clearTimeout(totpTimerRef.current);
      }
    };
  }, [requiresTotp, timeRemaining, toast]);

  // 加载用户信息
  const loadUserInfo = useCallback(async () => {
    try {
      const result = await getCurrentUserForReauth();
      if (result.success && result.data) {
        setUser(result.data);
      } else {
        toast.error(result.message || "加载失败");
        // 如果未登录，关闭窗口
        setTimeout(() => {
          if (channel) {
            channel.postMessage({ type: "reauth-cancelled" });
          }
          window.close();
        }, 1000);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [channel, toast]);

  useEffect(() => {
    // 检查 SSO 回调的成功/错误参数
    const successParam = searchParams.get("success");
    const errorParam = searchParams.get("error");

    if (successParam) {
      // SSO 验证成功
      toast.success(successParam);
      // 通知父窗口验证成功
      sendReauthMessage("reauth-success");
      // 延迟关闭窗口，让用户看到成功消息
      setTimeout(() => {
        window.close();
      }, 500);
      return; // 不再执行后续的用户信息加载
    }

    if (errorParam) {
      // SSO 验证失败
      toast.error(errorParam);
      setLoading(false);
      return; // 不再执行后续的用户信息加载
    }

    // 正常流程 - 加载用户信息
    loadUserInfo();

    // 监听窗口关闭事件
    const handleBeforeUnload = () => {
      // 只有在不是 SSO 跳转时才可能发送取消消息
      if (!isSSORedirectingRef.current) {
        sendReauthMessage("reauth-cancelled");
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      channel?.close();
    };
  }, [searchParams, loadUserInfo, channel, toast, sendReauthMessage]);

  const handlePasswordVerify = async () => {
    if (!password) {
      toast.error("请输入密码");
      return;
    }

    if (!captchaToken) {
      toast.error("请等待安全验证完成");
      return;
    }

    setVerifying(true);
    try {
      const result = await verifyPasswordForReauth({
        password,
        captcha_token: captchaToken,
      });

      if (result.success) {
        // 检查是否需要 TOTP 验证
        const data = result.data as { requiresTotp?: boolean } | null;
        if (data?.requiresTotp) {
          setRequiresTotp(true);
          setVerifying(false);
          setTimeRemaining(300); // 重置倒计时
          return;
        }

        toast.success("验证成功");
        // 通知父窗口验证成功
        sendReauthMessage("reauth-success");
        // 延迟关闭窗口，让用户看到成功消息
        setTimeout(() => {
          window.close();
        }, 500);
      } else {
        toast.error(result.message);
        // 重置验证码
        broadcast({ type: "captcha-reset" });
        setVerifying(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "验证失败");
      // 重置验证码
      broadcast({ type: "captcha-reset" });
      setVerifying(false);
    }
  };

  // TOTP 验证
  const handleTotpVerify = async (code?: string) => {
    // 防止重复提交
    if (totpVerifying) return;

    // 使用传入的 code 或当前状态值
    const codeToVerify = code || totpCode;

    if (!codeToVerify || codeToVerify.length !== 6) {
      return;
    }

    setTotpVerifying(true);
    setTotpMessage("验证中...");

    try {
      const result = await verifyTotpForReauth({
        totp_code: codeToVerify,
      });

      if (result.success) {
        setTotpMessage("验证成功");
        // 通知父窗口验证成功
        sendReauthMessage("reauth-success");
        // 延迟关闭窗口，让用户看到成功消息
        setTimeout(() => {
          window.close();
        }, 500);
      } else {
        setTotpError(true);

        // 检查是否超过失败次数限制
        if (result.error?.code === "TOTP_VERIFICATION_FAILED") {
          setTotpMessage("验证失败次数过多，请重新验证");
          setTimeout(() => {
            // 返回到密码输入
            setRequiresTotp(false);
            setTotpCode("");
            setTotpError(false);
            setTotpVerifying(false);
            setTotpMessage("");
            setTimeRemaining(300);
          }, 2000);
        } else {
          setTotpMessage(result.message || "验证失败，请重试");
          setTimeout(() => {
            setTotpVerifying(false);
            setTotpMessage("");
            setTotpCode("");
            setTotpError(false);
          }, 2000);
        }
      }
    } catch (err) {
      setTotpError(true);
      setTotpMessage(err instanceof Error ? err.message : "验证失败");
      setTimeout(() => {
        setTotpVerifying(false);
        setTotpMessage("");
        setTotpCode("");
        setTotpError(false);
      }, 2000);
    }
  };

  const handleSSOVerify = (provider: OAuthProvider) => {
    // 设置标志：正在进行 SSO 验证
    isSSORedirectingRef.current = true;
    setSsoRedirecting(true);

    // 跳转到 SSO 验证流程
    router.push(`/sso/${provider}/login?mode=reauth`);
  };

  const getProviderIcon = (provider: string) => {
    switch (provider.toLowerCase()) {
      case "google":
        return <RiGoogleFill size="1.25em" />;
      case "github":
        return <RiGithubFill size="1.25em" />;
      case "microsoft":
        return <RiMicrosoftFill size="1.25em" />;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <LoadingIndicator size="lg" />
      </div>
    );
  }

  if (!user) {
    return <UnauthorizedPage redirect="/reauth" />;
  }

  return (
    <div className="fixed inset-0 bg-background overflow-hidden">
      <div className="h-full flex flex-col md:flex-row">
        <div className="flex-1 flex items-center justify-center p-6 md:p-12">
          <AutoResizer className="w-full max-w-md">
            <div className="flex gap-5 items-center justify-between mb-8">
              <div>
                <h1 className="text-3xl font-bold text-foreground tracking-wider mb-2">
                  重新验证身份
                </h1>
                <p className="text-muted-foreground">
                  为保障安全，请验证你的身份。
                </p>
              </div>
              <div className="inline-flex w-16 h-16items-center justify-center mb-4">
                <RiShieldKeyholeLine size="3em" className="text-primary" />
              </div>
            </div>
            {/* 验证方式 */}

            <AutoTransition
              type="scale"
              duration={0.4}
              className="space-y-6 pb-2"
            >
              {!requiresTotp ? (
                // 正常验证界面
                <div key="password" className="space-y-6">
                  {/* 密码验证 */}
                  {user.hasPassword && (
                    <div className="space-y-4">
                      <Input
                        label="Password / 密码"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        helperText="输入你的账户密码"
                        icon={<RiShieldKeyholeLine size={"1em"} />}
                        onKeyPress={(e) => {
                          if (
                            e.key === "Enter" &&
                            !verifying &&
                            !ssoRedirecting
                          ) {
                            handlePasswordVerify();
                          }
                        }}
                        disabled={verifying || ssoRedirecting}
                      />
                      <div className="pt-6 w-full">
                        <CaptchaButton
                          label="下一步"
                          onClick={handlePasswordVerify}
                          loading={verifying}
                          verificationText="正在执行安全验证"
                          variant="secondary"
                          size="lg"
                          fullWidth
                          disabled={ssoRedirecting}
                        />
                      </div>
                    </div>
                  )}

                  {/* 分隔线 */}
                  {user.hasPassword && user.linkedProviders.length > 0 && (
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-muted-foreground/30"></div>
                      </div>
                      <div className="relative flex justify-center text-sm">
                        <span className="px-2 bg-background text-muted-foreground">
                          或使用以下方式验证
                        </span>
                      </div>
                    </div>
                  )}

                  {/* SSO 验证 */}
                  {user.linkedProviders.length > 0 && (
                    <div
                      className={`grid gap-3 ${
                        user.linkedProviders.length === 1
                          ? "grid-cols-1"
                          : user.linkedProviders.length === 2
                            ? "grid-cols-2"
                            : "grid-cols-3"
                      }`}
                    >
                      {user.linkedProviders.map((provider) => (
                        <Button
                          key={provider}
                          label=""
                          onClick={() =>
                            handleSSOVerify(provider as OAuthProvider)
                          }
                          variant="secondary"
                          size="lg"
                          icon={getProviderIcon(provider)}
                          disabled={verifying || ssoRedirecting}
                          loading={ssoRedirecting}
                        />
                      ))}
                    </div>
                  )}

                  {/* 通行密钥验证 */}
                  {passkeyEnabled &&
                    (user.hasPassword || user.linkedProviders.length > 0) && (
                      <>
                        <PasskeyReauthButton
                          disabled={verifying || ssoRedirecting}
                          size="lg"
                          onSuccess={() => sendReauthMessage("reauth-success")}
                        />
                      </>
                    )}

                  {/* 如果没有任何验证方式 */}
                  {!user.hasPassword && user.linkedProviders.length === 0 && (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground mb-2">
                        你的账户未设置任何验证方式
                      </p>
                      <p className="text-sm text-muted-foreground">
                        请联系管理员
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                // TOTP 验证界面
                <div key="totp">
                  <div className="mb-6">
                    <div className="text-center mb-6">
                      <h3 className="text-xl font-semibold text-foreground tracking-wider mb-2">
                        两步验证
                      </h3>
                      <AutoTransition>
                        <p
                          className={`text-sm ${
                            totpMessage
                              ? totpError
                                ? "text-error"
                                : "text-muted-foreground"
                              : "text-muted-foreground"
                          }`}
                          key={totpMessage || "default"}
                        >
                          {totpMessage || "请输入验证器中的 6 位数字验证码"}
                        </p>
                      </AutoTransition>
                    </div>
                  </div>

                  <div className="mb-6">
                    <OtpInput
                      value={totpCode}
                      onChange={setTotpCode}
                      disabled={totpVerifying}
                      onComplete={handleTotpVerify}
                      error={totpError}
                      autoFocus
                    />
                  </div>
                </div>
              )}
            </AutoTransition>
          </AutoResizer>
        </div>
      </div>
    </div>
  );
}
