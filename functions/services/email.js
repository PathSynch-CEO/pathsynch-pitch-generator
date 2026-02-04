/**
 * Email Service
 *
 * Handles sending emails via SendGrid
 * Used for: PDF reports, lead nurturing, notifications
 */

const sgMail = require('@sendgrid/mail');

// Initialize SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM_EMAIL = 'hello@pathsynch.com';
const FROM_NAME = 'PathSynch';

/**
 * Send a market report PDF via email
 *
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {Buffer} pdfBuffer - PDF file as buffer
 * @param {string} filename - PDF filename
 * @param {Object} reportData - Report data for email body
 * @returns {Promise<Object>}
 */
async function sendMarketReportEmail(to, subject, pdfBuffer, filename, reportData = {}) {
    const { location, industry, metrics } = reportData;

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #f5f5f5;">
    <div style="max-width: 600px; margin: 0 auto; background: white;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #3A6746 0%, #6B4423 100%); padding: 32px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Your Market Intelligence Report</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">
                ${location || 'Your Market'} - ${industry || 'Industry Analysis'}
            </p>
        </div>

        <!-- Body -->
        <div style="padding: 32px;">
            <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                Your market intelligence report is attached to this email. Here's a quick summary:
            </p>

            <!-- Stats Grid -->
            ${metrics ? `
            <div style="display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 24px;">
                <div style="flex: 1; min-width: 120px; background: #f8f9fa; border-radius: 8px; padding: 16px; text-align: center;">
                    <div style="font-size: 28px; font-weight: 700; color: #3A6746;">${metrics.competitorCount || '-'}</div>
                    <div style="font-size: 11px; color: #666; text-transform: uppercase;">Competitors</div>
                </div>
                <div style="flex: 1; min-width: 120px; background: #f8f9fa; border-radius: 8px; padding: 16px; text-align: center;">
                    <div style="font-size: 28px; font-weight: 700; color: #3A6746;">${metrics.saturationLevel || '-'}</div>
                    <div style="font-size: 11px; color: #666; text-transform: uppercase;">Competition</div>
                </div>
                ${metrics.opportunityScore ? `
                <div style="flex: 1; min-width: 120px; background: #f8f9fa; border-radius: 8px; padding: 16px; text-align: center;">
                    <div style="font-size: 28px; font-weight: 700; color: #3A6746;">${metrics.opportunityScore}</div>
                    <div style="font-size: 11px; color: #666; text-transform: uppercase;">Opportunity</div>
                </div>
                ` : ''}
            </div>
            ` : ''}

            <p style="color: #666; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
                Open the attached PDF for the full report including detailed competitor analysis,
                demographic breakdowns, and strategic recommendations.
            </p>

            <!-- CTA Button -->
            <div style="text-align: center; margin: 32px 0;">
                <a href="https://pathsynch-pitch-creation.web.app/dashboard.html"
                   style="display: inline-block; background: #3A6746; color: white; padding: 14px 32px;
                          border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                    View Full Dashboard
                </a>
            </div>

            <p style="color: #888; font-size: 13px; line-height: 1.6; margin: 24px 0 0 0;">
                Questions? Reply to this email or visit our
                <a href="https://pathsynch-pitch-creation.web.app" style="color: #3A6746;">website</a>.
            </p>
        </div>

        <!-- Footer -->
        <div style="background: #f8f9fa; padding: 24px 32px; text-align: center; border-top: 1px solid #e8e8e8;">
            <p style="color: #888; font-size: 12px; margin: 0;">
                PathSynch Market Intelligence<br>
                <a href="https://pathsynch-pitch-creation.web.app" style="color: #3A6746;">pathsynch-pitch-creation.web.app</a>
            </p>
        </div>
    </div>
</body>
</html>
    `;

    const msg = {
        to,
        from: {
            email: FROM_EMAIL,
            name: FROM_NAME
        },
        subject,
        html,
        attachments: pdfBuffer ? [
            {
                content: pdfBuffer.toString('base64'),
                filename: filename || 'Market_Report.pdf',
                type: 'application/pdf',
                disposition: 'attachment'
            }
        ] : []
    };

    try {
        await sgMail.send(msg);
        return { success: true, message: 'Email sent successfully' };
    } catch (error) {
        console.error('SendGrid error:', error.response?.body || error.message);
        throw new Error('Failed to send email: ' + (error.response?.body?.errors?.[0]?.message || error.message));
    }
}

/**
 * Send a pitch deck PDF via email
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {Buffer} pdfBuffer - PDF file as buffer
 * @param {string} filename - PDF filename
 * @param {Object} pitchData - Pitch data for email body
 * @param {string} pitchData.businessName - Prospect's business name
 * @param {string} pitchData.contactName - Prospect's contact name
 * @param {string} pitchData.senderCompanyName - Account holder's company name (shown in header)
 * @param {string} pitchData.pitchUrl - URL to view the pitch online
 * @param {string} pitchData.pitchId - Pitch ID for tracking
 */
async function sendPitchEmail(to, subject, pdfBuffer, filename, pitchData = {}) {
    const { businessName, contactName, senderCompanyName, pitchUrl, pitchId } = pitchData;

    // Build the View Report URL with tracking parameter
    const trackingUrl = pitchUrl
        ? `${pitchUrl}${pitchUrl.includes('?') ? '&' : '?'}utm_source=email&utm_medium=pitch_email&utm_campaign=view_report`
        : 'https://pathsynch-pitch-creation.web.app/dashboard.html';

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #f5f5f5;">
    <div style="max-width: 600px; margin: 0 auto; background: white;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #3A6746 0%, #6B4423 100%); padding: 32px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">${senderCompanyName || 'PathSynch'}</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">
                Prepared for ${businessName || 'Your Business'}
            </p>
        </div>

        <!-- Body -->
        <div style="padding: 32px;">
            <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                ${contactName ? `Hi ${contactName},` : 'Hello,'}<br><br>
                Your personalized pitch deck is ready to view. This presentation has been
                tailored specifically for ${businessName || 'your business'} based on your market data
                and business profile.
            </p>

            <div style="background: #e8f5e9; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="color: #3A6746; margin: 0 0 8px 0; font-size: 16px;">What's Inside:</h3>
                <ul style="color: #333; margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.8;">
                    <li>Custom ROI projections</li>
                    <li>Market opportunity analysis</li>
                    <li>Implementation timeline</li>
                    <li>Clear call-to-action</li>
                </ul>
            </div>

            <!-- CTA Button -->
            <div style="text-align: center; margin: 32px 0;">
                <a href="${trackingUrl}"
                   style="display: inline-block; background: #3A6746; color: white; padding: 14px 32px;
                          border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                    View Report
                </a>
            </div>
        </div>

        <!-- Footer -->
        <div style="background: #f8f9fa; padding: 24px 32px; text-align: center; border-top: 1px solid #e8e8e8;">
            <p style="color: #888; font-size: 12px; margin: 0;">
                ${senderCompanyName || 'PathSynch'}
            </p>
        </div>
    </div>
</body>
</html>
    `;

    const msg = {
        to,
        from: {
            email: FROM_EMAIL,
            name: FROM_NAME
        },
        subject,
        html
        // Note: PDF attachment removed - recipients view pitch via link only
    };

    try {
        await sgMail.send(msg);
        return { success: true, message: 'Email sent successfully' };
    } catch (error) {
        console.error('SendGrid error:', error.response?.body || error.message);
        throw new Error('Failed to send email: ' + (error.response?.body?.errors?.[0]?.message || error.message));
    }
}

