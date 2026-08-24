'use strict';

/**
 * structuralGrowth.js — orchestrator for the Structural Growth research section (all policy-mapped verticals).
 *
 * Composes: NAICS policy gate (which subs may render) → county resolution (countyResolver) → QCEW fetch
 * (industryEconomicsService). Returns a `reportData.structuralGrowth` object; the Evidence Ledger turns its
 * metrics into sibling `external`/`withheld` entries. Deterministic: typed numeric values from BLS plus
 * template-generated provenance strings — NO model-generated prose (safe to build post-sanitizer).
 *
 * Vertical gating (all-verticals expansion, decision 2026-08-22): a vertical listed in
 * STRUCTURAL_GROWTH_POLICY renders the section (per-sub allow/deny below); a vertical NOT listed
 * returns null — no section, no withheld noise — because most of its sub-industries carry no
 * taxonomy NAICS code yet (that backfill is a separate taxonomy effort). Within a listed vertical,
 * an unlisted or `allow:false` sub is WITHHELD with cause, preserving the Gate-1 allowlist posture:
 * a sub renders employment data only after its NAICS mapping has been judged faithful.
 */

const { resolveCountyFips } = require('./countyResolver');
const { getStructuralGrowth } = require('../utils/industryEconomicsService');

// Per-vertical, per-sub NAICS policy. Only listed subs may render employment; `allow:false` subs are
// withheld `low_confidence_naics` with the judgment recorded. A disclosure string, when present, is
// surfaced in the section note (e.g. the junk-removal classification).
// One coverage caveat, three sub-industries. QCEW measures unemployment-insurance-covered employment,
// and agriculture is the industry where that gap is largest — stated once so the three tiles cannot
// drift apart. Source: BLS QCEW "Questions and Answers" and the agricultural UI thresholds.
const QCEW_AGRICULTURE_COVERAGE = 'BLS QCEW counts only unemployment-insurance-covered employment, and agriculture is roughly half covered: self-employed farmers and ranchers, unpaid family members and farms below the state UI threshold are excluded, which BLS estimates leaves about 300,000 hired agricultural workers out of the series nationally. Read this as covered payroll employment, not total farm labour.';

