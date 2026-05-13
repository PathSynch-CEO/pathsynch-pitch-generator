'use strict';

/**
 * Demographic Data Service — ZIP-Level Census ACS
 *
 * Fetches Census ACS 5-Year Estimates at ZCTA (ZIP Code Tabulation Area) level.
 * One API call, 22 variables. 365-day Firestore cache.
 * Falls back gracefully for PO boxes and missing ZCTAs.
 *
 * Separate from demographicsEnricher.js which fetches city-level data.
 */

const fetch = require('node-fetch');
const admin = require('firebase-admin');

const CENSUS_BASE_URL = 'https://api.census.gov/data/2023/acs/acs5';
const CACHE_COLLECTION = 'demographicCache';
const CACHE_TTL_DAYS = 365;

const CENSUS_VARIABLES = [
    'B01003_001E', // Total population
    'B19013_001E', // Median household income
    'B25003_001E', // Total tenure units
    'B25003_002E', // Owner-occupied
    'B25003_003E', // Renter-occupied
    'B25001_001E', // Total housing units
    'B01002_001E', // Median age
    'B11001_001E', // Total households
    'B11001_002E', // Family households
    'B11001_007E', // Nonfamily households
    'B08301_001E', // Total commuters
    'B08301_010E', // Public transit
    'B08301_019E', // Walk
    'B08301_021E', // Work from home
    'B15003_022E', // Bachelor's
    'B15003_023E', // Master's
    'B15003_025E', // Doctorate
    'B15003_001E', // Total education pop
    'B08201_001E', // Total households (vehicle)
    'B08201_002E', // No vehicle
    'B16001_001E', // Language total
    'B16001_002E', // English only
    'NAME'
].join(',');

/**
 * Main entry: get ZIP-level demographic profile (cached).
 * @param {string} zipCode - 5-digit ZIP
 * @returns {Promise<Object|null>} { zipCode, profile, fetchedAt } or null
 */