/**
 * Send a lead nurture email (for mini-report follow-up)
 */
async function sendLeadNurtureEmail(to, leadData = {}) {
    const { city, state, industry } = leadData;
    const location = [city, state].filter(Boolean).join(', ');

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #f5f5f5;">
    <div style="max-width: 600px; margin: 0 auto; background: white;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #3A6746 0%, #6B4423 100%); padding: 32px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Ready for the Full Picture?</h1>
        </div>

        <!-- Body -->
        <div style="padding: 32px;">
            <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                You recently checked out the ${industry || 'local'} market in ${location || 'your area'}.
                Your free report showed you the basics - but there's so much more to discover.
            </p>

            <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="color: #333; margin: 0 0 12px 0; font-size: 16px;">Unlock Full Access:</h3>
                <ul style="color: #666; margin: 0; padding-left: 20px; font-size: 14px; line-height: 2;">
                    <li><strong>Opportunity Score</strong> - Know exactly how attractive your market is</li>
                    <li><strong>Competitor Deep Dive</strong> - Ratings, reviews, and positioning</li>
                    <li><strong>Demographics</strong> - Age, income, and education breakdowns</li>
                    <li><strong>AI Recommendations</strong> - Personalized strategies for your market</li>
                    <li><strong>PDF Reports</strong> - Share with your team or investors</li>
                </ul>
            </div>

            <!-- CTA Button -->
            <div style="text-align: center; margin: 32px 0;">
                <a href="https://pathsynch-pitch-creation.web.app/signup.html?source=nurture"
                   style="display: inline-block; background: #3A6746; color: white; padding: 14px 32px;
                          border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                    Start Free Trial
                </a>
            </div>

            <p style="color: #888; font-size: 13px; text-align: center;">
                No credit card required. Cancel anytime.
            </p>
        </div>

        <!-- Footer -->
        <div style="background: #f8f9fa; padding: 24px 32px; text-align: center; border-top: 1px solid #e8e8e8;">
            <p style="color: #888; font-size: 12px; margin: 0;">
                PathSynch Market Intelligence<br>
                <a href="https://pathsynch-pitch-creation.web.app" style="color: #3A6746;">pathsynch-pitch-creation.web.app</a>
            </p>
            <p style="color: #aaa; font-size: 11px; margin: 12px 0 0 0;">
                <a href="https://pathsynch-pitch-creation.web.app/unsubscribe" style="color: #aaa;">Unsubscribe</a>
            </p>
        </div>
    </div>
</body>
</html>
    `;

    const msg = {
        to,
        from: {
            email: FROM_EMAIL,
            name: FROM_NAME
        },
        subject: `Your ${industry || 'market'} opportunity in ${location || 'your area'} - Full report ready`,
        html
    };

    try {
        await sgMail.send(msg);
        return { success: true, message: 'Nurture email sent' };
    } catch (error) {
        console.error('SendGrid error:', error.response?.body || error.message);
        throw new Error('Failed to send email');
    }
}

/**
 * Send a welcome email to new users
 */
async function sendWelcomeEmail(to, userData = {}) {
    const { displayName } = userData;
    const firstName = displayName ? displayName.split(' ')[0] : '';

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #f5f5f5;">
    <div style="max-width: 600px; margin: 0 auto; background: white;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #3A6746 0%, #6B4423 100%); padding: 40px 32px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to PathSynch!</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 12px 0 0 0; font-size: 16px;">
                Your journey to smarter pitches starts here
            </p>
        </div>

        <!-- Body -->
        <div style="padding: 32px;">
            <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                ${firstName ? `Hi ${firstName},` : 'Hi there,'}<br><br>
                Thanks for joining PathSynch! We're excited to help you create compelling,
                data-driven pitch decks that close more deals.
            </p>

            <div style="background: #f8f9fa; border-radius: 12px; padding: 24px; margin: 24px 0;">
                <h3 style="color: #3A6746; margin: 0 0 16px 0; font-size: 18px;">Quick Start Guide</h3>
                <div style="margin-bottom: 16px;">
                    <div style="display: flex; align-items: flex-start; margin-bottom: 12px;">
                        <span style="background: #3A6746; color: white; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; margin-right: 12px; flex-shrink: 0;">1</span>
                        <div>
                            <strong style="color: #333;">Create Your First Pitch</strong><br>
                            <span style="color: #666; font-size: 14px;">Enter a business name and let AI do the rest</span>
                        </div>
                    </div>
                    <div style="display: flex; align-items: flex-start; margin-bottom: 12px;">
                        <span style="background: #3A6746; color: white; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; margin-right: 12px; flex-shrink: 0;">2</span>
                        <div>
                            <strong style="color: #333;">Add Your Branding</strong><br>
                            <span style="color: #666; font-size: 14px;">Upload your logo and customize colors in Settings</span>
                        </div>
                    </div>
                    <div style="display: flex; align-items: flex-start;">
                        <span style="background: #3A6746; color: white; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; margin-right: 12px; flex-shrink: 0;">3</span>
                        <div>
                            <strong style="color: #333;">Explore Market Intelligence</strong><br>
                            <span style="color: #666; font-size: 14px;">Get insights on any market to power your pitches</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- CTA Button -->
            <div style="text-align: center; margin: 32px 0;">
                <a href="https://pathsynch-pitch-creation.web.app/create-pitch.html"
                   style="display: inline-block; background: #3A6746; color: white; padding: 16px 40px;
                          border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
                    Create Your First Pitch
                </a>
            </div>

            <p style="color: #888; font-size: 14px; line-height: 1.6; margin: 24px 0 0 0; text-align: center;">
                Questions? Just reply to this email - we're here to help!
            </p>
        </div>

        <!-- Footer -->
        <div style="background: #f8f9fa; padding: 24px 32px; text-align: center; border-top: 1px solid #e8e8e8;">
            <p style="color: #888; font-size: 12px; margin: 0;">
                PathSynch - AI-Powered Pitch Generation<br>
                <a href="https://pathsynch-pitch-creation.web.app" style="color: #3A6746;">pathsynch-pitch-creation.web.app</a>
            </p>
        </div>
    </div>
</body>
</html>
    `;

    const msg = {
        to,
        from: {
            email: FROM_EMAIL,
            name: FROM_NAME
        },
        subject: 'Welcome to PathSynch - Let\'s Create Your First Pitch!',
        html
    };

    try {
        await sgMail.send(msg);
        return { success: true, message: 'Welcome email sent' };
    } catch (error) {
        console.error('SendGrid error:', error.response?.body || error.message);
        // Don't throw - welcome email failure shouldn't block signup
        return { success: false, error: error.message };
    }
}

