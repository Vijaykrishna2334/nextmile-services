export interface CertificateEmailData {
  firstName: string
  eventName: string
  category?: string
  certLink: string
}

export function renderCertificateEmail(data: CertificateEmailData): string {
  const { firstName, eventName, category, certLink } = data

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your NextMile Certificate is Here!</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;color:#f4f4f7;">
    You crushed it! Your ${eventName} certificate is ready to download.
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
        <tr>
          <td style="background-color:#0f172a;border-radius:12px 12px 0 0;padding:28px 40px;text-align:center;">
            <span style="display:inline-block;width:32px;height:32px;background-color:#FF6B35;border-radius:8px;text-align:center;line-height:32px;font-size:16px;font-weight:700;color:#ffffff;">N</span>
            <span style="font-size:18px;font-weight:700;color:#ffffff;vertical-align:middle;margin-left:8px;">NextMile</span>
          </td>
        </tr>
        <tr><td style="background-color:#008CBA;height:4px;"></td></tr>
        <tr>
          <td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);padding:40px 40px 32px;text-align:center;">
            <p style="margin:0 0 8px;font-size:48px;line-height:1;">🏅</p>
            <p style="margin:0 0 8px;font-size:28px;font-weight:800;color:#ffffff;">You Did It!</p>
            <p style="margin:0;font-size:15px;color:#94a3b8;line-height:1.5;">
              Congratulations, <strong style="color:#ffffff;">${firstName}</strong>!<br />
              You completed the <strong style="color:#008CBA;">${eventName}</strong>${category ? ` — ${category}` : ''}.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background-color:#ffffff;padding:36px 40px;">
            <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;">
              Hey <strong style="color:#0f172a;">${firstName}</strong>, your verified e-certificate is ready. Share it with pride!
            </p>
            <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:28px;background:linear-gradient(135deg,#e0f4ff 0%,#f0faff 100%);border-radius:12px;border:1px solid #bae6fd;">
              <tr>
                <td style="padding:28px 24px;text-align:center;">
                  <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#0f172a;">Your Certificate is Ready</p>
                  <p style="margin:0 0 20px;font-size:13px;color:#64748b;">Click below to download your official digital certificate.</p>
                  <a href="${certLink}" style="display:inline-block;padding:14px 36px;background-color:#008CBA;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:700;">⬇️ Download Certificate</a>
                  <p style="margin:12px 0 0;font-size:11px;color:#94a3b8;">PDF format · Signed &amp; verified by NextMile</p>
                </td>
              </tr>
            </table>
            <table cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#fefce8;border-radius:8px;border:1px solid #fde68a;">
              <tr>
                <td style="padding:16px 20px;">
                  <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#0f172a;">📦 Your Physical Medal</p>
                  <p style="margin:0;font-size:13px;color:#64748b;line-height:1.5;">
                    Your medal is being prepared for dispatch. We'll send a tracking number once it ships (5–7 business days).
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background-color:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;">
            <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">
              Issues? <a href="mailto:support@gonextmile.in" style="color:#008CBA;text-decoration:none;">support@gonextmile.in</a>
            </p>
            <p style="margin:0;font-size:12px;color:#cbd5e1;">NextMile, India · Keep running. Keep growing.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