async function getDemographicData(zipCode) {
    if (!zipCode || !/^\d{5}$/.test(String(zipCode).trim())) return null;
    const zip = String(zipCode).trim();

    const cached = await checkCache(zip);
    if (cached) return cached;

    const apiKey = process.env.CENSUS_API_KEY;
    if (!apiKey) {
        console.warn('[DemographicService] CENSUS_API_KEY not set');
        return null;
    }

    try {
        const url = `${CENSUS_BASE_URL}?get=${CENSUS_VARIABLES}&for=zip%20code%20tabulation%20area:${zip}&key=${apiKey}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) {
            console.warn(`[DemographicService] Census returned ${response.status} for ZIP ${zip}`);
            return null;
        }

        const raw = await response.json();
        if (!Array.isArray(raw) || raw.length < 2) {
            console.warn(`[DemographicService] No ZCTA data for ZIP ${zip}`);
            return null;
        }

        const headers = raw[0];
        const values = raw[1];
        const data = {};
        headers.forEach((h, i) => { data[h] = values[i]; });

        const profile = parseCensusData(data, zip);
        const db = admin.firestore();
        const now = admin.firestore.Timestamp.now();
        const result = {
            zipCode: zip,
            fetchedAt: now,
            expiresAt: admin.firestore.Timestamp.fromDate(
                new Date(Date.now() + CACHE_TTL_DAYS * 24 * 60 * 60 * 1000)
            ),
            profile
        };

        db.collection(CACHE_COLLECTION).doc(zip).set(result).catch(e =>
            console.warn('[DemographicService] Cache write failed:', e.message)
        );

        return result;

    } catch (err) {
        console.warn('[DemographicService] Census API error for ZIP', zip, ':', err.message);
        return null;
    }
}

function parseCensusData(data, zip) {
    const int = (k) => parseInt(data[k]) || 0;
    const flt = (k) => parseFloat(data[k]) || 0;

    const totalPop       = int('B01003_001E');
    const medianIncome   = int('B19013_001E');
    const ownerOccupied  = int('B25003_002E');
    const renterOccupied = int('B25003_003E');
    const totalTenure    = int('B25003_001E');
    const totalHousing   = int('B25001_001E');
    const medianAge      = flt('B01002_001E');
    const totalHH        = int('B11001_001E');
    const familyHH       = int('B11001_002E');
    const nonfamilyHH    = int('B11001_007E');
    const totalCommuters = int('B08301_001E');
    const transitCommute = int('B08301_010E');
    const walkCommute    = int('B08301_019E');
    const wfhCommute     = int('B08301_021E');
    const bachelors      = int('B15003_022E');
    const masters        = int('B15003_023E');
    const doctorate      = int('B15003_025E');
    const totalEduPop    = int('B15003_001E');
    const totalVehicleHH = int('B08201_001E');
    const noVehicleHH    = int('B08201_002E');
    const langTotal      = int('B16001_001E');
    const englishOnly    = int('B16001_002E');

    const pct = (num, den) => den > 0 ? Math.round((num / den) * 100) : null;

    const homeownershipRate   = pct(ownerOccupied, totalTenure);
    const renterRate          = pct(renterOccupied, totalTenure);
    const familyHouseholdRate = pct(familyHH, totalHH);
    const collegeDegreeRate   = pct(bachelors + masters + doctorate, totalEduPop);
    const vehicleOwnershipRate = pct(totalVehicleHH - noVehicleHH, totalVehicleHH);
    const nonEnglishRate      = pct(langTotal - englishOnly, langTotal);
    const wfhRate             = pct(wfhCommute, totalCommuters);
    const transitRate         = pct(transitCommute, totalCommuters);
    const walkRate            = pct(walkCommute, totalCommuters);

    const fmt = (n, prefix = '', suffix = '') =>
        n != null ? `${prefix}${typeof n === 'number' ? n.toLocaleString() : n}${suffix}` : 'N/A';

    return {
        population:           totalPop,
        medianHouseholdIncome: medianIncome,
        medianAge,
        totalHouseholds:      totalHH,
        totalHousingUnits:    totalHousing,
        homeownershipRate,
        renterRate,
        ownerOccupied,
        renterOccupied,
        familyHouseholdRate,
        familyHouseholds:     familyHH,
        nonfamilyHouseholds:  nonfamilyHH,
        collegeDegreeRate,
        vehicleOwnershipRate,
        transitRate,
        walkRate,
        wfhRate,
        nonEnglishRate,
        display: {
            population:      totalPop > 0 ? totalPop.toLocaleString() : 'N/A',
            medianIncome:    medianIncome > 0 ? `$${medianIncome.toLocaleString()}` : 'N/A',
            medianAge:       medianAge > 0 ? medianAge.toFixed(1) : 'N/A',
            homeownership:   fmt(homeownershipRate, '', '%'),
            renter:          fmt(renterRate, '', '%'),
            familyHouseholds: fmt(familyHouseholdRate, '', '%'),
            collegeDegree:   fmt(collegeDegreeRate, '', '%'),
            vehicleOwnership: fmt(vehicleOwnershipRate, '', '%'),
            nonEnglish:      fmt(nonEnglishRate, '', '%'),
            wfh:             fmt(wfhRate, '', '%'),
            transit:         fmt(transitRate, '', '%'),
            walkRate:        fmt(walkRate, '', '%'),
            totalHouseholds: totalHH > 0 ? totalHH.toLocaleString() : 'N/A'
        }
    };
}

async function checkCache(zip) {
    try {
        const db = admin.firestore();
        const doc = await db.collection(CACHE_COLLECTION).doc(zip).get();
        if (!doc.exists) return null;
        const d = doc.data();
        const expires = d.expiresAt?.toDate?.();
        if (!expires || new Date() > expires) return null;
        return d;
    } catch (e) {
        console.warn('[DemographicService] Cache read failed:', e.message);
        return null;
    }
}

module.exports = { getDemographicData };
