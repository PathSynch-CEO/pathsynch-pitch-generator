/**
 * Instantly Client (Market Intel Flow)
 *
 * Pushes Market Intel leads to Instantly campaigns with Intel Signal personalization.
 * Uses global INSTANTLY_API_KEY from .env (NOT per-user keys from Firestore).
 *
 * Note: This is separate from instantlyService.js which uses per-user API keys
 * for the pre-call brief → Instantly integration.
 *
 * Env: INSTANTLY_API_KEY (required, in .env only — NOT in Firebase secrets[])
 */

const INSTANTLY_API_BASE = 'https://api.instantly.ai/api/v1';

/**
 * Fetch available campaigns from Instantly
 */
async function getInstantlyCampaigns() {
    if (!process.env.INSTANTLY_API_KEY) {
        throw new Error('INSTANTLY_API_KEY not configured');
    }

    const resp = await fetch(
        `${INSTANTLY_API_BASE}/campaign/list?api_key=${encodeURIComponent(process.env.INSTANTLY_API_KEY)}&limit=20`
    );

    if (!resp.ok) throw new Error(`Instantly API error: ${resp.status}`);
    return resp.json();
}

/**
 * Push a lead to an Instantly campaign with Intel Signal personalization
 */
async function pushLeadToInstantly(lead, campaignId, report) {
    if (!process.env.INSTANTLY_API_KEY) {
        throw new Error('INSTANTLY_API_KEY not configured');
    }

    // Build personalization variables from Intel Signal
    const intelLines = (lead.intelSignal || '').split('\n');
    const nameParts = (lead.decisionMaker?.name || lead.name || '').split(' ');

    const contact = {
        email: lead.email || lead.decisionMaker?.email || null,
        first_name: nameParts[0] || '',
        last_name: nameParts.slice(1).join(' ') || '',
        company_name: lead.name,
        website: lead.website || '',
        custom_variables: {
            custom_1: intelLines[0] || '',
            custom_2: `${lead.rating || 'N/A'}\u2605`,
            custom_3: `${lead.reviewCount || lead.reviews || 0}`,
            custom_4: report.marketLeader || '',
            custom_5: lead.decisionMaker?.title || 'Owner',
            custom_6: lead.sentiment?.praiseThemes?.[0] || '',
            custom_7: `${report.city || ''} ${report.industry || ''}`
        }
    };

    // Skip if no email
    if (!contact.email) {
        return { success: false, skipped: true, reason: 'no_email', businessName: lead.name };
    }

    const resp = await fetch(`${INSTANTLY_API_BASE}/lead/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            api_key: process.env.INSTANTLY_API_KEY,
            campaign_id: campaignId,
            skip_if_in_workspace: true,
            leads: [contact]
        })
    });

    if (!resp.ok) throw new Error(`Instantly push failed for ${lead.name}`);
    return { success: true, businessName: lead.name };
}

/**
 * Push multiple leads to an Instantly campaign
 */
async function pushLeadsToInstantly(leads, campaignId, report) {
    const results = { added: [], skipped: [], failed: [] };

    for (const lead of leads) {
        try {
            const result = await pushLeadToInstantly(lead, campaignId, report);
            if (result.skipped) {
                results.skipped.push(result);
            } else {
                results.added.push(result);
            }
        } catch (e) {
            results.failed.push({ businessName: lead.name, error: e.message });
        }
    }

    return results;
}

module.exports = { getInstantlyCampaigns, pushLeadToInstantly, pushLeadsToInstantly };
