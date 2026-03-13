/**
 * Sales Library - Text Extraction
 * Extracts text content from PDF, DOCX, PPTX, and TXT files
 */

const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const AdmZip = require('adm-zip');

/**
 * Extracts text from a PDF file
 * @param {Buffer} buffer - PDF file buffer
 * @returns {Promise<{ text: string, pageCount: number, wordCount: number }>}
 */
async function extractFromPDF(buffer) {
  try {
    const data = await pdfParse(buffer);
    const text = cleanText(data.text);

    return {
      text,
      pageCount: data.numpages || null,
      wordCount: countWords(text)
    };
  } catch (error) {
    console.error('PDF extraction error:', error.message);
    throw new Error(`Failed to extract text from PDF: ${error.message}`);
  }
}

/**
 * Extracts text from a DOCX file
 * @param {Buffer} buffer - DOCX file buffer
 * @returns {Promise<{ text: string, pageCount: number | null, wordCount: number }>}
 */
async function extractFromDOCX(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = cleanText(result.value);

    // Log any warnings
    if (result.messages && result.messages.length > 0) {
      console.warn('DOCX extraction warnings:', result.messages);
    }

    return {
      text,
      pageCount: null, // mammoth doesn't provide page count
      wordCount: countWords(text)
    };
  } catch (error) {
    console.error('DOCX extraction error:', error.message);
    throw new Error(`Failed to extract text from DOCX: ${error.message}`);
  }
}

/**
 * Extracts text from a PPTX file
 * PPTX files are ZIP archives containing XML slides
 * @param {Buffer} buffer - PPTX file buffer
 * @returns {Promise<{ text: string, pageCount: number, wordCount: number }>}
 */
async function extractFromPPTX(buffer) {
  try {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();

    // Find and sort slide entries
    const slideEntries = entries
      .filter(e => e.entryName.match(/ppt\/slides\/slide\d+\.xml/))
      .sort((a, b) => {
        const numA = parseInt(a.entryName.match(/slide(\d+)/)[1], 10);
        const numB = parseInt(b.entryName.match(/slide(\d+)/)[1], 10);
        return numA - numB;
      });

    if (slideEntries.length === 0) {
      throw new Error('No slides found in PPTX file');
    }

    let allText = '';
    let slideCount = 0;

    for (const entry of slideEntries) {
      slideCount++;
      const xml = entry.getData().toString('utf8');

      // Extract text from XML, preserving some structure
      const slideText = extractTextFromXML(xml);

      if (slideText.trim()) {
        allText += `\n--- SLIDE ${slideCount} ---\n${slideText}\n`;
      }
    }

    // Also extract notes if present
    const notesEntries = entries.filter(e =>
      e.entryName.match(/ppt\/notesSlides\/notesSlide\d+\.xml/)
    );

    if (notesEntries.length > 0) {
      allText += '\n--- SPEAKER NOTES ---\n';
      for (const entry of notesEntries) {
        const xml = entry.getData().toString('utf8');
        const noteText = extractTextFromXML(xml);
        if (noteText.trim()) {
          allText += noteText + '\n';
        }
      }
    }

    const text = cleanText(allText);

    return {
      text,
      pageCount: slideCount,
      wordCount: countWords(text)
    };
  } catch (error) {
    console.error('PPTX extraction error:', error.message);
    throw new Error(`Failed to extract text from PPTX: ${error.message}`);
  }
}

/**
 * Extracts text from a plain text file
 * @param {Buffer} buffer - Text file buffer
 * @returns {Promise<{ text: string, pageCount: number | null, wordCount: number }>}
 */
async function extractFromTXT(buffer) {
  try {
    const text = cleanText(buffer.toString('utf8'));

    return {
      text,
      pageCount: null,
      wordCount: countWords(text)
    };
  } catch (error) {
    console.error('TXT extraction error:', error.message);
    throw new Error(`Failed to read text file: ${error.message}`);
  }
}

/**
 * Extracts text from a Markdown file (read as UTF-8, same as TXT)
 * @param {Buffer} buffer - Markdown file buffer
 * @returns {Promise<{ text: string, pageCount: number | null, wordCount: number }>}
 */
