import { getResend } from "./resend";

const FROM_ADDRESS =
  process.env.NODE_ENV === "production"
    ? "MyDynastyValues <noreply@mydynastyvalues.com>"
    : "MyDynastyValues <onboarding@resend.dev>";

/**
 * Send a password reset email with inline-styled HTML.
 */
export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string
): Promise<void> {
  const resend = getResend();

  await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: "Reset your MyDynastyValues password",
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 20px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:12px;padding:40px;">
        <tr><td>
          <h1 style="color:#ffffff;font-size:24px;margin:0 0 8px;">
            MyDynastyValues
          </h1>
          <p style="color:#94a3b8;font-size:14px;margin:0 0 24px;">
            Password Reset
          </p>
          <p style="color:#cbd5e1;font-size:15px;line-height:1.6;margin:0 0 24px;">
            We received a request to reset your password. Click the
            button below to choose a new one. This link expires in
            1 hour.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr><td align="center" style="background:#2563eb;border-radius:8px;">
              <a href="${resetUrl}"
                 style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
                Reset Password
              </a>
            </td></tr>
          </table>
          <p style="color:#64748b;font-size:13px;line-height:1.5;margin:0 0 16px;">
            If you didn&rsquo;t request this, you can safely ignore
            this email. Your password will remain unchanged.
          </p>
          <p style="color:#475569;font-size:12px;margin:0;">
            If the button doesn&rsquo;t work, copy and paste this
            link:<br>
            <a href="${resetUrl}" style="color:#60a5fa;word-break:break-all;">
              ${resetUrl}
            </a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  });
}
