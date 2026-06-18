/**
 * Lead Enrichment Service
 *
 * Queries existing prospect/account data by lead email for positive reply
 * event enrichment. Pulls fields from prospectIntel, Account360, and users
 * collections if available.
 *
 * Missing enrichment data never blocks the Slack alert — all fields have
 * graceful fallbacks.
 */

/**
 * Enrich lead data by email for a given tenant.
 *
 * Queries:
 * 1. prospectIntel batch prospects by email match
 * 2. Account360 by domain match (if email has domain)
 *
 * @param {Object} deps - Injected dependencies
 * @param {Object} deps.db - Firestore database instance
 * @param {string} tenantId - Firebase UID
 * @param {string} email - Lead email address
 * @returns {Promise<Object>} Enrichment data with graceful fallbacks
 */
async function enrichLead({ db }, tenantId, email) {
    const result = {
        companyName: null,
        contactName: null,
        contactEmail: email || null,
        industry: null,
        buyingSignals: [],
        fitScore: null,
        accountId: null,
        account360Url: null
    };

    if (!email || !tenantId) {
        return result;
    }

    const emailLower = email.toLowerCase().trim();
    const domain = extractDomain(emailLower);

    // Run enrichment queries in parallel — all are best-effort
    const queries = [];

    // Query 1: prospectIntel prospects by email
    queries.push(queryProspectIntel(db, tenantId, emailLower).catch(() => null));

    // Query 2: Account360 by domain (if non-generic domain)
    if (domain && !isGenericEmailDomain(domain)) {
        queries.push(queryAccount360(db, tenantId, domain).catch(() => null));
    } else {
        queries.push(Promise.resolve(null));
    }

    const [prospectData, accountData] = await Promise.all(queries);

    // Merge prospect data
    if (prospectData) {
        result.companyName = prospectData.companyName || result.companyName;
        result.contactName = prospectData.contactName || result.contactName;
        result.industry = prospectData.industry || result.industry;
        result.fitScore = prospectData.fitScore ?? result.fitScore;
        if (Array.isArray(prospectData.buyingSignals) && prospectData.buyingSignals.length > 0) {
            result.buyingSignals = prospectData.buyingSignals;
        }
    }

    // Merge Account360 data
    if (accountData) {
        result.companyName = result.companyName || accountData.companyName;
        result.accountId = accountData.accountId || result.accountId;
        result.industry = result.industry || accountData.industry;
        if (!result.fitScore && accountData.fitScore) {
            result.fitScore = accountData.fitScore;
        }
    }

    // Build Account360 URL only if accountId exists
    if (result.accountId) {
        result.account360Url = `https://app.pathsynch.com/account360/${result.accountId}`;
    }

    return result;
}

/**
 * Query prospectIntel batches for a prospect with matching email.
 */
async function queryProspectIntel(db, tenantId, email) {
    // Query prospect intel batches owned by this tenant
    const batchesSnap = await db.collection('prospectIntel')
        .where('userId', '==', tenantId)
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get();

    if (batchesSnap.empty) return null;

    // Search prospects in each batch for matching email
    for (const batchDoc of batchesSnap.docs) {
        const prospectsSnap = await db.collection('prospectIntel')
            .doc(batchDoc.id)
            .collection('prospects')
            .where('email', '==', email)
            .limit(1)
            .get();

        if (!prospectsSnap.empty) {
            const prospect = prospectsSnap.docs[0].data();
            return {
                companyName: prospect.businessName || prospect.companyName || null,
                contactName: prospect.contactName || prospect.ownerName || null,
                industry: prospect.industry || null,
                fitScore: prospect.fitScore ?? null,
                buyingSignals: prospect.signalHits || prospect.buyingSignals || []
            };
        }
    }

    return null;
}

/**
 * Query Account360 for an account matching the lead's domain.
 */
async function queryAccount360(db, tenantId, domain) {
    // Account360 accountKey format: tenantId:domain
    const accountKey = `${tenantId}:${domain}`;
    const accountDoc = await db.collection('Account360').doc(accountKey).get();

    if (!accountDoc.exists) return null;

    const data = accountDoc.data();
    return {
        companyName: data.companyName?.value || data.companyName || null,
        accountId: accountKey,
        industry: data.industry?.value || data.industry || null,
        fitScore: data.intentSignals?.currentScore ?? null
    };
}

/**
 * Extract domain from email address.
 */
function extractDomain(email) {
    if (!email || !email.includes('@')) return null;
    return email.split('@')[1].toLowerCase();
}

/**
 * Check if email domain is a generic provider (not useful for company lookup).
 */
function isGenericEmailDomain(domain) {
    const genericDomains = [
        'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
        'aol.com', 'icloud.com', 'mail.com', 'protonmail.com',
        'live.com', 'msn.com', 'ymail.com', 'zoho.com'
    ];
    return genericDomains.includes(domain);
}

module.exports = { enrichLead, extractDomain, isGenericEmailDomain };
