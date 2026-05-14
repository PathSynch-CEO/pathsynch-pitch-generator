/**
 * test-usaspending-provider.js
 * Hits the real USAspending API and prints the actual response structure.
 * Run BEFORE wiring fetchUSAspendingByLocation() into market.js.
 * Usage: node scripts/test-usaspending-provider.js [--city Atlanta] [--state GA]
 */
const axios = require('axios');

const args = process.argv.slice(2);
const cityIdx = args.indexOf('--city');
const stateIdx = args.indexOf('--state');
const city = cityIdx >= 0 ? args[cityIdx + 1] : 'Atlanta';
const state = stateIdx >= 0 ? args[stateIdx + 1] : 'GA';

async function test() {
  const now = new Date();
  const fy = now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
  console.log(`Testing USAspending API for ${city}, ${state} (FY${fy})...\n`);

  const response = await axios.post(
    'https://api.usaspending.gov/api/v2/search/spending_by_award/',
    {
      filters: {
        recipient_locations: [{ country: 'USA', state: state, city: city }],
        time_period: [{ start_date: `${fy - 1}-10-01`, end_date: `${fy}-09-30` }],
        award_type_codes: ['02', '03', '04', '05', 'A', 'B', 'C', 'D']
      },
      fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency', 'Award Type', 'Start Date', 'Description'],
      limit: 5, page: 1, sort: 'Award Amount', order: 'desc'
    },
    { timeout: 15000 }
  );

  const results = response.data?.results || [];
  console.log('Status:', response.status);
  console.log('Result count:', results.length);
  console.log('Top-level keys:', Object.keys(response.data));
  if (results.length > 0) {
    console.log('\nFirst award keys:', Object.keys(results[0]));
    console.log('\nFirst award (full):', JSON.stringify(results[0], null, 2));
  } else {
    console.log('\nNo results returned. Check city/state spelling and fiscal year.');
  }
}

test().catch(err => {
  console.error('Test failed:', err.message);
  if (err.response) {
    console.error('Response status:', err.response.status);
    console.error('Response data:', JSON.stringify(err.response.data, null, 2));
  }
});
