/**
 * Transcript Parser Service
 *
 * Parses meeting transcripts from various platforms (Zoom, Gong, Otter.ai, Teams, Fireflies)
 * and uses Gemini AI to extract structured data for Leave-Behind one-pagers.
 */

const geminiClient = require('./geminiClient');

/**
 * Supported transcript formats and their characteristics
 */
const TRANSCRIPT_FORMATS = {
    VTT: {
        extension: '.vtt',
        platforms: ['Zoom', 'Microsoft Teams'],
        pattern: /^WEBVTT/,
        timestampPattern: /(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/
    },
    SRT: {
        extension: '.srt',
        platforms: ['Various'],
        pattern: /^\d+\r?\n\d{2}:\d{2}:\d{2},\d{3}/,
        timestampPattern: /(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/
    },
    GONG: {
        extension: '.txt',
        platforms: ['Gong'],
        pattern: /^\[?\d{1,2}:\d{2}(:\d{2})?\]?\s+\w+:/m,
        timestampPattern: /\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+(\w+):/
    },
    OTTER: {
        extension: '.txt',
        platforms: ['Otter.ai'],
        pattern: /^Speaker\s+\d+\s+\d{1,2}:\d{2}/m,
        timestampPattern: /^(Speaker\s+\d+)\s+(\d{1,2}:\d{2})/
    },
    FIREFLIES: {
        extension: '.txt',
        platforms: ['Fireflies.ai'],
        pattern: /^\w+\s+\(\d{1,2}:\d{2}\)/m,
        timestampPattern: /^(\w+)\s+\((\d{1,2}:\d{2})\)/
    },
    PLAIN: {
        extension: '.txt',
        platforms: ['Manual', 'Other'],
        pattern: /./,
        timestampPattern: null
    }
};

/**
 * Detect the transcript format based on content
 * @param {string} content - Raw transcript content
 * @returns {string} Format key from TRANSCRIPT_FORMATS
 */
function detectFormat(content) {
    const trimmedContent = content.trim();

    // Check each format's pattern
    for (const [formatKey, format] of Object.entries(TRANSCRIPT_FORMATS)) {
        if (formatKey === 'PLAIN') continue; // Check PLAIN last
        if (format.pattern.test(trimmedContent)) {
            return formatKey;
        }
    }

    return 'PLAIN';
}

/**
 * Parse VTT format (WebVTT - Zoom, Teams)
 * @param {string} content - VTT content
 * @returns {Array} Array of {timestamp, speaker, text}
 */
function parseVTT(content) {
    const lines = content.split(/\r?\n/);
    const entries = [];
    let currentEntry = null;

    for (const line of lines) {
        const trimmed = line.trim();

        // Skip header and empty lines
        if (trimmed === 'WEBVTT' || trimmed === '' || /^NOTE/.test(trimmed)) {
            if (currentEntry) {
                entries.push(currentEntry);
                currentEntry = null;
            }
            continue;
        }

        // Check for timestamp line
        const timestampMatch = TRANSCRIPT_FORMATS.VTT.timestampPattern.exec(trimmed);
        if (timestampMatch) {
            if (currentEntry) {
                entries.push(currentEntry);
            }
            currentEntry = {
                startTime: timestampMatch[1],
                endTime: timestampMatch[2],
                speaker: 'Unknown',
                text: ''
            };
            continue;
        }

        // Text line
        if (currentEntry) {
            // Check for speaker prefix (e.g., "John Smith: Hello")
            const speakerMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
            if (speakerMatch && currentEntry.text === '') {
                currentEntry.speaker = speakerMatch[1].trim();
                currentEntry.text = speakerMatch[2];
            } else {
                currentEntry.text += (currentEntry.text ? ' ' : '') + trimmed;
            }
        }
    }

    if (currentEntry) {
        entries.push(currentEntry);
    }

    return entries;
}

/**
 * Parse SRT format
 * @param {string} content - SRT content
 * @returns {Array} Array of {timestamp, speaker, text}
 */
function parseSRT(content) {
    const blocks = content.split(/\r?\n\r?\n/);
    const entries = [];

    for (const block of blocks) {
        const lines = block.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) continue;

        // First line is sequence number
        // Second line is timestamp
        const timestampMatch = TRANSCRIPT_FORMATS.SRT.timestampPattern.exec(lines[1]);
        if (!timestampMatch) continue;

        // Remaining lines are text
        const text = lines.slice(2).join(' ').trim();

        // Try to extract speaker from text
        const speakerMatch = text.match(/^([^:]+):\s*(.*)$/);

        entries.push({
            startTime: `${timestampMatch[1]}.${timestampMatch[2]}`,
            endTime: `${timestampMatch[3]}.${timestampMatch[4]}`,
            speaker: speakerMatch ? speakerMatch[1].trim() : 'Unknown',
            text: speakerMatch ? speakerMatch[2] : text
        });
    }

    return entries;
}

/**
 * Parse Gong format
 * @param {string} content - Gong transcript content
 * @returns {Array} Array of {timestamp, speaker, text}
 */
function parseGong(content) {
    const lines = content.split(/\r?\n/);
    const entries = [];
    let currentEntry = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const match = TRANSCRIPT_FORMATS.GONG.timestampPattern.exec(trimmed);
        if (match) {
            if (currentEntry) {
                entries.push(currentEntry);
            }
            currentEntry = {
                startTime: match[1],
                speaker: match[2],
                text: trimmed.substring(match[0].length).trim()
            };
        } else if (currentEntry) {
            currentEntry.text += ' ' + trimmed;
        }
    }

    if (currentEntry) {
        entries.push(currentEntry);
    }

    return entries;
}