/**
 * Send a team invite email
 */
async function sendTeamInviteEmail(to, inviteData = {}) {
    const { teamName, inviterName, inviterEmail, role, inviteUrl, inviteCode } = inviteData;

    const roleDescriptions = {
        admin: 'Full access to team settings, billing, and all pitches',
        manager: 'Create and manage pitches, view team reports',
        member: 'Create pitches and view own work'
    };

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #f5f5f5;">
    <div style="max-width: 600px; margin: 0 auto; background: white;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #3A6746 0%, #6B4423 100%); padding: 32px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">You're Invited!</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">
                Join ${teamName || 'the team'} on PathSynch
            </p>
        </div>

        <!-- Body -->
        <div style="padding: 32px;">
            <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                <strong>${inviterName || inviterEmail || 'Your colleague'}</strong> has invited you to join
                <strong>${teamName || 'their team'}</strong> on PathSynch as a <strong>${role || 'member'}</strong>.
            </p>

            <div style="background: #e8f5e9; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="color: #3A6746; margin: 0 0 8px 0; font-size: 16px;">Your Role: ${(role || 'member').charAt(0).toUpperCase() + (role || 'member').slice(1)}</h3>
                <p style="color: #333; margin: 0; font-size: 14px;">
                    ${roleDescriptions[role] || roleDescriptions.member}
                </p>
            </div>

            <p style="color: #666; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
                PathSynch helps teams create compelling, data-driven pitch decks.
                Join your team to start collaborating on pitches together.
            </p>

            <!-- CTA Button -->
            <div style="text-align: center; margin: 32px 0;">
                <a href="${inviteUrl || `https://pathsynch-pitch-creation.web.app/join-team.html?code=${inviteCode}`}"
                   style="display: inline-block; background: #3A6746; color: white; padding: 14px 32px;
                          border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                    Accept Invitation
                </a>
            </div>

            <p style="color: #888; font-size: 13px; line-height: 1.6; margin: 24px 0 0 0; text-align: center;">
                This invitation expires in 7 days.<br>
                If you don't have a PathSynch account yet, you'll be prompted to create one.
            </p>
        </div>

        <!-- Footer -->
        <div style="background: #f8f9fa; padding: 24px 32px; text-align: center; border-top: 1px solid #e8e8e8;">
            <p style="color: #888; font-size: 12px; margin: 0;">
                PathSynch Team Collaboration<br>
                <a href="https://pathsynch-pitch-creation.web.app" style="color: #3A6746;">pathsynch-pitch-creation.web.app</a>
            </p>
            <p style="color: #aaa; font-size: 11px; margin: 12px 0 0 0;">
                If you weren't expecting this invitation, you can safely ignore this email.
            </p>
        </div>
    </div>
</body>
</html>
    `;

    const msg = {
        to,
        from: {
            email: FROM_EMAIL,
            name: FROM_NAME
        },
        subject: `${inviterName || 'Your colleague'} invited you to join ${teamName || 'their team'} on PathSynch`,
        html
    };

    try {
        await sgMail.send(msg);
        return { success: true, message: 'Invite email sent' };
    } catch (error) {
        console.error('SendGrid error:', error.response?.body || error.message);
        throw new Error('Failed to send invite email');
    }
}

/**
 * Send bulk job completion notification
 */
async function sendBulkJobCompleteEmail(to, jobData = {}) {
    const { jobId, totalRows, successCount, failedCount, downloadUrl } = jobData;

    const statusColor = failedCount === 0 ? '#3A6746' : (successCount > 0 ? '#f59e0b' : '#dc2626');
    const statusText = failedCount === 0 ? 'Completed Successfully' : (successCount > 0 ? 'Completed with Errors' : 'Failed');

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #f5f5f5;">
    <div style="max-width: 600px; margin: 0 auto; background: white;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #3A6746 0%, #6B4423 100%); padding: 32px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Bulk Upload Complete</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">
                Your batch of pitches has finished processing
            </p>
        </div>

        <!-- Body -->
        <div style="padding: 32px;">
            <!-- Status Badge -->
            <div style="text-align: center; margin-bottom: 24px;">
                <span style="display: inline-block; background: ${statusColor}; color: white; padding: 8px 20px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                    ${statusText}
                </span>
            </div>

            <!-- Stats Grid -->
            <div style="display: flex; gap: 12px; margin-bottom: 24px;">
                <div style="flex: 1; background: #f8f9fa; border-radius: 8px; padding: 16px; text-align: center;">
                    <div style="font-size: 28px; font-weight: 700; color: #333;">${totalRows}</div>
                    <div style="font-size: 11px; color: #666; text-transform: uppercase;">Total Rows</div>
                </div>
                <div style="flex: 1; background: #d4edda; border-radius: 8px; padding: 16px; text-align: center;">
                    <div style="font-size: 28px; font-weight: 700; color: #155724;">${successCount}</div>
                    <div style="font-size: 11px; color: #155724; text-transform: uppercase;">Successful</div>
                </div>
                ${failedCount > 0 ? `
                <div style="flex: 1; background: #f8d7da; border-radius: 8px; padding: 16px; text-align: center;">
                    <div style="font-size: 28px; font-weight: 700; color: #721c24;">${failedCount}</div>
                    <div style="font-size: 11px; color: #721c24; text-transform: uppercase;">Failed</div>
                </div>
                ` : ''}
            </div>

            ${successCount > 0 ? `
            <p style="color: #666; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
                Your ${successCount} pitch${successCount !== 1 ? 'es are' : ' is'} ready!
                Download them as a ZIP file or view them individually in your dashboard.
            </p>
            ` : ''}

            ${failedCount > 0 ? `
            <div style="background: #fff3cd; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                <p style="color: #856404; font-size: 14px; margin: 0;">
                    <strong>${failedCount} row${failedCount !== 1 ? 's' : ''} failed</strong> -
                    Check the job details in your dashboard to see what went wrong and retry.
                </p>
            </div>
            ` : ''}

            <!-- CTA Buttons -->
            <div style="text-align: center; margin: 32px 0;">
                ${successCount > 0 ? `
                <a href="https://pathsynch-pitch-creation.web.app/bulk-upload.html"
                   style="display: inline-block; background: #3A6746; color: white; padding: 14px 32px;
                          border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; margin-right: 12px;">
                    View & Download
                </a>
                ` : ''}
                <a href="https://pathsynch-pitch-creation.web.app/dashboard.html"
                   style="display: inline-block; background: white; color: #333; padding: 14px 32px;
                          border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; border: 1px solid #ddd;">
                    Go to Dashboard
                </a>
            </div>
        </div>

        <!-- Footer -->
        <div style="background: #f8f9fa; padding: 24px 32px; text-align: center; border-top: 1px solid #e8e8e8;">
            <p style="color: #888; font-size: 12px; margin: 0;">
                PathSynch Bulk Upload<br>
                Job ID: ${jobId || 'N/A'}
            </p>
        </div>
    </div>
</body>
</html>
    `;

    const msg = {
        to,
        from: {
            email: FROM_EMAIL,
            name: FROM_NAME
        },
        subject: `Bulk Upload ${statusText}: ${successCount}/${totalRows} pitches created`,
        html
    };

    try {
        await sgMail.send(msg);
        return { success: true, message: 'Notification email sent' };
    } catch (error) {
        console.error('SendGrid error:', error.response?.body || error.message);
        // Don't throw - notification failure shouldn't cause issues
        return { success: false, error: error.message };
    }
}

