/**
 * Email Digest Scheduled Functions
 *
 * Sends daily and weekly email digests to users
 * who have enabled the feature.
 */

const admin = require('firebase-admin');
const sgMail = require('@sendgrid/mail');

// Initialize SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const db = admin.firestore();

const FROM_EMAIL = 'hello@synchintro.ai';
const FROM_NAME = 'SynchIntro';

/**
 * Get yesterday's date key (YYYY-MM-DD)
 */
function getYesterdayKey() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
}

/**
 * Get date range for weekly digest (last 7 days)
 */
function getWeeklyDateRange() {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 7);
    return {
        start,
        end,
        startKey: start.toISOString().split('T')[0],
        endKey: end.toISOString().split('T')[0]
    };
}

/**
 * Format a date for display
 */
function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * Get daily activity summary for a user
 */
async function getDailyActivitySummary(userId, dateKey) {
    const activities = await db.collection('users').doc(userId)
        .collection('activityFeed')
        .where('dateKey', '==', dateKey)
        .get();

    const summary = {
        totalViews: 0,
        totalShares: 0,
        totalClicks: 0,
        topPitches: {}
    };

    activities.docs.forEach(doc => {
        const data = doc.data();

        if (data.type === 'view') summary.totalViews++;
        else if (data.type === 'share') summary.totalShares++;
        else if (data.type === 'cta_click') summary.totalClicks++;

        // Track top pitches
        if (!summary.topPitches[data.pitchId]) {
            summary.topPitches[data.pitchId] = {
                pitchId: data.pitchId,
                prospectBusiness: data.prospectBusiness,
                views: 0,
                shares: 0,
                clicks: 0
            };
        }

        if (data.type === 'view') summary.topPitches[data.pitchId].views++;
        else if (data.type === 'share') summary.topPitches[data.pitchId].shares++;
        else if (data.type === 'cta_click') summary.topPitches[data.pitchId].clicks++;
    });

    // Convert to sorted array
    summary.topPitchesArray = Object.values(summary.topPitches)
        .sort((a, b) => (b.views + b.shares + b.clicks) - (a.views + a.shares + a.clicks))
        .slice(0, 5);

    return summary;
}

/**
 * Get weekly activity summary for a user with creation stats
 */
async function getWeeklyActivitySummary(userId) {
    const range = getWeeklyDateRange();

    const activities = await db.collection('users').doc(userId)
        .collection('activityFeed')
        .where('timestamp', '>=', range.start)
        .where('timestamp', '<=', range.end)
        .get();

    const summary = {
        period: {
            start: range.startKey,
            end: range.endKey
        },
        totalViews: 0,
        totalShares: 0,
        totalClicks: 0,
        dailyBreakdown: {},
        topPitches: {},
        // New fields for creation stats
        pitchesCreated: 0,
        onePagersCreated: 0,
        landingPagesCreated: 0,
        suggestedActions: []
    };

    activities.docs.forEach(doc => {
        const data = doc.data();
        const dateKey = data.dateKey;

        // Daily breakdown
        if (!summary.dailyBreakdown[dateKey]) {
            summary.dailyBreakdown[dateKey] = { views: 0, shares: 0, clicks: 0 };
        }

        if (data.type === 'view') {
            summary.totalViews++;
            summary.dailyBreakdown[dateKey].views++;
        } else if (data.type === 'share') {
            summary.totalShares++;
            summary.dailyBreakdown[dateKey].shares++;
        } else if (data.type === 'cta_click') {
            summary.totalClicks++;
            summary.dailyBreakdown[dateKey].clicks++;
        }

        // Track top pitches
        if (!summary.topPitches[data.pitchId]) {
            summary.topPitches[data.pitchId] = {
                pitchId: data.pitchId,
                prospectBusiness: data.prospectBusiness,
                views: 0,
                shares: 0,
                clicks: 0
            };
        }

        if (data.type === 'view') summary.topPitches[data.pitchId].views++;
        else if (data.type === 'share') summary.topPitches[data.pitchId].shares++;
        else if (data.type === 'cta_click') summary.topPitches[data.pitchId].clicks++;
    });

    // Get creation stats for the week
    try {
        // Pitches created
        const pitchesSnapshot = await db.collection('pitches')
            .where('userId', '==', userId)
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(range.start))
            .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(range.end))
            .get();
        summary.pitchesCreated = pitchesSnapshot.size;

        // Count L2 one-pagers
        summary.onePagersCreated = pitchesSnapshot.docs.filter(doc => {
            const level = doc.data().pitchLevel || doc.data().level;
            return level === 2;
        }).length;

        // Landing pages created
        const landingPagesSnapshot = await db.collection('landingPages')
            .where('userId', '==', userId)
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(range.start))
            .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(range.end))
            .get();
        summary.landingPagesCreated = landingPagesSnapshot.size;

        // Generate suggested actions
        summary.suggestedActions = generateSuggestedActions(summary);
    } catch (error) {
        console.warn('Error getting creation stats:', error.message);
    }

    // Convert to sorted array
    summary.topPitchesArray = Object.values(summary.topPitches)
        .sort((a, b) => (b.views + b.shares + b.clicks) - (a.views + a.shares + a.clicks))
        .slice(0, 10);

    return summary;
}