/**
 * Parse Otter.ai format
 * @param {string} content - Otter transcript content
 * @returns {Array} Array of {timestamp, speaker, text}
 */
function parseOtter(content) {
    const lines = content.split(/\r?\n/);
    const entries = [];
    let currentEntry = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const match = TRANSCRIPT_FORMATS.OTTER.timestampPattern.exec(trimmed);
        if (match) {
            if (currentEntry) {
                entries.push(currentEntry);
            }
            currentEntry = {
                startTime: match[2],
                speaker: match[1].replace('Speaker ', 'Speaker_'),
                text: ''
            };
        } else if (currentEntry) {
            currentEntry.text += (currentEntry.text ? ' ' : '') + trimmed;
        }
    }

    if (currentEntry) {
        entries.push(currentEntry);
    }

    return entries;
}

/**
 * Parse Fireflies format
 * @param {string} content - Fireflies transcript content
 * @returns {Array} Array of {timestamp, speaker, text}
 */
function parseFireflies(content) {
    const lines = content.split(/\r?\n/);
    const entries = [];
    let currentEntry = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const match = TRANSCRIPT_FORMATS.FIREFLIES.timestampPattern.exec(trimmed);
        if (match) {
            if (currentEntry) {
                entries.push(currentEntry);
            }
            currentEntry = {
                startTime: match[2],
                speaker: match[1],
                text: trimmed.substring(match[0].length).trim()
            };
        } else if (currentEntry) {
            currentEntry.text += ' ' + trimmed;
        }
    }

    if (currentEntry) {
        entries.push(currentEntry);
    }

    return entries;
}

/**
 * Parse plain text format (manual or unknown)
 * @param {string} content - Plain text content
 * @returns {Array} Array with single entry containing all text
 */
function parsePlain(content) {
    return [{
        startTime: null,
        speaker: 'Unknown',
        text: content.trim()
    }];
}

/**
 * Parse raw transcript content into structured entries
 * @param {string} content - Raw transcript content
 * @param {string} format - Optional format override
 * @returns {Object} { format, entries, plainText }
 */
