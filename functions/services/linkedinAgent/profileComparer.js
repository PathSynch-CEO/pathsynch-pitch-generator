/**
 * Profile Comparer
 *
 * Compares seller and prospect LinkedIn profiles to find commonalities.
 * These commonalities are used to generate rapport hooks for sales calls.
 */

/**
 * Fields that can be compared between profiles
 */
const COMPARISON_FIELDS = {
    LOCATION: 'location',
    EDUCATION: 'education',
    CAREER: 'career',
    SKILLS: 'skills',
    INTERESTS: 'interests',
    INDUSTRY: 'industry',
    CAUSES: 'causes',
};

/**
 * Match types returned by comparison
 */
const MATCH_TYPES = {
    EXACT: 'exact',       // Same city, same school, same company
    PARTIAL: 'partial',   // Same state, similar field, related industry
    RELATED: 'related',   // Same metro area, competitor company, adjacent skill
};

/**
 * Compare seller and prospect profiles
 *
 * @param {object} sellerProfile - Seller's LinkedIn profile
 * @param {object} prospectProfile - Prospect's enriched data
 * @returns {object} Comparison results with matches
 */
function compareProfiles(sellerProfile, prospectProfile) {
    const matches = [];
    const partialMatches = [];

    // 1. Location comparison
    const locationMatch = compareLocation(sellerProfile, prospectProfile);
    if (locationMatch) {
        if (locationMatch.type === MATCH_TYPES.EXACT) {
            matches.push(locationMatch);
        } else {
            partialMatches.push(locationMatch);
        }
    }

    // 2. Education comparison
    const educationMatches = compareEducation(sellerProfile, prospectProfile);
    for (const match of educationMatches) {
        if (match.type === MATCH_TYPES.EXACT) {
            matches.push(match);
        } else {
            partialMatches.push(match);
        }
    }

    // 3. Career/company comparison
    const careerMatches = compareCareer(sellerProfile, prospectProfile);
    for (const match of careerMatches) {
        if (match.type === MATCH_TYPES.EXACT) {
            matches.push(match);
        } else {
            partialMatches.push(match);
        }
    }

    // 4. Industry comparison
    const industryMatch = compareIndustry(sellerProfile, prospectProfile);
    if (industryMatch) {
        if (industryMatch.type === MATCH_TYPES.EXACT) {
            matches.push(industryMatch);
        } else {
            partialMatches.push(industryMatch);
        }
    }

    // 5. Skills comparison
    const skillMatches = compareSkills(sellerProfile, prospectProfile);
    for (const match of skillMatches) {
        matches.push(match);
    }

    // 6. Interests comparison
    const interestMatches = compareInterests(sellerProfile, prospectProfile);
    for (const match of interestMatches) {
        matches.push(match);
    }

    // Calculate overall match score
    const matchScore = calculateMatchScore(matches, partialMatches);

    return {
        matches,
        partialMatches,
        matchScore,
        hasStrongMatch: matches.length > 0,
        summary: generateMatchSummary(matches, partialMatches),
    };
}

/**
 * Compare locations between profiles
 */