async function extractFromMarkdown(buffer) {
  try {
    const text = cleanText(buffer.toString('utf8'));

    return {
      text,
      pageCount: null,
      wordCount: countWords(text)
    };
  } catch (error) {
    console.error('Markdown extraction error:', error.message);
    throw new Error(`Failed to read markdown file: ${error.message}`);
  }
}

/**
 * Extracts text from an HTML file by stripping tags
 * @param {Buffer} buffer - HTML file buffer
 * @returns {Promise<{ text: string, pageCount: number | null, wordCount: number }>}
 */
async function extractFromHTML(buffer) {
  try {
    let html = buffer.toString('utf8');

    // Remove script and style blocks entirely
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<style[\s\S]*?<\/style>/gi, '');

    // Replace block-level tags with newlines for readability
    html = html.replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, '\n');
    html = html.replace(/<br\s*\/?>/gi, '\n');

    // Strip remaining tags
    html = html.replace(/<[^>]+>/g, ' ');

    // Decode common HTML entities
    html = html.replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');

    const text = cleanText(html);

    return {
      text,
      pageCount: null,
      wordCount: countWords(text)
    };
  } catch (error) {
    console.error('HTML extraction error:', error.message);
    throw new Error(`Failed to read HTML file: ${error.message}`);
  }
}

/**
 * Main extraction function - routes to appropriate extractor
 * @param {Buffer} buffer - File buffer
 * @param {string} fileType - File type ('pdf', 'docx', 'pptx', 'txt', 'md', 'html')
 * @returns {Promise<{ text: string, pageCount: number | null, wordCount: number }>}
 */
async function extractText(buffer, fileType) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Empty file buffer provided');
  }

  const normalizedType = fileType.toLowerCase();

  switch (normalizedType) {
    case 'pdf':
      return extractFromPDF(buffer);
    case 'docx':
      return extractFromDOCX(buffer);
    case 'pptx':
      return extractFromPPTX(buffer);
    case 'txt':
      return extractFromTXT(buffer);
    case 'md':
      return extractFromMarkdown(buffer);
    case 'html':
      return extractFromHTML(buffer);
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

/**
 * Extracts text content from XML, stripping tags
 * @param {string} xml - XML content
 * @returns {string}
 */
function extractTextFromXML(xml) {
  // Remove XML comments
  let text = xml.replace(/<!--[\s\S]*?-->/g, '');

  // Extract text from <a:t> tags (PowerPoint text elements)
  const textMatches = text.match(/<a:t>([^<]*)<\/a:t>/g) || [];
  const extractedParts = textMatches.map(match =>
    match.replace(/<\/?a:t>/g, '')
  );

  // Also extract from <t> tags
  const simpleMatches = text.match(/<t>([^<]*)<\/t>/g) || [];
  const simpleParts = simpleMatches.map(match =>
    match.replace(/<\/?t>/g, '')
  );

  // If no specific text tags found, do a general strip
  if (extractedParts.length === 0 && simpleParts.length === 0) {
    text = text
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text;
  }

  return [...extractedParts, ...simpleParts].join(' ');
}

/**
 * Cleans extracted text by normalizing whitespace and removing artifacts
 * @param {string} text - Raw extracted text
 * @returns {string}
 */
function cleanText(text) {
  if (!text) return '';

  return text
    // Normalize line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove null bytes and control characters (except newlines/tabs)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Normalize multiple spaces to single space
    .replace(/[ \t]+/g, ' ')
    // Normalize multiple newlines to double newline
    .replace(/\n{3,}/g, '\n\n')
    // Trim lines
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    // Final trim
    .trim();
}

/**
 * Counts words in text
 * @param {string} text - Text to count
 * @returns {number}
 */
function countWords(text) {
  if (!text) return 0;
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

module.exports = {
  extractText,
  extractFromPDF,
  extractFromDOCX,
  extractFromPPTX,
  extractFromTXT,
  extractFromMarkdown,
  extractFromHTML,
  cleanText,
  countWords
};