function parseTranscript(content, format = null) {
    const detectedFormat = format || detectFormat(content);
    let entries = [];

    switch (detectedFormat) {
        case 'VTT':
            entries = parseVTT(content);
            break;
        case 'SRT':
            entries = parseSRT(content);
            break;
        case 'GONG':
            entries = parseGong(content);
            break;
        case 'OTTER':
            entries = parseOtter(content);
            break;
        case 'FIREFLIES':
            entries = parseFireflies(content);
            break;
        case 'PLAIN':
        default:
            entries = parsePlain(content);
            break;
    }

    // Generate plain text version for AI analysis
    const plainText = entries
        .map(e => e.speaker !== 'Unknown' ? `${e.speaker}: ${e.text}` : e.text)
        .join('\n\n');

    return {
        format: detectedFormat,
        entries,
        plainText,
        speakerCount: new Set(entries.map(e => e.speaker)).size,
        entryCount: entries.length
    };
}

/**
 * AI Extraction Prompt for meeting analysis
 */
const EXTRACTION_PROMPT = `You are an expert sales meeting analyst. Analyze the following meeting transcript and extract structured information for a sales leave-behind document.

Your output must be valid JSON with the following structure:
{
    "meetingSummary": "Brief 2-3 sentence summary of the meeting",
    "prospectInfo": {
        "name": "Prospect's name if mentioned",
        "company": "Prospect's company if mentioned",
        "role": "Prospect's role/title if mentioned"
    },
    "keyDiscussionPoints": [
        {
            "topic": "Main topic discussed",
            "details": "Key details from the discussion",
            "prospectInterest": "high|medium|low based on their engagement"
        }
    ],
    "painPointsIdentified": [
        {
            "painPoint": "Specific pain point mentioned",
            "context": "How it came up in conversation",
            "urgency": "high|medium|low"
        }
    ],
    "objections": [
        {
            "objection": "The objection or concern raised",
            "response": "How it was addressed (if at all)",
            "resolved": true|false
        }
    ],
    "nextSteps": [
        {
            "action": "Specific action item",
            "owner": "Who is responsible (seller/prospect)",
            "deadline": "Any deadline mentioned or null"
        }
    ],
    "competitorsMentioned": ["List of competitor names mentioned"],
    "budgetDiscussion": {
        "mentioned": true|false,
        "details": "Any budget-related discussion or null"
    },
    "timelineDiscussion": {
        "mentioned": true|false,
        "details": "Any timeline/urgency discussion or null"
    },
    "sentimentAnalysis": {
        "overall": "positive|neutral|negative",
        "buyingSignals": ["List of positive buying signals"],
        "concerns": ["List of concerns or red flags"]
    }
}

Guidelines:
- Extract only information that is explicitly stated or strongly implied
- For prospect interest level, base it on their questions, enthusiasm, and engagement
- Mark urgency based on words like "immediately", "soon", "ASAP", "next quarter", etc.
- Buying signals include: asking about pricing, implementation, timeline, comparing to current solution
- Be conservative - only include information you're confident about
- If information is not available, use null or empty arrays`;

/**
 * Extract structured data from transcript using Gemini AI
 * @param {string} transcriptContent - Raw or parsed transcript content
 * @param {Object} options - Options for extraction
 * @returns {Promise<Object>} Extracted meeting data
 */