function compareLocation(seller, prospect) {
    const sellerCity = normalizeString(seller.location?.city);
    const sellerState = normalizeString(seller.location?.state);
    const sellerMetro = normalizeString(seller.location?.metro);

    // Get prospect location from various possible fields
    let prospectCity = null;
    let prospectState = null;

    if (prospect.location) {
        if (typeof prospect.location === 'object') {
            prospectCity = normalizeString(prospect.location.city);
            prospectState = normalizeString(prospect.location.state);
        } else if (typeof prospect.location === 'string') {
            const parsed = parseLocationString(prospect.location);
            prospectCity = parsed.city;
            prospectState = parsed.state;
        }
    }

    // Also check direct city field
    if (!prospectCity && prospect.city) {
        prospectCity = normalizeString(prospect.city);
    }

    // Check company address
    if (!prospectCity && prospect.address) {
        const parsed = parseLocationString(prospect.address);
        prospectCity = parsed.city;
        prospectState = parsed.state;
    }

    if (!sellerCity && !sellerMetro) return null;
    if (!prospectCity) return null;

    // Exact city match
    if (sellerCity && prospectCity && sellerCity === prospectCity) {
        return {
            field: COMPARISON_FIELDS.LOCATION,
            type: MATCH_TYPES.EXACT,
            sellerValue: seller.location?.city,
            prospectValue: prospectCity,
            description: `Both based in ${seller.location?.city}`,
            rapportPotential: 'high',
        };
    }

    // Same state
    if (sellerState && prospectState && sellerState === prospectState) {
        return {
            field: COMPARISON_FIELDS.LOCATION,
            type: MATCH_TYPES.PARTIAL,
            sellerValue: seller.location?.state,
            prospectValue: prospectState,
            description: `Both in ${seller.location?.state}`,
            rapportPotential: 'medium',
        };
    }

    // Metro area match
    if (sellerMetro && prospectCity) {
        const metroLower = sellerMetro.toLowerCase();
        if (metroLower.includes(prospectCity.toLowerCase())) {
            return {
                field: COMPARISON_FIELDS.LOCATION,
                type: MATCH_TYPES.RELATED,
                sellerValue: sellerMetro,
                prospectValue: prospectCity,
                description: `Both in the ${sellerMetro}`,
                rapportPotential: 'medium',
            };
        }
    }

    return null;
}

/**
 * Compare education between profiles
 */
function compareEducation(seller, prospect) {
    const matches = [];

    if (!seller.education?.length) return matches;

    const prospectEducation = normalizeString(
        typeof prospect.education === 'string'
            ? prospect.education
            : prospect.education?.school || prospect.education?.[0]?.school || ''
    );

    if (!prospectEducation) return matches;

    for (const edu of seller.education) {
        const sellerSchool = normalizeString(edu.school || edu.institution || edu.raw);
        if (!sellerSchool) continue;

        // Check for school name match
        if (prospectEducation.includes(sellerSchool) || sellerSchool.includes(prospectEducation)) {
            matches.push({
                field: COMPARISON_FIELDS.EDUCATION,
                type: MATCH_TYPES.EXACT,
                sellerValue: edu.school || sellerSchool,
                prospectValue: prospectEducation,
                description: `Both attended ${edu.school || sellerSchool}`,
                rapportPotential: 'very_high',
            });
        }
    }

    return matches;
}

/**
 * Compare career history between profiles
 */
function compareCareer(seller, prospect) {
    const matches = [];

    if (!seller.careerHistory?.length) return matches;
    if (!prospect.careerHistory?.length) return matches;

    const sellerCompanies = seller.careerHistory.map(c =>
        normalizeString(c.company || c.name || c.raw)
    ).filter(Boolean);

    const prospectCompanies = prospect.careerHistory.map(c =>
        normalizeString(typeof c === 'string' ? c : c.company || c.name || c.raw)
    ).filter(Boolean);

    // Find shared companies
    for (const sellerCompany of sellerCompanies) {
        for (const prospectCompany of prospectCompanies) {
            if (companiesMatch(sellerCompany, prospectCompany)) {
                // Find the original company name
                const sellerOriginal = seller.careerHistory.find(c =>
                    normalizeString(c.company || c.name) === sellerCompany
                );

                matches.push({
                    field: COMPARISON_FIELDS.CAREER,
                    type: MATCH_TYPES.EXACT,
                    sellerValue: sellerOriginal?.company || sellerCompany,
                    prospectValue: prospectCompany,
                    description: `Both worked at ${sellerOriginal?.company || sellerCompany}`,
                    rapportPotential: 'very_high',
                });
            }
        }
    }

    return matches;
}

/**
 * Check if two company names refer to the same company
 */
