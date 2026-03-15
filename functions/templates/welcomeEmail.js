/**
 * SynchIntro Welcome Email Template
 *
 * Generates a branded HTML welcome email for new SynchIntro users.
 * Uses inline styles for maximum email client compatibility.
 * Primary color: teal #0d9488
 */

function generateWelcomeHtml(options = {}) {
    const {
        userName = 'there',
        setupLink = 'https://app.synchintro.ai',
        supportEmail = 'support@pathsynch.com'
    } = options;

    const firstName = userName !== 'there' ? userName.split(' ')[0] : 'there';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>Welcome to SynchIntro</title>
    <!--[if mso]>
    <style type="text/css">
        body, table, td { font-family: Arial, sans-serif !important; }
    </style>
    <![endif]-->
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background-color: #f3f4f6; -webkit-font-smoothing: antialiased;">
    <!-- Wrapper -->
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f3f4f6;">
        <tr>
            <td align="center" style="padding: 24px 16px;">
                <!-- Container -->
                <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">

                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%); padding: 48px 32px; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Welcome to SynchIntro</h1>
                            <p style="color: rgba(255,255,255,0.9); margin: 12px 0 0 0; font-size: 16px; font-weight: 400;">
                                AI-powered sales intelligence, ready when you are
                            </p>
                        </td>
                    </tr>

                    <!-- Body -->
                    <tr>
                        <td style="padding: 36px 32px 24px 32px;">
                            <p style="color: #1f2937; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                                Hi ${escapeHtml(firstName)},
                            </p>
                            <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 28px 0;">
                                Thanks for joining SynchIntro! You now have access to AI-driven pitch generation,
                                market intelligence, and sales enablement tools designed to help you close more deals.
                            </p>

                            <!-- 3 Action Steps -->
                            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f0fdfa; border-radius: 12px; border: 1px solid #ccfbf1;">
                                <tr>
                                    <td style="padding: 24px;">
                                        <h3 style="color: #0d9488; margin: 0 0 20px 0; font-size: 18px; font-weight: 600;">Get started in 3 steps</h3>

                                        <!-- Step 1 -->
                                        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 16px;">
                                            <tr>
                                                <td width="36" valign="top" style="padding-right: 12px;">
                                                    <div style="background-color: #0d9488; color: #ffffff; width: 28px; height: 28px; border-radius: 50%; text-align: center; line-height: 28px; font-size: 13px; font-weight: 700;">1</div>
                                                </td>
                                                <td valign="top">
                                                    <strong style="color: #1f2937; font-size: 15px;">Set up your seller profile</strong><br>
                                                    <span style="color: #6b7280; font-size: 14px; line-height: 1.5;">Add your logo, company name, and branding so every pitch looks professional.</span>
                                                </td>
                                            </tr>
                                        </table>

                                        <!-- Step 2 -->
                                        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 16px;">
                                            <tr>
                                                <td width="36" valign="top" style="padding-right: 12px;">
                                                    <div style="background-color: #0d9488; color: #ffffff; width: 28px; height: 28px; border-radius: 50%; text-align: center; line-height: 28px; font-size: 13px; font-weight: 700;">2</div>
                                                </td>
                                                <td valign="top">
                                                    <strong style="color: #1f2937; font-size: 15px;">Generate your first pitch</strong><br>
                                                    <span style="color: #6b7280; font-size: 14px; line-height: 1.5;">Enter a prospect business name and let AI create a personalized pitch in seconds.</span>
                                                </td>
                                            </tr>
                                        </table>

                                        <!-- Step 3 -->
                                        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                                            <tr>
                                                <td width="36" valign="top" style="padding-right: 12px;">
                                                    <div style="background-color: #0d9488; color: #ffffff; width: 28px; height: 28px; border-radius: 50%; text-align: center; line-height: 28px; font-size: 13px; font-weight: 700;">3</div>
                                                </td>
                                                <td valign="top">
                                                    <strong style="color: #1f2937; font-size: 15px;">Explore Market Intelligence</strong><br>
                                                    <span style="color: #6b7280; font-size: 14px; line-height: 1.5;">Run a market scan to discover prospects, pain points, and competitive insights.</span>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- CTA Button -->
                    <tr>
                        <td style="padding: 8px 32px 36px 32px; text-align: center;">
                            <table role="presentation" cellpadding="0" cellspacing="0" align="center">
                                <tr>
                                    <td style="background-color: #0d9488; border-radius: 8px;">
                                        <a href="${escapeHtml(setupLink)}"
                                           target="_blank"
                                           style="display: inline-block; padding: 16px 40px; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 16px; letter-spacing: 0.3px;">
                                            Go to SynchIntro
                                        </a>
                                    </td>
                                </tr>
                            </table>
                            <p style="color: #9ca3af; font-size: 13px; margin: 16px 0 0 0;">
                                Questions? Reply to this email or contact
                                <a href="mailto:${escapeHtml(supportEmail)}" style="color: #0d9488; text-decoration: underline;">${escapeHtml(supportEmail)}</a>
                            </p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f9fafb; padding: 24px 32px; text-align: center; border-top: 1px solid #e5e7eb;">
                            <p style="color: #9ca3af; font-size: 12px; margin: 0; line-height: 1.6;">
                                SynchIntro by PathSynch Labs &mdash; AI Sales Intelligence &amp; Enablement<br>
                                <a href="https://app.synchintro.ai" style="color: #0d9488; text-decoration: none;">app.synchintro.ai</a>
                            </p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

/**
 * Escape HTML entities to prevent XSS in template variables
 */
function escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

module.exports = { generateWelcomeHtml };
