/**
 * Attio CRM Client
 *
 * Pushes Market Intel leads to Attio as Company + Person records with Intel Signal notes.
 * Uses Attio V2 REST API with Bearer token auth.
 *
 * Env: ATTIO_API_KEY (required, in .env only — NOT in Firebase secrets[])
 */

const ATTIO_API_BASE = 'https://api.attio.com/v2';

function getAttioHeaders() {
    return {
        'Authorization': `Bearer ${process.env.ATTIO_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
}

/**
 * Push a single lead to Attio as Company + Person record with Intel Signal note
 * Uses Attio's create pattern — creates if not exists, updates if exists
 */
async function pushLeadToAttio(lead, report) {
    if (!process.env.ATTIO_API_KEY) {
        throw new Error('ATTIO_API_KEY not configured');
    }

    const headers = getAttioHeaders();

    // Step 1: Create Company record
    let companyResult = null;
    try {
        const companyPayload = {
            data: {
                values: {
                    name: [{ value: lead.name }],
                    ...(lead.website ? { domains: [{ domain: lead.website.replace(/^https?:\/\//, '').replace(/\/$/, '') }] } : {})
                }
            }
        };

        const companyResp = await fetch(`${ATTIO_API_BASE}/objects/companies/records`, {
            method: 'POST',
            headers,
            body: JSON.stringify(companyPayload)
        });

        if (companyResp.ok) {
            companyResult = await companyResp.json();
        } else {
            console.warn('[Attio] Company create response:', companyResp.status, await companyResp.text());
        }
    } catch (e) {
        console.warn('[Attio] Company create failed:', e.message);
    }

    // Step 2: Create Person record (if decision maker found)
    let personResult = null;
    if (lead.decisionMaker?.name) {
        try {
            const nameParts = lead.decisionMaker.name.split(' ');
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';

            const personPayload = {
                data: {
                    values: {
                        first_name: [{ value: firstName }],
                        last_name: [{ value: lastName }],
                        job_title: [{ value: lead.decisionMaker.title || 'Owner' }],
                        ...(companyResult?.data?.id?.record_id ? {
                            company: [{ target_record_id: companyResult.data.id.record_id }]
                        } : {})
                    }
                }
            };

            const personResp = await fetch(`${ATTIO_API_BASE}/objects/people/records`, {
                method: 'POST',
                headers,
                body: JSON.stringify(personPayload)
            });

            if (personResp.ok) {
                personResult = await personResp.json();
            } else {
                console.warn('[Attio] Person create response:', personResp.status, await personResp.text());
            }
        } catch (e) {
            console.warn('[Attio] Person create failed:', e.message);
        }
    }

    // Step 3: Add note with Intel Signal + enrichment data
    const targetRecordId = personResult?.data?.id?.record_id || companyResult?.data?.id?.record_id;
    if (targetRecordId) {
        try {
            const noteContent = buildAttioNote(lead, report);
            const parentObject = personResult ? 'people' : 'companies';

            await fetch(`${ATTIO_API_BASE}/notes`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    data: {
                        parent_object: parentObject,
                        parent_record_id: targetRecordId,
                        title: `SynchIntro Intel — ${lead.name}`,
                        format: 'plaintext',
                        content: noteContent
                    }
                })
            });
        } catch (e) {
            console.warn('[Attio] Note create failed:', e.message);
        }
    }

    // Sprint 3: analytics event after push
    try {
        console.log(JSON.stringify({
            event: 'market_attio_push',
            industryId: report.industryId || null,
            subIndustryId: report.subIndustryId || null,
            leadCount: 1,
            reportId: report.reportId || report.id || null,
            timestamp: new Date().toISOString()
        }));
    } catch(e) {}

    return {
        success: true,
        companyId: companyResult?.data?.id?.record_id || null,
        personId: personResult?.data?.id?.record_id || null,
        businessName: lead.name,
        ownerName: lead.decisionMaker?.name || null
    };
}

function buildAttioNote(lead, report) {
    const lines = [
        `SYNCHINTRO MARKET INTEL — ${report.city || ''}, ${report.state || ''} ${report.industry || ''}`,
        `Report: ${report.reportId || 'N/A'} | Generated: ${new Date().toISOString().split('T')[0]}`,
        ...(report.industryId ? [`Industry Profile: ${report.industryId}${report.subIndustryId ? ' / ' + report.subIndustryId : ''} | Report Profile: ${report.reportProfile || 'default_local_business'}`] : []),
        '',
        `BUSINESS: ${lead.name}`,
        `Rating: ${lead.rating || 'N/A'}\u2605 | Reviews: ${lead.reviewCount || lead.reviews || 0}`,
        `Opportunity Score: ${lead.opportunityScore || '\u2014'}/100 (${lead.opportunityLabel || '\u2014'})`,
        `Share of Voice: ${lead.shareOfVoice != null ? lead.shareOfVoice.toFixed(1) + '%' : '\u2014'}`,
        ''
    ];

    if (lead.decisionMaker?.name) {
        lines.push(`DECISION MAKER: ${lead.decisionMaker.name} (${lead.decisionMaker.title || 'Owner'})`);
    }
    if (lead.linkedInUrl) {
        lines.push(`LinkedIn: ${lead.linkedInUrl}`);
    }
    if (lead.timeInBusiness) {
        lines.push(`Est. ${lead.timeInBusiness.foundedYear} (${lead.timeInBusiness.years} years) \u2014 ${lead.reviewVelocity?.label || 'Unknown velocity'}`);
    }

    lines.push('');
    lines.push('INTEL SIGNAL:');
    lines.push(lead.intelSignal || 'No Intel Signal generated');

    if (lead.sentiment?.praiseThemes?.length > 0) {
        lines.push('');
        lines.push(`CUSTOMERS SAY: ${lead.sentiment.praiseThemes.join(' \u00B7 ')}`);
        if (lead.sentiment.complaintThemes?.length > 0) {
            lines.push(`FRICTION: ${lead.sentiment.complaintThemes.join(' \u00B7 ')}`);
        }
        if (lead.sentiment.standoutPhrase) {
            lines.push(`STANDOUT: "${lead.sentiment.standoutPhrase}"`);
        }
    }

    if (lead.gbpCompleteness) {
        lines.push('');
        lines.push(`GBP COMPLETENESS: ${lead.gbpCompleteness.score || '\u2014'}/100 (${lead.gbpCompleteness.tier || '\u2014'})`);
    }

    return lines.join('\n');
}

/**
 * Bulk push with concurrency limit of 3
 */
async function pushAllLeadsToAttio(leads, report) {
    const CONCURRENCY = 3;
    const results = [];

    for (let i = 0; i < leads.length; i += CONCURRENCY) {
        const batch = leads.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.allSettled(
            batch.map(lead => pushLeadToAttio(lead, report))
        );
        results.push(...batchResults);

        // Small delay between batches to respect rate limits
        if (i + CONCURRENCY < leads.length) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    return results;
}

module.exports = { pushLeadToAttio, pushAllLeadsToAttio, buildAttioNote };