function companiesMatch(company1, company2) {
    if (!company1 || !company2) return false;

    const c1 = company1.toLowerCase();
    const c2 = company2.toLowerCase();

    // Direct match
    if (c1 === c2) return true;

    // One contains the other (e.g., "Google" vs "Google Inc.")
    if (c1.includes(c2) || c2.includes(c1)) return true;

    // Remove common suffixes and compare
    const suffixes = [' inc', ' llc', ' corp', ' corporation', ' ltd', ' limited', ' co', ' company'];
    let c1Clean = c1;
    let c2Clean = c2;

    for (const suffix of suffixes) {
        c1Clean = c1Clean.replace(suffix, '');
        c2Clean = c2Clean.replace(suffix, '');
    }

    return c1Clean.trim() === c2Clean.trim();
}

/**
 * Compare industries
 */
function compareIndustry(seller, prospect) {
    const sellerIndustry = normalizeString(seller.currentIndustry || seller.industry);
    const prospectIndustry = normalizeString(
        prospect.industry || prospect.prospectIndustry || prospect.companyIndustry
    );

    if (!sellerIndustry || !prospectIndustry) return null;

    // Exact match
    if (sellerIndustry === prospectIndustry) {
        return {
            field: COMPARISON_FIELDS.INDUSTRY,
            type: MATCH_TYPES.EXACT,
            sellerValue: seller.currentIndustry,
            prospectValue: prospectIndustry,
            description: `Both in ${seller.currentIndustry} industry`,
            rapportPotential: 'medium',
        };
    }

    // Check for related industries
    const relatedIndustries = getRelatedIndustries(sellerIndustry);
    if (relatedIndustries.includes(prospectIndustry)) {
        return {
            field: COMPARISON_FIELDS.INDUSTRY,
            type: MATCH_TYPES.RELATED,
            sellerValue: seller.currentIndustry,
            prospectValue: prospectIndustry,
            description: `Related industries: ${seller.currentIndustry} and ${prospectIndustry}`,
            rapportPotential: 'low',
        };
    }

    return null;
}

/**
 * Compare skills
 */
function compareSkills(seller, prospect) {
    const matches = [];

    if (!seller.skills?.length) return matches;

    const prospectSkills = prospect.skills || [];
    const prospectText = [
        prospect.summary || '',
        prospect.headline || '',
        ...(prospect.careerHistory || []).map(c => typeof c === 'string' ? c : c.title || ''),
    ].join(' ').toLowerCase();

    for (const skill of seller.skills) {
        const skillLower = skill.toLowerCase();
        if (prospectSkills.some(ps => ps.toLowerCase() === skillLower) ||
            prospectText.includes(skillLower)) {
            matches.push({
                field: COMPARISON_FIELDS.SKILLS,
                type: MATCH_TYPES.EXACT,
                sellerValue: skill,
                prospectValue: skill,
                description: `Shared skill: ${skill}`,
                rapportPotential: 'medium',
            });
        }
    }

    return matches.slice(0, 3); // Limit to top 3 skill matches
}

/**
 * Compare interests
 */
function compareInterests(seller, prospect) {
    const matches = [];

    if (!seller.interests?.length) return matches;

    const prospectInterests = prospect.interests || [];
    const prospectText = (prospect.summary || '').toLowerCase();

    for (const interest of seller.interests) {
        const interestLower = interest.toLowerCase();
        if (prospectInterests.some(pi => pi.toLowerCase().includes(interestLower)) ||
            prospectText.includes(interestLower)) {
            matches.push({
                field: COMPARISON_FIELDS.INTERESTS,
                type: MATCH_TYPES.EXACT,
                sellerValue: interest,
                prospectValue: interest,
                description: `Shared interest: ${interest}`,
                rapportPotential: 'high',
            });
        }
    }

    return matches.slice(0, 2); // Limit to top 2 interest matches
}

/**
 * Get related industries for partial matching
 */