/**
 * Generate suggested actions based on activity
 */
function generateSuggestedActions(summary) {
    const actions = [];

    // High engagement but no outcome
    if (summary.topPitchesArray.length > 0) {
        const topPitch = summary.topPitchesArray[0];
        if (topPitch.views >= 3 && topPitch.clicks === 0) {
            actions.push({
                type: 'follow_up',
                message: `${topPitch.prospectBusiness} viewed your pitch ${topPitch.views}x - time to follow up?`,
                pitchId: topPitch.pitchId
            });
        }
    }

    // Low activity suggestion
    if (summary.pitchesCreated === 0 && summary.totalViews < 5) {
        actions.push({
            type: 'create_content',
            message: 'Create a new pitch to engage more prospects this week'
        });
    }

    // One-pager conversion
    if (summary.pitchesCreated > 0 && summary.onePagersCreated === 0) {
        actions.push({
            type: 'upgrade_pitch',
            message: 'Try creating a One-Pager - they get 2x more engagement'
        });
    }

    // Landing page opportunity
    if (summary.totalViews >= 10 && summary.landingPagesCreated === 0) {
        actions.push({
            type: 'landing_page',
            message: 'Create personalized landing pages to boost conversions'
        });
    }

    return actions.slice(0, 3); // Max 3 suggestions
}

/**
 * Generate HTML for daily digest email
 */
