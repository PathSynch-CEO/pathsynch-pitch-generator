/**
 * industryTaxonomy.js — Backend wrapper for canonical taxonomy JSON.
 * SYNC RULE: canonical source is functions/config/industryTaxonomy.json.
 * Run `node scripts/sync-taxonomy.js` after any change.
 */
const taxonomy = require('./industryTaxonomy.json');
const INDUSTRIES = taxonomy.industries;
const TAXONOMY_VERSION = taxonomy.taxonomyVersion;

function normalizeTaxonomyKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\+/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getIndustryLabels() {
  return INDUSTRIES.map(i => i.label);
}

function getSubIndustryLabels(industryLabelOrId) {
  const industry = findIndustry(industryLabelOrId);
  if (!industry) return [];
  return industry.subIndustries.map(s => s.label);
}

function findIndustry(query) {
  if (!query) return null;
  const normalized = normalizeTaxonomyKey(query);
  return INDUSTRIES.find(i =>
    i.id === query ||
    i.id === normalized ||
    normalizeTaxonomyKey(i.label) === normalized ||
    i.aliases.some(a => normalizeTaxonomyKey(a) === normalized)
  ) || null;
}

function findSubIndustry(industryLabelOrId, subQuery) {
  const industry = findIndustry(industryLabelOrId);
  if (!industry || !subQuery) return null;
  const normalized = normalizeTaxonomyKey(subQuery);
  return industry.subIndustries.find(s =>
    s.id === subQuery ||
    s.id === normalized ||
    normalizeTaxonomyKey(s.label) === normalized ||
    (s.aliases && s.aliases.some(a => normalizeTaxonomyKey(a) === normalized))
  ) || null;
}

function buildSearchQueries(industryLabelOrId, subIndustryLabel, city, state) {
  const industry = findIndustry(industryLabelOrId);
  if (!industry) return [`${subIndustryLabel || 'business'} ${city} ${state}`];
  const subLabel = subIndustryLabel || industry.label;
  return industry.googlePlaceQueries.map(t =>
    t.replace('{industry}', industry.label)
     .replace('{subIndustry}', subLabel)
     .replace('{city}', city)
     .replace('{state}', state)
  );
}

module.exports = { INDUSTRIES, TAXONOMY_VERSION, normalizeTaxonomyKey, getIndustryLabels, getSubIndustryLabels, findIndustry, findSubIndustry, buildSearchQueries };
