export interface WelcomeEmailData {
  firstName: string
  eventName: string
  category?: string
  prepGuideUrl: string
  submissionFormUrl: string
}

export function renderWelcomeEmail(data: WelcomeEmailData): string {
  const { firstName, eventName, category, prepGuideUrl, submissionFormUrl } = data

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to ${eventName}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;color:#f4f4f7;">
    You're officially registered for ${eventName} — here's everything you need to get started.
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
        <tr><td style="background-color:#FF6B35;height:4px;"></td></tr>
        <tr>
          <td style="background-color:#ffffff;padding:40px 40px 32px;">
            <p style="margin:0 0 8px;font-size:24px;font-weight:700;color:#0f172a;">Hey ${firstName}! 👋</p>
            <p style="margin:0 0 24px;font-size:15px;color:#64748b;line-height:1.5;">
              You're officially registered for <strong style="color:#0f172a;">${eventName}</strong>${category ? ` — <strong>${category}</strong> category` : ''}. We're pumped to have you!
            </p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 28px;" />
            <p style="margin:0 0 14px;font-size:14px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.05em;">How the challenge works</p>
            <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:28px;">
              ${[
                ['🗓️', 'Pick your date', 'Run your distance anytime during the event window.'],
                ['📸', 'Take a screenshot', 'Capture your run on any fitness app — Strava, Nike, Apple Watch, etc.'],
                ['📤', 'Submit your proof', 'Upload your screenshot using the submission form below.'],
                ['🏅', 'Get your rewards', 'We verify your run and send your e-certificate + physical medal to your address.'],
              ].map(([icon, title, desc]) => `
              <tr>
                <td style="width:40px;padding:8px 12px 8px 0;vertical-align:top;font-size:20px;">${icon}</td>
                <td style="padding:8px 0;vertical-align:top;">
                  <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#0f172a;">${title}</p>
                  <p style="margin:0;font-size:13px;color:#64748b;line-height:1.4;">${desc}</p>
                </td>
              </tr>`).join('')}
            </table>
            ${prepGuideUrl ? `
            <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:16px;background-color:#fff7f4;border-radius:8px;border:1px solid #fed7c3;">
              <tr><td style="padding:16px 20px;">
                <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#0f172a;">📋 Training Prep Guide</p>
                <p style="margin:0 0 12px;font-size:13px;color:#64748b;">Download your event-specific prep guide with tips and training plans.</p>
                <a href="${prepGuideUrl}" style="display:inline-block;padding:8px 18px;background-color:#FF6B35;color:#ffffff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">Download Prep Guide →</a>
              </td></tr>
            </table>` : ''}
            <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:28px;">
              <tr>
                <td align="center" style="background-color:#0f172a;border-radius:10px;padding:24px 20px;">
                  <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#ffffff;">Ready to submit your run?</p>
                  <p style="margin:0 0 16px;font-size:13px;color:#94a3b8;">After completing your run, click below to upload your screenshot proof.</p>
                  <a href="${submissionFormUrl}" style="display:inline-block;padding:12px 32px;background-color:#FF6B35;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:700;">Submit My Run 🏃</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background-color:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;">
            <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">
              Questions? Reply to this email or reach us at
              <a href="mailto:support@gonextmile.in" style="color:#FF6B35;text-decoration:none;">support@gonextmile.in</a>
            </p>
            <p style="margin:0;font-size:12px;color:#cbd5e1;">
              Follow us <a href="https://instagram.com/gonextmile.in" style="color:#FF6B35;text-decoration:none;">@gonextmile.in</a> on Instagram.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