function generateDailyDigestHtml(user, summary, dateKey) {
    const hasActivity = summary.totalViews > 0 || summary.totalShares > 0 || summary.totalClicks > 0;

    const pitchRows = summary.topPitchesArray.map(pitch => `
        <tr>
            <td style="padding: 12px; border-bottom: 1px solid #eee;">${pitch.prospectBusiness}</td>
            <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">${pitch.views}</td>
            <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">${pitch.shares}</td>
            <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">${pitch.clicks}</td>
        </tr>
    `).join('');

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #f5f5f5;">
    <div style="max-width: 600px; margin: 0 auto; background: white;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #0A9933 0%, #078a2c 100%); padding: 32px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Daily Activity Summary</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">
                ${formatDate(dateKey)}
            </p>
        </div>

        <!-- Body -->
        <div style="padding: 32px;">
            <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                Hi ${user.name || 'there'},
            </p>

            ${hasActivity ? `
            <!-- Stats Grid -->
            <div style="display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 32px;">
                <div style="flex: 1; min-width: 100px; background: #f8f9fa; border-radius: 8px; padding: 20px; text-align: center;">
                    <div style="font-size: 32px; font-weight: 700; color: #0A9933;">${summary.totalViews}</div>
                    <div style="font-size: 12px; color: #666; text-transform: uppercase;">Views</div>
                </div>
                <div style="flex: 1; min-width: 100px; background: #f8f9fa; border-radius: 8px; padding: 20px; text-align: center;">
                    <div style="font-size: 32px; font-weight: 700; color: #0A9933;">${summary.totalShares}</div>
                    <div style="font-size: 12px; color: #666; text-transform: uppercase;">Shares</div>
                </div>
                <div style="flex: 1; min-width: 100px; background: #f8f9fa; border-radius: 8px; padding: 20px; text-align: center;">
                    <div style="font-size: 32px; font-weight: 700; color: #0A9933;">${summary.totalClicks}</div>
                    <div style="font-size: 12px; color: #666; text-transform: uppercase;">CTA Clicks</div>
                </div>
            </div>

            ${summary.topPitchesArray.length > 0 ? `
            <!-- Top Pitches Table -->
            <h3 style="font-size: 16px; margin: 0 0 16px 0; color: #333;">Top Performing Pitches</h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <thead>
                    <tr style="background: #f8f9fa;">
                        <th style="padding: 12px; text-align: left; font-weight: 600;">Prospect</th>
                        <th style="padding: 12px; text-align: center; font-weight: 600;">Views</th>
                        <th style="padding: 12px; text-align: center; font-weight: 600;">Shares</th>
                        <th style="padding: 12px; text-align: center; font-weight: 600;">Clicks</th>
                    </tr>
                </thead>
                <tbody>
                    ${pitchRows}
                </tbody>
            </table>
            ` : ''}
            ` : `
            <div style="text-align: center; padding: 40px 20px; background: #f8f9fa; border-radius: 8px;">
                <p style="color: #666; margin: 0; font-size: 16px;">No activity yesterday</p>
                <p style="color: #999; margin: 8px 0 0 0; font-size: 14px;">Share your pitches to start tracking engagement</p>
            </div>
            `}

            <!-- CTA Button -->
            <div style="text-align: center; margin: 32px 0;">
                <a href="https://synchintro.ai/#analytics"
                   style="display: inline-block; background: #0A9933; color: white; padding: 14px 32px;
                          border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                    View Full Analytics
                </a>
            </div>
        </div>

        <!-- Footer -->
        <div style="background: #f8f9fa; padding: 24px 32px; text-align: center; border-top: 1px solid #e8e8e8;">
            <p style="color: #888; font-size: 12px; margin: 0 0 8px 0;">
                You're receiving this because you enabled daily digests.
            </p>
            <p style="color: #888; font-size: 12px; margin: 0;">
                <a href="https://synchintro.ai/#settings" style="color: #0A9933;">Manage preferences</a> |
                <a href="https://synchintro.ai" style="color: #0A9933;">synchintro.ai</a>
            </p>
        </div>
    </div>
</body>
</html>
    `;
}

/**
 * Generate HTML for weekly digest email
 */
function generateWeeklyDigestHtml(user, summary) {
    const hasActivity = summary.totalViews > 0 || summary.totalShares > 0 || summary.totalClicks > 0;
    const hasCreations = (summary.pitchesCreated || 0) > 0 || (summary.landingPagesCreated || 0) > 0;

    const pitchRows = summary.topPitchesArray.map(pitch => `
        <tr>
            <td style="padding: 12px; border-bottom: 1px solid #eee;">${pitch.prospectBusiness}</td>
            <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">${pitch.views}</td>
            <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">${pitch.shares}</td>
            <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">${pitch.clicks}</td>
        </tr>
    `).join('');

    const suggestedActionsHtml = (summary.suggestedActions || []).map(action => `
        <li style="padding: 8px 0; border-bottom: 1px solid #eee;">
            ${action.message}
        </li>
    `).join('');

    // Generate mini bar chart for daily breakdown
    const maxDailyViews = Math.max(...Object.values(summary.dailyBreakdown).map(d => d.views), 1);
    const dailyBars = Object.entries(summary.dailyBreakdown)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => {
            const height = Math.max(4, (data.views / maxDailyViews) * 40);
            const dayLabel = new Date(date).toLocaleDateString('en-US', { weekday: 'short' });
            return `
                <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
                    <div style="width: 24px; height: ${height}px; background: #0A9933; border-radius: 2px;"></div>
                    <span style="font-size: 10px; color: #666;">${dayLabel}</span>
                </div>
            `;
        }).join('');

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #f5f5f5;">
    <div style="max-width: 600px; margin: 0 auto; background: white;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #0A9933 0%, #078a2c 100%); padding: 32px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Weekly Activity Report</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">
                ${formatDate(summary.period.start)} - ${formatDate(summary.period.end)}
            </p>
        </div>

        <!-- Body -->
        <div style="padding: 32px;">
            <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                Hi ${user.name || 'there'}, here's your weekly pitch performance summary.
            </p>

            <!-- Your Activity This Week -->
            <h3 style="font-size: 16px; margin: 0 0 16px 0; color: #333;">Your Activity This Week</h3>
            <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px;">
                <div style="flex: 1; min-width: 80px; background: #e8f5e9; border-radius: 8px; padding: 16px; text-align: center;">
                    <div style="font-size: 28px; font-weight: 700; color: #2e7d32;">${summary.pitchesCreated || 0}</div>
                    <div style="font-size: 11px; color: #666; text-transform: uppercase;">Pitches Created</div>
                </div>
                <div style="flex: 1; min-width: 80px; background: #e3f2fd; border-radius: 8px; padding: 16px; text-align: center;">
                    <div style="font-size: 28px; font-weight: 700; color: #1565c0;">${summary.onePagersCreated || 0}</div>
                    <div style="font-size: 11px; color: #666; text-transform: uppercase;">One-Pagers</div>
                </div>
                <div style="flex: 1; min-width: 80px; background: #fce4ec; border-radius: 8px; padding: 16px; text-align: center;">
                    <div style="font-size: 28px; font-weight: 700; color: #c62828;">${summary.landingPagesCreated || 0}</div>
                    <div style="font-size: 11px; color: #666; text-transform: uppercase;">Landing Pages</div>
                </div>
            </div>

            ${hasActivity ? `
            <!-- Engagement Stats -->
            <h3 style="font-size: 16px; margin: 0 0 16px 0; color: #333;">Engagement Stats</h3>
            <div style="display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 32px;">
                <div style="flex: 1; min-width: 100px; background: #f8f9fa; border-radius: 8px; padding: 20px; text-align: center;">
                    <div style="font-size: 36px; font-weight: 700; color: #0A9933;">${summary.totalViews}</div>
                    <div style="font-size: 12px; color: #666; text-transform: uppercase;">Total Views</div>
                </div>
                <div style="flex: 1; min-width: 100px; background: #f8f9fa; border-radius: 8px; padding: 20px; text-align: center;">
                    <div style="font-size: 36px; font-weight: 700; color: #0A9933;">${summary.totalShares}</div>
                    <div style="font-size: 12px; color: #666; text-transform: uppercase;">Total Shares</div>
                </div>
                <div style="flex: 1; min-width: 100px; background: #f8f9fa; border-radius: 8px; padding: 20px; text-align: center;">
                    <div style="font-size: 36px; font-weight: 700; color: #0A9933;">${summary.totalClicks}</div>
                    <div style="font-size: 12px; color: #666; text-transform: uppercase;">CTA Clicks</div>
                </div>
            </div>

            <!-- Daily Activity Chart -->
            <h3 style="font-size: 16px; margin: 0 0 16px 0; color: #333;">Daily Views</h3>
            <div style="display: flex; justify-content: space-between; align-items: flex-end; height: 60px; padding: 8px; background: #f8f9fa; border-radius: 8px; margin-bottom: 32px;">
                ${dailyBars}
            </div>

            ${summary.topPitchesArray.length > 0 ? `
            <!-- Top Pitches Table -->
            <h3 style="font-size: 16px; margin: 0 0 16px 0; color: #333;">Top Performing Pitches</h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <thead>
                    <tr style="background: #f8f9fa;">
                        <th style="padding: 12px; text-align: left; font-weight: 600;">Prospect</th>
                        <th style="padding: 12px; text-align: center; font-weight: 600;">Views</th>
                        <th style="padding: 12px; text-align: center; font-weight: 600;">Shares</th>
                        <th style="padding: 12px; text-align: center; font-weight: 600;">Clicks</th>
                    </tr>
                </thead>
                <tbody>
                    ${pitchRows}
                </tbody>
            </table>
            ` : ''}

            ${suggestedActionsHtml ? `
            <!-- Suggested Actions -->
            <div style="margin-top: 32px; padding: 20px; background: #fff8e1; border-radius: 8px; border-left: 4px solid #ffc107;">
                <h3 style="font-size: 14px; margin: 0 0 12px 0; color: #f57c00;">Suggested Actions</h3>
                <ul style="margin: 0; padding: 0 0 0 16px; color: #333; font-size: 14px;">
                    ${suggestedActionsHtml}
                </ul>
            </div>
            ` : ''}
            ` : `
            <div style="text-align: center; padding: 40px 20px; background: #f8f9fa; border-radius: 8px;">
                <p style="color: #666; margin: 0; font-size: 16px;">No engagement activity this week</p>
                <p style="color: #999; margin: 8px 0 0 0; font-size: 14px;">Share your pitches to start tracking engagement</p>
            </div>
            `}

            <!-- CTA Button -->
            <div style="text-align: center; margin: 32px 0;">
                <a href="https://synchintro.ai/#analytics"
                   style="display: inline-block; background: #0A9933; color: white; padding: 14px 32px;
                          border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                    View Full Analytics
                </a>
            </div>
        </div>

        <!-- Footer -->
        <div style="background: #f8f9fa; padding: 24px 32px; text-align: center; border-top: 1px solid #e8e8e8;">
            <p style="color: #888; font-size: 12px; margin: 0 0 8px 0;">
                You're receiving this because you enabled weekly reports.
            </p>
            <p style="color: #888; font-size: 12px; margin: 0;">
                <a href="https://synchintro.ai/#settings" style="color: #0A9933;">Manage preferences</a> |
                <a href="https://synchintro.ai" style="color: #0A9933;">synchintro.ai</a>
            </p>
        </div>
    </div>
</body>
</html>
    `;
}

