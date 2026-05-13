/**
 * reportProfiles.js
 * Per-industry report language and prompt injection profiles.
 * Content is APPENDED to existing Gemini prompts, never replacing them.
 */

const REPORT_PROFILES = {
  default_local_business: {
    competitorLanguage: 'competitors',
    opportunityLanguage: 'opportunity gap',
    qualifiedLeadsLanguage: 'qualified leads',
    primarySections: ['Market Overview','Competitive Landscape','Review Analysis','SEO Landscape','Qualified Leads','High-Impact Moves'],
    avoidSections: [],
    promptInjection: null
  },
  b2b_services: {
    competitorLanguage: 'competitors',
    opportunityLanguage: 'market positioning gap',
    qualifiedLeadsLanguage: 'qualified prospects',
    primarySections: ['Market Overview','Competitive Landscape','Web Presence Analysis','Service Specialization Map','Qualified Prospects','High-Impact Moves'],
    avoidSections: [],
    promptInjection: 'These are B2B service businesses. Emphasize web presence quality, service specialization, case studies and portfolio visibility, and thought leadership over review volume. Review count is less important than review quality and client testimonials. Frame recommendations around professional credibility and digital authority. For B2B service businesses, review velocity is less critical than web presence and portfolio visibility. De-emphasize review velocity metrics in favor of digital authority signals.'
  },
  government_public_sector: {
    competitorLanguage: 'peer entities',
    opportunityLanguage: 'public engagement gap',
    qualifiedLeadsLanguage: 'peer benchmarks',
    primarySections: ['Peer Landscape Overview','Digital Accessibility Assessment','Citizen Engagement Analysis','Website Clarity & Service Discoverability','Search Visibility','Public Trust Signals','Improvement Opportunities'],
    avoidSections: ['Review Velocity','Promotional Offers','Customer Acquisition Funnel','Sales Recommendations','Pitch Hooks'],
    promptInjection: 'CRITICAL: These are government and public sector entities. Do NOT frame them as commercial competitors. Use "peer entities" or "neighboring agencies" instead of "competitors." Use "public engagement gap" instead of "opportunity." Do NOT recommend promotional offers, sales funnels, or customer acquisition tactics. Instead recommend: website modernization, citizen communication improvements, service discoverability, event/program visibility, public feedback capture, and digital accessibility improvements. De-emphasize review volume — most government offices have very few Google reviews and that is normal, not a gap.'
  },
  nonprofit_association: {
    competitorLanguage: 'peer organizations',
    opportunityLanguage: 'community visibility gap',
    qualifiedLeadsLanguage: 'peer organizations',
    primarySections: ['Community Landscape Overview','Mission Visibility','Event & Program Communication','Donor / Member Engagement Signals','Community Trust & Reputation','Search & Discovery','Growth Opportunities'],
    avoidSections: ['Customer Acquisition Funnel','Promotional Offers','Sales Pipeline'],
    promptInjection: 'These are nonprofit and association entities. Frame the analysis around mission visibility, community impact, donor/member engagement, and event communication rather than commercial competition. Use "peer organizations" instead of "competitors." Recommendations should focus on visibility, community engagement, and digital presence — not revenue optimization.'
  }
};

function getReportProfile(profileKey) {
  return REPORT_PROFILES[profileKey] || REPORT_PROFILES.default_local_business;
}

module.exports = { REPORT_PROFILES, getReportProfile };