/**
 * Send pitch completion notification
 */
async function sendPitchCompleteEmail(to, pitchData = {}) {
    const { businessName, pitchLevel, pitchId, pitchUrl } = pitchData;

    const levelNames = {
        1: 'Outreach Email',
        2: 'One-Pager',
        3: 'Enterprise Deck'
    };

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #f5f5f5;">
    <div style="max-width: 600px; margin: 0 auto; background: white;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #3A6746 0%, #6B4423 100%); padding: 32px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Your Pitch is Ready!</h1>
        </div>

        <!-- Body -->
        <div style="padding: 32px;">
            <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                Great news! Your <strong>${levelNames[pitchLevel] || 'pitch'}</strong> for
                <strong>${businessName || 'your prospect'}</strong> is ready to view and share.
            </p>

            <div style="background: #e8f5e9; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
                <div style="font-size: 14px; color: #666; margin-bottom: 4px;">PITCH TYPE</div>
                <div style="font-size: 20px; font-weight: 700; color: #3A6746;">${levelNames[pitchLevel] || `Level ${pitchLevel}`}</div>
            </div>

            <!-- CTA Button -->
            <div style="text-align: center; margin: 32px 0;">
                <a href="${pitchUrl || `https://pathsynch-pitch-creation.web.app/view-pitch.html?id=${pitchId}`}"
                   style="display: inline-block; background: #3A6746; color: white; padding: 14px 32px;
                          border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                    View Your Pitch
                </a>
            </div>

            <p style="color: #888; font-size: 13px; line-height: 1.6; margin: 24px 0 0 0; text-align: center;">
                You can also access this pitch anytime from your dashboard.
            </p>
        </div>

        <!-- Footer -->
        <div style="background: #f8f9fa; padding: 24px 32px; text-align: center; border-top: 1px solid #e8e8e8;">
            <p style="color: #888; font-size: 12px; margin: 0;">
                PathSynch Pitch Generator<br>
                <a href="https://pathsynch-pitch-creation.web.app" style="color: #3A6746;">pathsynch-pitch-creation.web.app</a>
            </p>
        </div>
    </div>
</body>
</html>
    `;

    const msg = {
        to,
        from: {
            email: FROM_EMAIL,
            name: FROM_NAME
        },
        subject: `Your pitch for ${businessName || 'your prospect'} is ready!`,
        html
    };

    try {
        await sgMail.send(msg);
        return { success: true, message: 'Pitch notification sent' };
    } catch (error) {
        console.error('SendGrid error:', error.response?.body || error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Send subscription confirmation email
 */
async function sendSubscriptionEmail(to, subscriptionData = {}) {
    const { plan, amount, interval, trialDays } = subscriptionData;

    const planNames = { starter: 'Starter', growth: 'Growth', scale: 'Scale' };
    const planName = planNames[plan] || plan;

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #f5f5f5;">
    <div style="max-width: 600px; margin: 0 auto; background: white;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #3A6746 0%, #6B4423 100%); padding: 40px 32px; text-align: center;">
            <div style="font-size: 48px; margin-bottom: 12px;">🎉</div>
            <h1 style="color: white; margin: 0; font-size: 24px;">Welcome to ${planName}!</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">
                Your subscription is now active
            </p>
        </div>

        <!-- Body -->
        <div style="padding: 32px;">
            ${trialDays ? `
            <div style="background: #e8f5e9; border-radius: 8px; padding: 16px; margin-bottom: 24px; text-align: center;">
                <p style="color: #3A6746; font-size: 14px; margin: 0;">
                    <strong>Your ${trialDays}-day free trial has started!</strong><br>
                    You won't be charged until the trial ends.
                </p>
            </div>
            ` : ''}

            <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                Thank you for upgrading to the <strong>${planName}</strong> plan!
                You now have access to all the features included in your plan.
            </p>

            <div style="background: #f8f9fa; border-radius: 12px; padding: 24px; margin: 24px 0;">
                <h3 style="color: #333; margin: 0 0 16px 0; font-size: 16px;">Your Plan Includes:</h3>
                ${plan === 'growth' ? `
                <ul style="color: #666; margin: 0; padding-left: 20px; font-size: 14px; line-height: 2;">
                    <li>100 pitches per month</li>
                    <li>Level 1, 2 & 3 pitch templates</li>
                    <li>Full Market Intelligence access</li>
                    <li>PDF exports</li>
                    <li>50 bulk upload rows</li>
                    <li>3 team members</li>
                </ul>
                ` : plan === 'scale' ? `
                <ul style="color: #666; margin: 0; padding-left: 20px; font-size: 14px; line-height: 2;">
                    <li>Unlimited pitches</li>
                    <li>All pitch levels + custom templates</li>
                    <li>Full Market Intelligence + PDF export</li>
                    <li>100 bulk upload rows</li>
                    <li>10 team members</li>
                    <li>White-label branding</li>
                    <li>Priority support</li>
                </ul>
                ` : `
                <ul style="color: #666; margin: 0; padding-left: 20px; font-size: 14px; line-height: 2;">
                    <li>All features in your plan tier</li>
                </ul>
                `}
            </div>

            <!-- CTA Button -->
            <div style="text-align: center; margin: 32px 0;">
                <a href="https://pathsynch-pitch-creation.web.app/dashboard.html"
                   style="display: inline-block; background: #3A6746; color: white; padding: 14px 32px;
                          border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                    Go to Dashboard
                </a>
            </div>

            <p style="color: #888; font-size: 13px; line-height: 1.6; margin: 24px 0 0 0; text-align: center;">
                Manage your subscription anytime in <a href="https://pathsynch-pitch-creation.web.app/settings.html" style="color: #3A6746;">Settings</a>.
            </p>
        </div>

        <!-- Footer -->
        <div style="background: #f8f9fa; padding: 24px 32px; text-align: center; border-top: 1px solid #e8e8e8;">
            <p style="color: #888; font-size: 12px; margin: 0;">
                PathSynch - AI-Powered Pitch Generation<br>
                <a href="https://pathsynch-pitch-creation.web.app" style="color: #3A6746;">pathsynch-pitch-creation.web.app</a>
            </p>
        </div>
    </div>
</body>
</html>
    `;

    const msg = {
        to,
        from: {
            email: FROM_EMAIL,
            name: FROM_NAME
        },
        subject: `Welcome to PathSynch ${planName}!`,
        html
    };

    try {
        await sgMail.send(msg);
        return { success: true, message: 'Subscription email sent' };
    } catch (error) {
        console.error('SendGrid error:', error.response?.body || error.message);
        return { success: false, error: error.message };
    }
}

module.exports = {
    sendMarketReportEmail,
    sendPitchEmail,
    sendLeadNurtureEmail,
    sendWelcomeEmail,
    sendTeamInviteEmail,
    sendBulkJobCompleteEmail,
    sendPitchCompleteEmail,
    sendSubscriptionEmail
};