/**
 * Send daily digest to all opted-in users
 * Should be run via Cloud Scheduler at 8am daily
 */
async function sendDailyDigests() {
    console.log('Starting daily digest send...');

    const dateKey = getYesterdayKey();

    // Find users with daily digest enabled
    const usersSnapshot = await db.collection('users')
        .where('notificationSettings.emailDigest', '==', 'daily')
        .get();

    console.log(`Found ${usersSnapshot.size} users with daily digest enabled`);

    let sentCount = 0;
    let errorCount = 0;

    for (const userDoc of usersSnapshot.docs) {
        try {
            const user = userDoc.data();
            const userId = userDoc.id;

            if (!user.email) {
                console.log(`Skipping user ${userId}: no email`);
                continue;
            }

            // Get activity summary
            const summary = await getDailyActivitySummary(userId, dateKey);

            // Generate and send email
            const html = generateDailyDigestHtml(user, summary, dateKey);

            await sgMail.send({
                to: user.email,
                from: { email: FROM_EMAIL, name: FROM_NAME },
                subject: `Your Daily Pitch Activity - ${formatDate(dateKey)}`,
                html
            });

            sentCount++;
            console.log(`Sent daily digest to ${user.email}`);
        } catch (error) {
            errorCount++;
            console.error(`Failed to send digest to user ${userDoc.id}:`, error.message);
        }
    }

    console.log(`Daily digest complete: ${sentCount} sent, ${errorCount} errors`);
    return { sentCount, errorCount };
}