function getRelatedIndustries(industry) {
    const industryGroups = {
        'technology': ['software', 'saas', 'tech', 'it', 'information technology', 'fintech', 'healthtech'],
        'software': ['technology', 'saas', 'tech', 'it services'],
        'finance': ['banking', 'financial services', 'insurance', 'fintech', 'investment'],
        'healthcare': ['medical', 'health', 'pharma', 'biotech', 'healthtech'],
        'retail': ['ecommerce', 'e-commerce', 'consumer goods', 'cpg'],
        'manufacturing': ['industrial', 'production', 'automotive'],
        'consulting': ['professional services', 'advisory', 'management consulting'],
    };

    const lower = industry.toLowerCase();

    for (const [key, related] of Object.entries(industryGroups)) {
        if (lower.includes(key) || related.some(r => lower.includes(r))) {
            return related;
        }
    }

    return [];
}

/**
 * Calculate overall match score
 */
function calculateMatchScore(matches, partialMatches) {
    const weights = {
        [COMPARISON_FIELDS.LOCATION]: { exact: 25, partial: 10 },
        [COMPARISON_FIELDS.EDUCATION]: { exact: 30, partial: 15 },
        [COMPARISON_FIELDS.CAREER]: { exact: 35, partial: 15 },
        [COMPARISON_FIELDS.INDUSTRY]: { exact: 15, partial: 5 },
        [COMPARISON_FIELDS.SKILLS]: { exact: 10, partial: 5 },
        [COMPARISON_FIELDS.INTERESTS]: { exact: 15, partial: 5 },
    };

    let score = 0;

    for (const match of matches) {
        const fieldWeight = weights[match.field] || { exact: 10 };
        score += fieldWeight.exact;
    }

    for (const match of partialMatches) {
        const fieldWeight = weights[match.field] || { partial: 5 };
        score += fieldWeight.partial;
    }

    return Math.min(100, score);
}

/**
 * Generate a summary of matches
 */
function generateMatchSummary(matches, partialMatches) {
    if (matches.length === 0 && partialMatches.length === 0) {
        return 'No obvious commonalities found. Focus on professional discovery.';
    }

    const summaryParts = [];

    // Prioritize high-value matches
    const locationMatch = matches.find(m => m.field === COMPARISON_FIELDS.LOCATION);
    const educationMatch = matches.find(m => m.field === COMPARISON_FIELDS.EDUCATION);
    const careerMatch = matches.find(m => m.field === COMPARISON_FIELDS.CAREER);

    if (educationMatch) {
        summaryParts.push(educationMatch.description);
    }

    if (careerMatch) {
        summaryParts.push(careerMatch.description);
    }

    if (locationMatch) {
        summaryParts.push(locationMatch.description);
    }

    if (summaryParts.length === 0) {
        const partialLocation = partialMatches.find(m => m.field === COMPARISON_FIELDS.LOCATION);
        if (partialLocation) {
            summaryParts.push(partialLocation.description);
        }
    }

    return summaryParts.join('. ') || 'Minor commonalities found.';
}

/**
 * Normalize string for comparison
 */
function normalizeString(str) {
    if (!str) return '';
    return str.toLowerCase().trim();
}

/**
 * Parse location string into city/state
 */
function parseLocationString(str) {
    if (!str) return {};

    const result = {};

    // "City, State" pattern
    const cityStateMatch = str.match(/^([^,]+),\s*([A-Z]{2})\b/i);
    if (cityStateMatch) {
        result.city = cityStateMatch[1].trim().toLowerCase();
        result.state = cityStateMatch[2].toUpperCase();
    } else {
        result.city = str.toLowerCase().trim();
    }

    return result;
}

module.exports = {
    COMPARISON_FIELDS,
    MATCH_TYPES,
    compareProfiles,
    compareLocation,
    compareEducation,
    compareCareer,
    compareIndustry,
    companiesMatch,
};