const STRUCTURAL_GROWTH_POLICY = {
    // Gate 1 §2 decisions (PR-D) — unchanged.
    home_services: {
        plumbing_hvac: { allow: true },
        electrical: { allow: true },
        roofing: { allow: true },
        landscaping: { allow: true },
        cleaning: { allow: true },
        general_contractor_home: { allow: true, disclosure: 'Residential Remodelers (NAICS 236118) — general-contractor scope narrowed to residential remodeling.' },
        junk_removal: { allow: true, disclosure: 'junk/bulky-item hauling, NAICS 562119 Other Waste Collection.' },
        dumpster_rental: { allow: true, disclosure: 'roll-off container collection basis, NAICS 562111 Solid Waste Collection.' },
        moving_storage: { allow: false, reason: 'Moving and storage span different NAICS series (484210 moving vs 531130 self-storage); a single code would misrepresent the sub-industry. Withheld pending a taxonomy split.' }
    },
    // All-verticals expansion (2026-08-22) — every taxonomy sub that carries a naicsCode, judged
    // individually. The two allow:false entries are mappings whose county series would misrepresent
    // the sub-industry; they need a taxonomy remap, not a policy flip.
    automotive: {
        auto_repair: { allow: true },                                     // 811111 General Automotive Repair (exact)
        body_shop: { allow: true },                                       // 811121 Body/Paint/Interior (exact)
        car_dealership: { allow: true },                                  // 4411 Automobile Dealers (natural 4-digit class)
        detailing_wash: { allow: true, disclosure: 'car wash and auto detailing basis, NAICS 811192 Car Washes.' },
        // Remapped 2026-08-23 from 441330 (parts/accessories RETAILERS) after verifying the NAICS
        // 2022 definition of 441340 Tire Dealers: "retailing new and/or used tires ... or retailing
        // new tires in combination with automotive repair services", with tire mounting, wheel
        // balancing and ALIGNING listed as the complementary services. That is this sub-industry.
        tire_alignment: { allow: true }                                   // 441340 Tire Dealers (exact)
    },
    // NAICS backfill batch 1 (2026-08-24). Every code below was checked against its NAICS 2022
    // definition before it was written down — the tire_alignment remap (PR #115) is the standing
    // reason we never infer a code from a name. Where the sub-industry is a NAMED member of a
    // broader class, it renders WITH a disclosure naming what else the county series counts;
    // where no faithful class exists, it is withheld by design rather than mapped approximately.
    health_wellness: {
        dental_practice: { allow: true },                                 // 621210 Offices of Dentists (exact)
        chiropractic: { allow: true },                                    // 621310 Offices of Chiropractors (exact)
        medical_practice: { allow: true, disclosure: 'physician office basis, NAICS 621111 — offices of mental health specialists (621112) are a separate NAICS series and are not included.' },
        gym_fitness: { allow: true, disclosure: 'gym and health club basis, NAICS 713940 — this class also counts recreational sports facilities such as swimming, skating and racquet clubs.' },
        // 812199 is an "Other" class, but day spas and massage parlors are two of its named
        // illustrative examples — the junk_removal (562119) precedent, not the business_brokers one.
        spa_massage: { allow: true, disclosure: 'day spa and massage basis, NAICS 812199 Other Personal Care Services — this class also counts tanning, tattoo, electrolysis and ear-piercing establishments.' },
        med_spa_aesthetics: { allow: false, reason: 'NAICS 2022 has no medical-spa class. A med spa falls into 812199 "Other Personal Care Services" or 621498 "All Other Outpatient Care Centers" depending on which side of its revenue dominates; both are catch-alls whose county employment describes neither the medical-aesthetics market nor each other. Withheld by design, as business_brokers is.' }
    },
    food_beverage: {
        full_service_restaurant: { allow: true },                         // 722511 Full-Service Restaurants (exact)
        fast_casual: { allow: true },                                     // 722513 Limited-Service Restaurants (exact: order and pay before eating)
        bar_nightlife: { allow: true },                                   // 722410 Drinking Places — bars, taverns, nightclubs (exact)
        restaurant_catering: { allow: true },                             // 722320 Caterers (exact)
        food_manufacturing: { allow: true },                              // 311 Food Manufacturing (natural 3-digit subsector)
        coffee_cafe: { allow: true, disclosure: 'coffee and nonalcoholic beverage bar basis, NAICS 722515 — this class also counts snack bars such as ice cream, doughnut, bagel and cookie shops.' },
        craft_beverage: { allow: true, disclosure: 'brewery basis, NAICS 312120 — cideries and wineries (312130) and distilleries (312140) are separate NAICS series and are not included, and brewpubs that primarily serve food count as restaurants (722511).' },
        bakery_artisan: { allow: true, disclosure: 'retail bakery basis, NAICS 311811 (baked on the premises from flour) — commercial bakeries (311812) and other artisan food producers are separate NAICS series and are not included.' }
    },
    salon_beauty: {
        beauty_salon: { allow: true },                                    // 812112 Beauty Salons (exact)
        nail_salon: { allow: true },                                      // 812113 Nail Salons (exact)
        // The taxonomy sub blends both halves of the NAICS split (its aliases carry "barber shop"),
        // so the narrower class is disclosed rather than silently standing in for both.
        hair_salon: { allow: true, disclosure: 'beauty and hairdressing salon basis, NAICS 812112 — barber shops and men\'s hair stylist shops are a separate NAICS series (812111) and are not included.' }
    },
    // NAICS backfill batch 2 (2026-08-24) — professional_services, construction_trades,
    // hospitality_lodging. Same rule as batch 1: a code is written down only after its NAICS 2022
    // definition was read, a broader class renders WITH a disclosure naming what else it counts,
    // and a sub-industry that no class describes is withheld rather than approximated.
    professional_services: {
        legal: { allow: true },                                           // 541110 Offices of Lawyers (exact)
        accounting: { allow: true },                                      // 5412 Accounting, Tax Prep, Bookkeeping, Payroll (natural 4-digit: the sub spans CPAs, tax prep and bookkeeping)
        accounting_tax: { allow: true },                                  // 5412 — same scope as `accounting`; NAICS does not separate them
        real_estate: { allow: true },                                     // 531210 Offices of Real Estate Agents and Brokers (exact)
        insurance: { allow: true },                                       // 524210 Insurance Agencies and Brokerages (exact; carriers underwrite and are 5241)
        business_consulting: { allow: true },                             // 541611 Administrative and General Management Consulting (exact)
        financial_advisory_ps: { allow: true },                           // 523940 Portfolio Management and Investment Advice (the 2022 consolidation of 523920 + 523930)
        architecture_engineering: { allow: true },                        // 5413 Architectural, Engineering, and Related Services — AEC is exactly this group
        it_consulting_msp: { allow: true, disclosure: 'IT services basis, NAICS 5415 Computer Systems Design and Related Services — cybersecurity has no NAICS class of its own and managed-service work splits across 541512 systems design, 541513 facilities management and 541519 other computer services, so the whole group is used; it also counts custom programming shops (541511).' },
        hr_staffing: { allow: true, disclosure: 'staffing and placement basis, NAICS 5613 Employment Services — HR consulting (541612) and payroll processing (541214) sit in a different sector and are not included.' },
        hr_staffing_payroll: { allow: true, disclosure: 'staffing and placement basis, NAICS 5613 Employment Services — payroll processing is 541214 and is not included; the payroll half of this sub-industry is not measured here.' },
        property_management_ps: { allow: true, disclosure: 'property management basis, NAICS 5313 Activities Related to Real Estate — covers residential (531311) and nonresidential (531312) managers, and also counts appraisers (531320); agents and brokers are 531210 and are not included.' },
        executive_coaching: { allow: true, disclosure: 'NAICS 611430 Professional and Management Development Training — this class measures management-training and seminar providers broadly, and a coaching practice whose revenue is mostly advisory is counted as management consulting (541611) instead.' },
        legal_accounting_financial: { allow: false, reason: 'This sub-industry blends three separate NAICS series — 5411 Legal Services, 5412 Accounting/Tax/Bookkeeping and 523/524 financial services. The only class containing all three is sector 54 itself, which is far too broad to describe a market. Withheld pending a taxonomy split, not a policy flip.' },
        business_brokers: { allow: false, reason: 'Mapped code 541990 is the "All Other Professional, Scientific, and Technical Services" catch-all; its county employment blends unrelated professions and does not describe the business-broker market. Investigated 2026-08-23: the common crosswalk alternative, 561499 "All Other Business Support Services", is another catch-all (bar code imprinting, mail presorting, contract fundraising) and no faithful 6-digit series exists, so this stays withheld by design rather than pending.' }
    },
    // NAICS backfill batch 3 (2026-08-24) — agencies_marketing_services, media_entertainment,
    // technology_saas. This batch runs through sector 51, which NAICS 2022 restructured wholesale
    // (software publishing 511210 -> 513210, broadcasting 515 -> 516), so every code here is a 2022
    // code specifically, not a familiar one carried over.
    // NAICS backfill batch 4 (2026-08-24) — the final batch; every vertical that CAN be mapped now is.
    // Two coverage caveats show up here for the first time and are disclosed per sub rather than
    // assumed known: QCEW measures only UI-covered PRIVATE employment, so it undercounts agriculture by
    // about half and excludes public colleges and municipal utilities from their own industries.
    agriculture: {
        crop_farming: { allow: true, disclosure: 'NAICS 111 Crop Production — ' + QCEW_AGRICULTURE_COVERAGE },
        livestock: { allow: true, disclosure: 'NAICS 112 Animal Production and Aquaculture — ' + QCEW_AGRICULTURE_COVERAGE },
        forestry: { allow: true, disclosure: 'NAICS 113 Forestry and Logging — ' + QCEW_AGRICULTURE_COVERAGE }
    },
    commercial_real_estate: {
        commercial_property: { allow: true, disclosure: 'NAICS 531210 Offices of Real Estate Agents and Brokers — NAICS does not separate commercial from residential brokerage, so this county series counts residential agents too; owners who lease out nonresidential buildings are 531120 and are not included.' },
        property_management: { allow: true, disclosure: 'property management basis, NAICS 5313 Activities Related to Real Estate — covers residential (531311) and nonresidential (531312) managers, and also counts appraisers (531320); agents and brokers are 531210 and are not included.' }
    },
    education_training: {
        corporate_training: { allow: true },                              // 611430 Professional and Management Development Training (exact)
        specialty_training: { allow: true },                              // 6115 Technical and Trade Schools (exact: vocational, trade, certification)
        higher_education: { allow: true, disclosure: 'NAICS 6113 Colleges, Universities, and Professional Schools — this series is PRIVATE ownership only. Public universities and community colleges are government-owned and are counted in a different QCEW ownership series, so in most counties this measures private institutions alone.' }
    },
    energy_utilities: {
        utility_construction: { allow: true },                            // 2371 Utility System Construction (exact: water, sewer, gas, power and communication distribution)
        power_generation: { allow: true, disclosure: 'NAICS 2211 Electric Power Generation, Transmission and Distribution — municipal and other public-power utilities are government-owned and are not in this private-ownership series, which measures investor-owned utilities.' },
        water_utilities: { allow: true, disclosure: 'NAICS 221310 Water Supply and Irrigation Systems — most community water systems are municipally owned and counted as government, so this private-ownership series measures investor-owned water utilities only and will read far smaller than the market.' }
    },
    finance_banking: {
        commercial_banking: { allow: true },                              // 522110 Commercial Banking (exact)
        credit_union: { allow: true },                                    // 522130 Credit Unions (exact)
        financial_advisory: { allow: true },                              // 523940 Portfolio Management and Investment Advice (exact)
        payment_processing: { allow: true },                              // 522320 — credit card processing is one of the class's own illustrative examples
        // NAICS 2022 collapsed 523110 Investment Banking and Securities Dealing together with 523120
        // Securities Brokerage into 523150. That merge is invisible from the code alone.
        investment_banking: { allow: true, disclosure: 'NAICS 523150 Investment Banking and Securities Intermediation — NAICS 2022 merged securities BROKERAGE (formerly 523120) into this class, so the county series counts retail brokerages alongside investment banks.' }
    },
    manufacturing: {
        machine_shop: { allow: true },                                    // 332710 Machine Shops (exact)
        industrial_equipment: { allow: true },                            // 333 Machinery Manufacturing (natural 3-digit)
        food_manufacturing_sub: { allow: true },                          // 311 Food Manufacturing (same class as food_beverage/food_manufacturing)
        general_manufacturing: { allow: false, reason: 'This sub-industry IS the manufacturing sector (NAICS 31-33), not an industry within it. No NAICS class contains it, and a sector RANGE cannot be walked: buildWalk strips the hyphen, so "31-33" reads as 3133 and widens to 313 Textile Mills — a wrong series rather than an absent one. Withheld pending a taxonomy split into real industries.' }
    },
    nonprofit_associations: {
        community_social_services: { allow: true },                       // 624 Social Assistance (natural 3-digit)
        trade_association: { allow: true },                               // 813910 Business Associations — chambers of commerce and trade associations are its own illustrative examples
        environmental_nonprofit: { allow: true },                         // 813312 Environment, Conservation and Wildlife Organizations (exact)
        health_human_services: { allow: true, disclosure: 'NAICS 624 Social Assistance — measures organisations that DELIVER services; voluntary health organisations that mainly fundraise and advocate are 813212 and are not included.' },
        advocacy_civic: { allow: true, disclosure: 'NAICS 813 — advocacy groups (813319), civic and social clubs (813410) and political organisations (813940) sit in three different industry groups, so the subsector is used; it also counts religious organisations, grantmaking foundations and professional associations.' },
        arts_culture_religious: { allow: false, reason: 'The halves of this sub-industry are in different sectors: religious organisations are 813110, while arts and cultural organisations are 7111 Performing Arts Companies and 712110 Museums. No NAICS class contains both, so any code would describe part of it and misrepresent the rest. Withheld pending a taxonomy split.' },
        education_nonprofit: { allow: false, reason: 'Splits by what the organisation actually does: tutoring nonprofits are 611691 Exam Preparation and Tutoring, nonprofit schools are 6111-6113, and scholarship foundations are 813211 Grantmaking Foundations — sector 61 on one side, 813 on the other. No class spans them. Withheld pending a taxonomy split.' }
    },
    agencies_marketing_services: {
        creative_full_service_agency: { allow: true },                    // 541810 Advertising Agencies — the class definition IS this sub
        pr_communications_firm: { allow: true },                          // 541820 Public Relations Agencies (exact)
        media_buying_agency: { allow: true },                             // 541830 Media Buying Agencies (exact)
        branding_design_studio: { allow: true },                          // 541430 Graphic Design Services — "...or project visual identities" is the definition's own wording
        // NAICS splits agencies on whether they PLACE media, not on channel: creating and placing ads
        // is 541810, advising without executing is 541613. There is no digital/social/SEO class.
        digital_marketing_agency: { allow: true, disclosure: 'NAICS 541810 Advertising Agencies — NAICS has no digital or performance-marketing class, so this county series counts every advertising agency including traditional ones.' },
        social_media_agency: { allow: true, disclosure: 'NAICS 541810 Advertising Agencies — NAICS has no social-media class; agencies land here because they create and place paid media, alongside every other advertising agency in the county.' },
        seo_content_agency: { allow: true, disclosure: 'NAICS 541613 Marketing Consulting Services — NAICS has no SEO or content-marketing class, and an agency that also places paid media is counted as an advertising agency (541810) instead.' },
        web_development_agency: { allow: true, disclosure: 'NAICS 541511 Custom Computer Programming Services — the class also counts custom software developers generally, and a studio doing purely visual web design is counted as graphic design (541430).' },
        video_production_marketing: { allow: true, disclosure: 'NAICS 512110 Motion Picture and Video Production — the class counts film and television production too, not only marketing video.' },
        experiential_event_marketing: { allow: true, disclosure: 'NAICS 5418 Advertising, Public Relations, and Related Services — NAICS has no experiential or event-marketing class, so the whole industry group is used; it counts advertising agencies, PR firms and media buyers, while organizers who run trade shows are 561920 and sit outside it.' },
        staffing_recruiting_agency: { allow: true, disclosure: 'staffing and placement basis, NAICS 5613 Employment Services — talent agents and managers for performers are 711410 and are not included.' }
    },
    media_entertainment: {
        film_video_production: { allow: true },                           // 512110 Motion Picture and Video Production (exact)
        photography_studio: { allow: true, disclosure: 'NAICS 541921 Photography Studios, Portrait — commercial photography is a separate class (541922) and is not included.' },
        performing_arts_theater: { allow: true, disclosure: 'NAICS 7111 Performing Arts Companies — covers theater, dance and musical companies; dance and art SCHOOLS are 611610 Fine Arts Schools and are not included.' },
        music_venue: { allow: true, disclosure: 'NAICS 711310 — promoters who operate their own facility; promoters who book venues owned by others are 711320 and are not included.' },
        broadcasting_media: { allow: true, disclosure: 'NAICS 5161 Radio and Television Broadcasting Stations — podcast production is not broadcasting and is counted elsewhere (512240 sound recording studios, or 516210 media streaming distribution).' },
        event_production_av: { allow: false, reason: 'No NAICS class contains this sub-industry: AV equipment supply is 532490 rental, running the event is 561920 Convention and Trade Show Organizers, and shooting it is 512199 Other Motion Picture and Video Industries. Those are three different sectors and an AV production company usually does all three. Withheld pending a taxonomy split.' },
        gaming_esports: { allow: false, reason: 'The aliases span three unrelated sectors — game studios are 513210 Software Publishers, professional esports teams are 711211 Sports Teams and Clubs, and gaming arcades are 713120 Amusement Arcades. No class contains more than one of them, so any code would describe a third of the sub-industry. Withheld pending a taxonomy split.' }
    },
    technology_saas: {
        software_development: { allow: true },                            // 541511 Custom Computer Programming Services (exact)
        tech_consulting: { allow: true },                                 // 541512 Computer Systems Design Services (exact: integrating hardware, software and communications)
        cloud_hosting: { allow: true },                                   // 518210 — the 2022 class explicitly covers computing infrastructure and web hosting
        saas_products: { allow: true },                                   // 513210 Software Publishers — the 2022 code; 511210 was retired
        it_services: { allow: true, disclosure: 'IT services basis, NAICS 5415 Computer Systems Design and Related Services — the group covers systems design, facilities management and other computer services, and also counts custom programming shops (541511).' }
    },
    construction_trades: {
        general_contractor: { allow: true },                              // 236 Construction of Buildings (natural 3-digit: builders, residential and nonresidential)
        specialty_contractor: { allow: true },                            // 238 Specialty Trade Contractors (natural 3-digit)
        remodeling_renovation: { allow: true },                           // 236118 Residential Remodelers (exact)
        commercial_construction: { allow: true },                         // 2362 Nonresidential Building Construction (exact)
        electrical_contractor: { allow: true },                           // 238210 Electrical Contractors (exact)
        plumbing_contractor: { allow: true, disclosure: 'NAICS 238220 Plumbing, Heating, and Air-Conditioning Contractors — the class also counts HVAC contractors; NAICS does not separate plumbing from heating and cooling work.' }
    },
    hospitality_lodging: {
        // NAICS classifies lodging by TYPE of establishment, not service tier — hotels, motels and
        // resorts share one class. Each sub says so rather than implying a tier-specific number.
        hotel_full_service: { allow: true, disclosure: 'NAICS 721110 Hotels (except Casino Hotels) and Motels — NAICS has no full-service/limited-service split, so this county series also counts motels and limited-service hotels; casino hotels are 721120 and are not included.' },
        resort: { allow: true, disclosure: 'NAICS 721110 Hotels (except Casino Hotels) and Motels — NAICS has no resort class; resorts are counted with hotels and motels, and casino resorts are 721120 and are not included.' },
        hostel_budget_lodging: { allow: true, disclosure: 'NAICS 721110 Hotels (except Casino Hotels) and Motels — motels and budget hotels are in this class, but hostels are counted separately under 721310 Rooming and Boarding Houses and are not included.' },
        boutique_hotel_bnb: { allow: true, disclosure: 'NAICS 721191 Bed-and-Breakfast Inns — a boutique property operating as a hotel is counted in 721110 instead, so this series measures the B&B and inn half of the sub-industry only.' },
        vacation_rental: { allow: false, reason: 'Short-term rental splits across two sectors by who is being measured: operators fall in 721199 All Other Traveler Accommodation, management companies in 531311 Residential Property Managers. Worse, most of this market is non-employer hosts, which the QCEW private-ownership series does not count at all — so any number here would understate it by design. Withheld.' },
        event_venue_banquet: { allow: false, reason: 'NAICS has no event-venue class; the classification turns on whether the venue supplies catering staff. With staff it is 722320 Caterers (already the catering market\'s series); without, 531120 Lessors of Nonresidential Buildings, a landlord series dominated by office and retail leasing. Neither describes an event venue. Withheld.' }
    },
    retail: {
        general_merchandise: { allow: true },                             // 455 (3-digit walk; the Aug-19 mockup example)
        clothing_boutique: { allow: true },                               // 4581 Clothing and Clothing Accessories Retailers
        electronics_retail: { allow: true },                              // 449210 Electronics and Appliance Retailers (exact)
        specialty_food_gifts: { allow: true, disclosure: 'gift and novelty retail basis, NAICS 459420; specialty food retail is a separate NAICS series and is not included.' },
        home_goods_decor: { allow: true },                                // 4491 Furniture and Home Furnishings Retailers
        sporting_outdoor: { allow: true }                                 // 459110 Sporting Goods Retailers (exact)
    },
    transportation_logistics: {
        commercial_aviation: { allow: true },                             // 481111 Scheduled Passenger Air Transportation (exact)
        charter_aviation: { allow: true },                                // 481211 Nonscheduled Chartered Passenger Air Transportation (exact)
        aviation_services: { allow: true },                               // 4881 Support Activities for Air Transportation — FBOs are 488119, aircraft maintenance 488190; the group holds both
        warehousing: { allow: true },                                     // 493 Warehousing and Storage (natural 3-digit)
        freight_trucking: { allow: true, disclosure: 'NAICS 484 Truck Transportation — freight forwarders and third-party logistics firms arrange transport without operating trucks, are 4885 Freight Transportation Arrangement, and are not included.' },
        truck_stops: { allow: true, disclosure: 'fuel-station basis, NAICS 457120 Other Gasoline Stations (truck stops are included in this class).' }
    }
};