async function extractMeetingData(transcriptContent, options = {}) {
    const {
        sellerName = null,
        prospectCompany = null,
        meetingDate = null
    } = options;

    // Parse transcript if it's raw content
    const parsed = typeof transcriptContent === 'string'
        ? parseTranscript(transcriptContent)
        : transcriptContent;

    // Build context for AI
    let contextPrefix = '';
    if (sellerName || prospectCompany || meetingDate) {
        contextPrefix = 'Meeting Context:\n';
        if (sellerName) contextPrefix += `- Seller: ${sellerName}\n`;
        if (prospectCompany) contextPrefix += `- Prospect Company: ${prospectCompany}\n`;
        if (meetingDate) contextPrefix += `- Meeting Date: ${meetingDate}\n`;
        contextPrefix += '\n';
    }

    const userMessage = `${contextPrefix}TRANSCRIPT:\n\n${parsed.plainText}`;

    try {
        const result = await geminiClient.generateJSON(EXTRACTION_PROMPT, userMessage);

        return {
            success: true,
            data: result.data,
            metadata: {
                format: parsed.format,
                speakerCount: parsed.speakerCount,
                entryCount: parsed.entryCount,
                tokensUsed: result.usage
            }
        };
    } catch (error) {
        console.error('Failed to extract meeting data:', error);

        return {
            success: false,
            error: error.message,
            data: null,
            metadata: {
                format: parsed.format,
                speakerCount: parsed.speakerCount,
                entryCount: parsed.entryCount
            }
        };
    }
}

/**
 * Generate leave-behind content from extracted meeting data
 * @param {Object} meetingData - Data from extractMeetingData
 * @param {Object} sellerProfile - Seller's profile for context
 * @returns {Promise<Object>} Formatted leave-behind content
 */
async function generateLeaveBeindContent(meetingData, sellerProfile = {}) {
    const LEAVE_BEHIND_PROMPT = `You are a sales content specialist. Based on the meeting data provided, create a professional leave-behind document that summarizes the meeting and reinforces the value proposition.

Output must be valid JSON with this structure:
{
    "headline": "A compelling headline that references the prospect's main need",
    "meetingRecap": "2-3 sentence professional recap of the meeting",
    "keyTakeaways": [
        "3-5 bullet points of the most important discussion points"
    ],
    "addressedConcerns": [
        {
            "concern": "The concern discussed",
            "resolution": "How it was or can be addressed"
        }
    ],
    "valueProposition": "Tailored value prop based on their specific pain points",
    "nextStepsSection": {
        "ourCommitments": ["What we committed to do"],
        "requestedActions": ["What we need from them"]
    },
    "callToAction": "A clear, specific call to action"
}

Guidelines:
- Keep the tone professional but personable
- Reference specific details from the meeting to show attentiveness
- Highlight how the solution addresses their specific pain points
- Be specific about next steps with clear ownership`;

    const userMessage = JSON.stringify({
        meetingData,
        sellerProfile: {
            companyName: sellerProfile.companyProfile?.name,
            products: sellerProfile.products?.map(p => p.name),
            valueProposition: sellerProfile.valueProposition?.main
        }
    }, null, 2);

    try {
        const result = await geminiClient.generateJSON(LEAVE_BEHIND_PROMPT, userMessage);

        return {
            success: true,
            content: result.data,
            tokensUsed: result.usage
        };
    } catch (error) {
        console.error('Failed to generate leave-behind content:', error);

        return {
            success: false,
            error: error.message,
            content: null
        };
    }
}

/**
 * Quick summary extraction for preview
 * @param {string} transcriptContent - Raw transcript content
 * @returns {Promise<Object>} Quick summary
 */
async function getQuickSummary(transcriptContent) {
    const SUMMARY_PROMPT = `Analyze this meeting transcript and provide a quick summary.

Output valid JSON:
{
    "duration": "Estimated meeting duration if timestamps available, or 'Unknown'",
    "participants": ["List of speaker names/identifiers"],
    "mainTopics": ["3-5 main topics discussed"],
    "sentiment": "positive|neutral|negative",
    "oneSentenceSummary": "One sentence summary of the meeting"
}`;

    const parsed = parseTranscript(transcriptContent);

    try {
        const result = await geminiClient.generateJSON(SUMMARY_PROMPT, parsed.plainText);

        return {
            success: true,
            summary: result.data,
            format: parsed.format
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            format: parsed.format
        };
    }
}

module.exports = {
    TRANSCRIPT_FORMATS,
    detectFormat,
    parseTranscript,
    extractMeetingData,
    generateLeaveBeindContent,
    getQuickSummary
};
