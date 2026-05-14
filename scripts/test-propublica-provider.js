/**
 * test-propublica-provider.js
 * Hits the real ProPublica Nonprofit Explorer API and prints response structure.
 * Run BEFORE relying on specific field names in searchProPublica().
 * Usage: node scripts/test-propublica-provider.js [--name "United Way"] [--state GA]
 */
const axios = require('axios');

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const stateIdx = args.indexOf('--state');
const name = nameIdx >= 0 ? args[nameIdx + 1] : 'United Way';
const state = stateIdx >= 0 ? args[stateIdx + 1] : 'GA';

async function test() {
  console.log(`Testing ProPublica API for "${name}" in ${state}...\n`);
  const searchUrl = 'https://projects.propublica.org/nonprofits/api/v2/search.json';
  const searchResponse = await axios.get(searchUrl, {
    params: { q: name, state: state },
    timeout: 10000
  });
  console.log('Search status:', searchResponse.status);
  console.log('Search top-level keys:', Object.keys(searchResponse.data));
  const orgs = searchResponse.data?.organizations || searchResponse.data?.results || [];
  console.log('Organization count:', orgs.length);
  if (orgs.length > 0) {
    console.log('\nFirst org keys:', Object.keys(orgs[0]));
    console.log('First org:', JSON.stringify(orgs[0], null, 2));
    const ein = orgs[0].ein || orgs[0].strein;
    if (ein) {
      console.log(`\nFetching detail for EIN ${ein}...`);
      const detailUrl = `https://projects.propublica.org/nonprofits/api/v2/organizations/${ein}.json`;
      const detailResponse = await axios.get(detailUrl, { timeout: 10000 });
      console.log('Detail top-level keys:', Object.keys(detailResponse.data));
      const orgDetail = detailResponse.data?.organization || detailResponse.data;
      const filings = orgDetail?.filings_with_data || orgDetail?.filings || [];
      console.log('Filing count:', filings.length);
      if (filings.length > 0) {
        console.log('\nLatest filing keys:', Object.keys(filings[0]));
        console.log('Latest filing (full):', JSON.stringify(filings[0], null, 2));
      }
    }
  } else {
    console.log('\nNo organizations found.');
  }
}

test().catch(err => {
  console.error('Test failed:', err.message);
  if (err.response) {
    console.error('Response status:', err.response.status);
    console.error('Response data:', JSON.stringify(err.response.data, null, 2));
  }
});