// Back-compat alias — the original Home-Services-only export (kept for tests and external readers).
const HOME_SERVICES_POLICY = STRUCTURAL_GROWTH_POLICY.home_services;

function allWithheld(cause, reason, base) {
    const m = { state: 'withheld', withholdCause: cause, reason };
    return Object.assign({
        status: 'withheld',
        metrics: { employment: { ...m }, yoy: { ...m }, establishments: { ...m }, wage: { ...m }, lq: { ...m } }
    }, base);
}

/**
 * @param {object} args
 *   - industryConfig, subIndustryConfig  (taxonomy objects)
 *   - state, city
 *   - geo                                 (services/geography.getCensusGeography result — Table A fallback)
 *   - geocodeCountyName                   (optional admin_area_level_2 from an existing geocode)
 * @param {object} [deps] - { getStructuralGrowth, resolveCountyFips, now } for tests
 * @returns {Promise<object|null>} reportData.structuralGrowth, or null when not applicable (unmapped vertical)
 */
async function computeStructuralGrowth(args, deps = {}) {
    const { industryConfig, subIndustryConfig, state, geo, geocodeCountyName } = args || {};
    const vertical = industryConfig && industryConfig.id;
    const verticalPolicy = vertical ? STRUCTURAL_GROWTH_POLICY[vertical] : null;
    if (!verticalPolicy) return null; // unmapped vertical — no section (NAICS backfill is a separate effort)

    const _resolve = deps.resolveCountyFips || resolveCountyFips;
    const _fetch = deps.getStructuralGrowth || getStructuralGrowth;

    const subId = subIndustryConfig && subIndustryConfig.id;
    const naicsCode = subIndustryConfig && subIndustryConfig.naicsCode;
    const naicsLabel = subIndustryConfig && subIndustryConfig.naicsLabel;
    const base = {
        vertical, subIndustryId: subId || null,
        requestedNaics: { code: naicsCode || null, label: naicsLabel || null }
    };

    // Policy gate — which subs of this vertical may show employment at all.
    const policy = subId ? verticalPolicy[subId] : null;
    if (!policy) {
        return allWithheld('no_naics', 'This sub-industry is not enabled for county employment data.', base);
    }
    if (policy.allow === false) {
        return allWithheld('low_confidence_naics', policy.reason || 'NAICS classification is low-confidence; withheld.', base);
    }
    if (!naicsCode) {
        return allWithheld('no_naics', 'This sub-industry is not mapped to a NAICS employment series.', base);
    }

    // County resolution — geocode primary, city-table fallback, else withhold.
    const county = _resolve({ geocodeCountyName, state, geo });
    if (county.withhold) {
        return allWithheld('no_county_fips', county.reason, base);
    }

    // Presentation: stamp the authoritative human-readable county label (canonical FIPS→label from the
    // resolver) into provenance, regardless of resolution source. Falls back to the raw name then FIPS.
    const sg = await _fetch({
        fips5: county.fips5, county: county.countyLabel || county.county || county.fips5, state, naicsCode, naicsLabel
    }, { now: deps.now });

    return Object.assign({}, base, {
        status: sg.status,
        county: sg.county, state: sg.state, fips5: sg.fips5,
        // Propagate the structured BLS source URL the service already computed (industryEconomicsService
        // .buildResult reconstructs it from the LANDED dataYear + fips5). Single source-of-truth URL path —
        // never rebuilt here, never parsed out of provenance. `null` on withheld sections (no evidence, no
        // URL to expose) — the same absence convention as `disclosure` below.
        sourceUrl: sg.sourceUrl || null,
        countySource: county.source,
        dataYear: sg.dataYear, comparisonYear: sg.comparisonYear,
        disclosure: policy.disclosure || null,
        metrics: sg.metrics
    });
}

module.exports = { computeStructuralGrowth, STRUCTURAL_GROWTH_POLICY, HOME_SERVICES_POLICY };
