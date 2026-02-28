/**
 * Rapport Hook Generator
 *
 * Transforms profile comparison matches into actionable rapport hooks
 * for sales conversations.
 */

const { COMPARISON_FIELDS, MATCH_TYPES } = require('./profileComparer');

/**
 * Categories of rapport hooks
 */
const RAPPORT_CATEGORIES = {
    LOCATION: 'location',
    EDUCATION: 'education',
    CAREER: 'career',
    INTERESTS: 'interests',
    INDUSTRY: 'industry',
    GENERAL: 'general',
};

/**
 * Generate rapport hooks from profile comparison results
 *
 * @param {object} comparison - Result from compareProfiles()
 * @param {object} sellerProfile - Seller's profile
 * @param {object} prospectProfile - Prospect's profile
 * @returns {Array} Array of rapport hooks
 */
function generateRapportHooks(comparison, sellerProfile, prospectProfile) {
    const hooks = [];

    // Process exact matches first (highest value)
    for (const match of comparison.matches) {
        const hook = createHookFromMatch(match, sellerProfile, prospectProfile);
        if (hook) {
            hooks.push(hook);
        }
    }

    // Add partial matches if we don't have enough hooks
    if (hooks.length < 3) {
        for (const match of comparison.partialMatches) {
            if (hooks.length >= 3) break;
            const hook = createHookFromMatch(match, sellerProfile, prospectProfile);
            if (hook) {
                hooks.push(hook);
            }
        }
    }

    // Sort by priority
    hooks.sort((a, b) => b.priority - a.priority);

    return hooks.slice(0, 5); // Return top 5 hooks
}

/**
 * Create a rapport hook from a match
 */
function createHookFromMatch(match, sellerProfile, prospectProfile) {
    switch (match.field) {
        case COMPARISON_FIELDS.LOCATION:
            return createLocationHook(match, sellerProfile);

        case COMPARISON_FIELDS.EDUCATION:
            return createEducationHook(match, sellerProfile);

        case COMPARISON_FIELDS.CAREER:
            return createCareerHook(match, sellerProfile, prospectProfile);

        case COMPARISON_FIELDS.INDUSTRY:
            return createIndustryHook(match, sellerProfile);

        case COMPARISON_FIELDS.SKILLS:
            return createSkillHook(match);

        case COMPARISON_FIELDS.INTERESTS:
            return createInterestHook(match);

        default:
            return null;
    }
}

/**
 * Create a location-based rapport hook
 */
function createLocationHook(match, sellerProfile) {
    const city = sellerProfile.location?.city || match.sellerValue;
    const isExact = match.type === MATCH_TYPES.EXACT;

    const openers = isExact ? [
        `I noticed you're also based in ${city} - I'm actually in ${city} as well.`,
        `Small world - I see you're in ${city}. I live there too.`,
        `Fellow ${city} local here! How long have you been in the area?`,
    ] : [
        `I see you're in ${match.prospectValue} - I'm actually nearby in ${city}.`,
        `We're practically neighbors - I'm based in ${city}.`,
    ];

    const followUps = isExact ? [
        `Have you been to any of the tech meetups in ${city}?`,
        `The business community in ${city} is pretty tight-knit.`,
        `Do you work from home or have an office in ${city}?`,
    ] : [
        `Do you ever get up to ${city} for events?`,
        `The ${match.sellerValue} area has a lot going on.`,
    ];

    return {
        category: RAPPORT_CATEGORIES.LOCATION,
        type: match.type,
        priority: isExact ? 85 : 60,
        hook: match.description,
        opener: openers[Math.floor(Math.random() * openers.length)],
        followUp: followUps[Math.floor(Math.random() * followUps.length)],
        source: 'location_match',
        timing: 'early', // Use early in conversation
        naturalTransition: `Speaking of ${city}, how did you end up there?`,
    };
}

/**
 * Create an education-based rapport hook
 */
function createEducationHook(match, sellerProfile) {
    const school = match.sellerValue;

    // Find graduation year if available
    const sellerEdu = sellerProfile.education?.find(e =>
        (e.school || e.institution || '').toLowerCase().includes(school.toLowerCase())
    );
    const gradYear = sellerEdu?.graduationYear;

    const openers = [
        `I saw you went to ${school} - I'm actually an alum too!`,
        `Go ${getSchoolMascot(school) || 'team'}! I graduated from ${school} as well.`,
        `Small world - I noticed we both went to ${school}.`,
    ];

    const followUps = gradYear ? [
        `I was there in ${gradYear} - when did you graduate?`,
        `Did you happen to overlap with me? I was class of ${gradYear}.`,
        `What did you study there?`,
    ] : [
        `What did you study there?`,
        `Did you enjoy your time there?`,
        `Are you still connected with anyone from ${school}?`,
    ];

    return {
        category: RAPPORT_CATEGORIES.EDUCATION,
        type: match.type,
        priority: 95, // Highest priority - strong bond
        hook: match.description,
        opener: openers[Math.floor(Math.random() * openers.length)],
        followUp: followUps[Math.floor(Math.random() * followUps.length)],
        source: 'education_match',
        timing: 'early',
        naturalTransition: `Before we dive in, I have to ask about ${school}...`,
    };
}