/**
 * Send weekly digest to all opted-in users
 * Should be run via Cloud Scheduler every Monday at 8am
 */
async function sendWeeklyDigests() {
    console.log('Starting weekly digest send...');

    // Find users with weekly digest enabled
    const usersSnapshot = await db.collection('users')
        .where('notificationSettings.emailDigest', '==', 'weekly')
        .get();

    console.log(`Found ${usersSnapshot.size} users with weekly digest enabled`);

    let sentCount = 0;
    let errorCount = 0;

    for (const userDoc of usersSnapshot.docs) {
        try {
            const user = userDoc.data();
            const userId = userDoc.id;

            if (!user.email) {
                console.log(`Skipping user ${userId}: no email`);
                continue;
            }

            // Get activity summary
            const summary = await getWeeklyActivitySummary(userId);

            // Generate and send email
            const html = generateWeeklyDigestHtml(user, summary);

            await sgMail.send({
                to: user.email,
                from: { email: FROM_EMAIL, name: FROM_NAME },
                subject: `Your Weekly Pitch Report - ${formatDate(summary.period.start)} to ${formatDate(summary.period.end)}`,
                html
            });

            sentCount++;
            console.log(`Sent weekly digest to ${user.email}`);
        } catch (error) {
            errorCount++;
            console.error(`Failed to send digest to user ${userDoc.id}:`, error.message);
        }
    }

    console.log(`Weekly digest complete: ${sentCount} sent, ${errorCount} errors`);
    return { sentCount, errorCount };
}

/**
 * Clean up old activity entries (30-day retention)
 */
async function cleanupOldActivities() {
    console.log('Starting activity cleanup...');

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);

    const usersSnapshot = await db.collection('users').get();

    let totalDeleted = 0;

    for (const userDoc of usersSnapshot.docs) {
        try {
            const oldActivities = await db.collection('users').doc(userDoc.id)
                .collection('activityFeed')
                .where('timestamp', '<', cutoffDate)
                .limit(100)
                .get();

            if (!oldActivities.empty) {
                const batch = db.batch();
                oldActivities.docs.forEach(doc => batch.delete(doc.ref));
                await batch.commit();
                totalDeleted += oldActivities.size;
            }
        } catch (error) {
            console.error(`Failed to cleanup activities for user ${userDoc.id}:`, error.message);
        }
    }

    console.log(`Activity cleanup complete: ${totalDeleted} entries deleted`);
    return { deletedCount: totalDeleted };
}

module.exports = {
    sendDailyDigests,
    sendWeeklyDigests,
    cleanupOldActivities,
    getDailyActivitySummary,
    getWeeklyActivitySummary
};