/**
 * Create a career/company-based rapport hook
 */
function createCareerHook(match, sellerProfile, prospectProfile) {
    const company = match.sellerValue;

    // Find seller's role at that company
    const sellerRole = sellerProfile.careerHistory?.find(c =>
        (c.company || c.name || '').toLowerCase().includes(company.toLowerCase())
    );

    const openers = [
        `I noticed you worked at ${company} - I was there too!`,
        `Small world - I see we both spent time at ${company}.`,
        `Fellow ${company} alum! When were you there?`,
    ];

    const followUps = sellerRole?.title ? [
        `I was a ${sellerRole.title} there. What team were you on?`,
        `Did you work out of the main office?`,
        `Do you still keep in touch with anyone from ${company}?`,
    ] : [
        `What team were you on?`,
        `How long were you there?`,
        `What did you think of the culture?`,
    ];

    return {
        category: RAPPORT_CATEGORIES.CAREER,
        type: match.type,
        priority: 90, // Very high priority
        hook: match.description,
        opener: openers[Math.floor(Math.random() * openers.length)],
        followUp: followUps[Math.floor(Math.random() * followUps.length)],
        source: 'career_match',
        timing: 'early',
        naturalTransition: `I have to mention - I saw on your profile you were at ${company}...`,
    };
}

/**
 * Create an industry-based rapport hook
 */
function createIndustryHook(match, sellerProfile) {
    const industry = match.sellerValue;

    const openers = match.type === MATCH_TYPES.EXACT ? [
        `Nice to connect with someone else in ${industry}.`,
        `Always good to talk to fellow ${industry} folks.`,
    ] : [
        `Your background in ${match.prospectValue} is interesting - there's a lot of overlap with what we do in ${industry}.`,
        `I've seen a lot of crossover between ${industry} and ${match.prospectValue} lately.`,
    ];

    return {
        category: RAPPORT_CATEGORIES.INDUSTRY,
        type: match.type,
        priority: match.type === MATCH_TYPES.EXACT ? 50 : 30,
        hook: match.description,
        opener: openers[Math.floor(Math.random() * openers.length)],
        followUp: `What trends are you seeing in the ${match.prospectValue} space?`,
        source: 'industry_match',
        timing: 'mid', // Can use during discussion
        naturalTransition: null,
    };
}

/**
 * Create a skill-based rapport hook
 */
function createSkillHook(match) {
    const skill = match.sellerValue;

    return {
        category: RAPPORT_CATEGORIES.INTERESTS,
        type: match.type,
        priority: 40,
        hook: `Shared expertise in ${skill}`,
        opener: `I see you have experience with ${skill} - that's something I've spent a lot of time on too.`,
        followUp: `How are you applying ${skill} in your current role?`,
        source: 'skill_match',
        timing: 'mid',
        naturalTransition: null,
    };
}

/**
 * Create an interest-based rapport hook
 */
function createInterestHook(match) {
    const interest = match.sellerValue;

    const openers = [
        `I noticed you're into ${interest} - same here!`,
        `Always nice to meet another ${interest} enthusiast.`,
        `I saw ${interest} on your profile - I'm actually really into that too.`,
    ];

    return {
        category: RAPPORT_CATEGORIES.INTERESTS,
        type: match.type,
        priority: 70, // Interests are great for rapport
        hook: `Shared interest: ${interest}`,
        opener: openers[Math.floor(Math.random() * openers.length)],
        followUp: `How did you get into ${interest}?`,
        source: 'interest_match',
        timing: 'early_or_close', // Good for opening or closing
        naturalTransition: `By the way, I couldn't help but notice you're into ${interest}...`,
    };
}

/**
 * Get school mascot/team name (simplified)
 */
function getSchoolMascot(school) {
    const mascots = {
        'georgia tech': 'Yellow Jackets',
        'university of georgia': 'Bulldogs',
        'georgia state': 'Panthers',
        'emory': 'Eagles',
        'auburn': 'Tigers',
        'alabama': 'Crimson Tide',
        'florida': 'Gators',
        'clemson': 'Tigers',
        'duke': 'Blue Devils',
        'unc': 'Tar Heels',
        'michigan': 'Wolverines',
        'ohio state': 'Buckeyes',
        'stanford': 'Cardinal',
        'berkeley': 'Bears',
        'ucla': 'Bruins',
        'usc': 'Trojans',
        'harvard': 'Crimson',
        'yale': 'Bulldogs',
        'mit': 'Engineers',
    };

    const schoolLower = school.toLowerCase();
    for (const [key, mascot] of Object.entries(mascots)) {
        if (schoolLower.includes(key)) {
            return mascot;
        }
    }

    return null;
}

/**
 * Format hooks for display in a brief
 */
function formatHooksForBrief(hooks) {
    return hooks.map(hook => ({
        hook: hook.hook,
        usage: hook.opener,
        category: hook.category,
        timing: hook.timing,
    }));
}

module.exports = {
    RAPPORT_CATEGORIES,
    generateRapportHooks,
    formatHooksForBrief,
    createLocationHook,
    createEducationHook,
    createCareerHook,
};
