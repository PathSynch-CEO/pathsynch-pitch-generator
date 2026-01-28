# Market Intelligence Platform Architecture

## Executive Summary

This document defines the data architecture, API integrations, metric calculations, and tiered product strategy for a scalable, location-based Market Intelligence platform. The system generates actionable market reports for local and regional businesses across retail, services, healthcare, automotive, food, and professional services industries.

---

## 1. Data Model

### 1.1 Entity Relationship Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MARKET INTELLIGENCE DATA MODEL                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐                │
│  │  DIM_GEO     │     │ DIM_INDUSTRY │     │  DIM_TIME    │                │
│  │  ──────────  │     │  ──────────  │     │  ──────────  │                │
│  │  geo_id (PK) │     │ naics_code   │     │  time_id     │                │
│  │  city        │     │ (PK)         │     │  (PK)        │                │
│  │  county_fips │     │ sector       │     │  year        │                │
│  │  state_fips  │     │ subsector    │     │  quarter     │                │
│  │  cbsa_code   │     │ industry_grp │     │  month       │                │
│  │  lat/lng     │     │ naics_title  │     │  period_type │                │
│  └──────┬───────┘     └──────┬───────┘     └──────┬───────┘                │
│         │                    │                    │                         │
│         └────────────────────┼────────────────────┘                         │
│                              │                                              │
│                              ▼                                              │
│  ┌───────────────────────────────────────────────────────────────────┐     │
│  │                        FACT TABLES                                 │     │
│  ├───────────────────────────────────────────────────────────────────┤     │
│  │  FACT_COMPETITORS  │  FACT_DEMOGRAPHICS  │  FACT_BUSINESS_DENSITY │     │
│  │  FACT_MARKET_SIZE  │  FACT_DEMAND_SIGNAL │  FACT_COMMUTE_PATTERNS │     │
│  └───────────────────────────────────────────────────────────────────┘     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Dimension Tables

#### DIM_GEOGRAPHY
Primary geographic dimension supporting hierarchical rollups.

```sql
CREATE TABLE dim_geography (
    geo_id              VARCHAR(20) PRIMARY KEY,  -- Composite: state_fips + county_fips + place_fips

    -- Hierarchy Level 1: State
    state_fips          CHAR(2) NOT NULL,
    state_abbr          CHAR(2) NOT NULL,
    state_name          VARCHAR(50) NOT NULL,

    -- Hierarchy Level 2: County
    county_fips         CHAR(5),                  -- Full FIPS (state + county)
    county_name         VARCHAR(100),

    -- Hierarchy Level 3: City/Place
    place_fips          CHAR(7),                  -- Census Place FIPS
    city_name           VARCHAR(100),

    -- Metro Area (Cross-cutting)
    cbsa_code           CHAR(5),                  -- Core Based Statistical Area
    cbsa_name           VARCHAR(150),
    metro_division_code CHAR(5),

    -- ZIP Code (for granular matching)
    primary_zip         CHAR(5),

    -- Coordinates (centroid)
    latitude            DECIMAL(9,6),
    longitude           DECIMAL(10,6),

    -- Classification
    urban_rural_code    CHAR(1),                  -- U=Urban, R=Rural, S=Suburban
    land_area_sq_miles  DECIMAL(12,2),

    -- Metadata
    data_year           INT,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Indexes for hierarchy queries
    INDEX idx_state (state_fips),
    INDEX idx_county (county_fips),
    INDEX idx_cbsa (cbsa_code),
    INDEX idx_coords (latitude, longitude)
);
```

#### DIM_INDUSTRY (NAICS-Based)
Full NAICS taxonomy with PathSynch display mappings.

```sql
CREATE TABLE dim_industry (
    naics_code          VARCHAR(6) PRIMARY KEY,   -- 2-6 digit NAICS
    naics_level         TINYINT NOT NULL,         -- 2=Sector, 3=Subsector, 4=Industry Group, 5=Industry, 6=National

    -- NAICS Hierarchy
    sector_code         CHAR(2) NOT NULL,         -- First 2 digits
    sector_name         VARCHAR(100),
    subsector_code      CHAR(3),                  -- First 3 digits
    subsector_name      VARCHAR(100),
    industry_group_code CHAR(4),                  -- First 4 digits
    industry_group_name VARCHAR(100),
    naics_title         VARCHAR(200) NOT NULL,    -- Official title
    naics_description   TEXT,

    -- PathSynch Display Mapping
    display_category    VARCHAR(50),              -- "Food & Beverage", "Automotive", etc.
    display_subcategory VARCHAR(50),              -- "Fast Casual", "Fine Dining", etc.

    -- Google Places Mapping
    places_keyword      VARCHAR(200),             -- Search query for Google Places
    places_types        JSON,                     -- Array of place_type values

    -- Industry Characteristics
    avg_revenue_per_establishment  DECIMAL(15,2),
    avg_employees_per_establishment DECIMAL(8,2),
    typical_price_level            TINYINT,       -- 1-4 scale
    seasonality_pattern            VARCHAR(20),   -- "stable", "summer_peak", "holiday_peak", etc.

    -- Metadata
    naics_version       VARCHAR(10) DEFAULT '2022',
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_sector (sector_code),
    INDEX idx_display (display_category, display_subcategory)
);
```

**PathSynch Industry Mapping Table:**

| display_category | display_subcategory | naics_code | naics_title | places_keyword |
|-----------------|---------------------|------------|-------------|----------------|
| Food & Beverage | Full Service Restaurant | 722511 | Full-Service Restaurants | restaurant |
| Food & Beverage | Fast Casual | 722513 | Limited-Service Restaurants | fast food OR quick service |
| Food & Beverage | Coffee & Cafe | 722515 | Snack and Nonalcoholic Beverage Bars | cafe OR coffee shop |
| Food & Beverage | Bar & Nightlife | 722410 | Drinking Places | bar OR pub OR nightclub |
| Automotive | Auto Repair | 811111 | General Automotive Repair | auto repair OR mechanic |
| Automotive | Car Dealership | 441110 | New Car Dealers | car dealer |
| Automotive | Auto Parts | 441310 | Automotive Parts and Accessories Retailers | auto parts store |
| Health & Wellness | Gym & Fitness | 713940 | Fitness and Recreational Sports Centers | gym OR fitness center |
| Health & Wellness | Spa & Massage | 812199 | Other Personal Care Services | spa OR massage |
| Health & Wellness | Medical Practice | 621111 | Offices of Physicians | doctor OR medical clinic |
| Health & Wellness | Dental Practice | 621210 | Offices of Dentists | dentist |
| Health & Wellness | Chiropractic | 621310 | Offices of Chiropractors | chiropractor |
| Home Services | Plumbing | 238220 | Plumbing, Heating, and AC Contractors | plumber |
| Home Services | Electrical | 238210 | Electrical Contractors | electrician |
| Home Services | HVAC | 238220 | Plumbing, Heating, and AC Contractors | hvac OR air conditioning |
| Home Services | Roofing | 238160 | Roofing Contractors | roofing contractor |
| Home Services | Landscaping | 561730 | Landscaping Services | landscaping OR lawn care |
| Professional Services | Legal | 541110 | Offices of Lawyers | lawyer OR attorney |
| Professional Services | Accounting | 541211 | Offices of CPAs | accountant OR cpa |
| Professional Services | Real Estate | 531210 | Offices of Real Estate Agents | real estate agent |
| Professional Services | Insurance | 524210 | Insurance Agencies | insurance agent |
| Retail | General Merchandise | 452319 | All Other General Merchandise Stores | retail store |
| Retail | Clothing | 448140 | Family Clothing Stores | clothing store |
| Retail | Electronics | 443142 | Electronics Stores | electronics store |
| Salon & Beauty | Hair Salon | 812111 | Barber Shops | hair salon OR barber |
| Salon & Beauty | Nail Salon | 812113 | Nail Salons | nail salon |
| Salon & Beauty | Beauty Salon | 812112 | Beauty Salons | beauty salon |

#### DIM_TIME
Time dimension supporting multiple granularities.

```sql
CREATE TABLE dim_time (
    time_id             INT PRIMARY KEY,          -- YYYYMMDD or YYYYQQ format

    -- Date Components
    calendar_date       DATE,
    year                SMALLINT NOT NULL,
    quarter             TINYINT,                  -- 1-4
    month               TINYINT,                  -- 1-12
    month_name          VARCHAR(15),

    -- Period Type
    period_type         VARCHAR(10) NOT NULL,     -- 'annual', 'quarterly', 'monthly'

    -- Fiscal Alignment
    fiscal_year         SMALLINT,
    fiscal_quarter      TINYINT,

    -- Relative Flags
    is_current_period   BOOLEAN DEFAULT FALSE,
    is_ytd              BOOLEAN DEFAULT FALSE,
    periods_ago         INT,                      -- 0=current, 1=previous, etc.

    -- Data Availability Flags
    acs_data_available  BOOLEAN DEFAULT FALSE,
    cbp_data_available  BOOLEAN DEFAULT FALSE,
    qcew_data_available BOOLEAN DEFAULT FALSE,

    INDEX idx_year_quarter (year, quarter),
    INDEX idx_period_type (period_type)
);
```

#### DIM_DEMOGRAPHIC_SEGMENT
Predefined demographic segments for analysis.

```sql
CREATE TABLE dim_demographic_segment (
    segment_id          INT PRIMARY KEY AUTO_INCREMENT,
    segment_type        VARCHAR(30) NOT NULL,     -- 'age_group', 'education', 'income_bracket', 'commute_mode'
    segment_code        VARCHAR(20) NOT NULL,
    segment_name        VARCHAR(50) NOT NULL,
    segment_description VARCHAR(200),

    -- Display Properties
    display_order       INT,
    color_code          VARCHAR(7),               -- Hex color for charts

    -- Census Variable Mapping
    acs_variable_code   VARCHAR(20),              -- e.g., 'B01001_003E' for age

    UNIQUE KEY uk_segment (segment_type, segment_code)
);

-- Seed Data
INSERT INTO dim_demographic_segment (segment_type, segment_code, segment_name, acs_variable_code) VALUES
-- Age Groups
('age_group', 'young_pro', 'Young Professionals (25-34)', 'B01001_011E,B01001_035E'),
('age_group', 'families', 'Families (35-54)', 'B01001_012E,B01001_013E,B01001_036E,B01001_037E'),
('age_group', 'retirees', 'Retirees (65+)', 'B01001_020E-B01001_025E,B01001_044E-B01001_049E'),
-- Education Levels
('education', 'high_school', 'High School Diploma', 'B15003_017E,B15003_018E'),
('education', 'some_college', 'Some College / Associates', 'B15003_019E,B15003_020E,B15003_021E'),
('education', 'bachelors', 'Bachelor''s Degree', 'B15003_022E'),
('education', 'graduate', 'Graduate / Professional', 'B15003_023E,B15003_024E,B15003_025E'),
-- Income Brackets
('income', 'low', 'Under $35K', 'B19001_002E-B19001_007E'),
('income', 'middle', '$35K - $75K', 'B19001_008E-B19001_011E'),
('income', 'upper_middle', '$75K - $150K', 'B19001_012E-B19001_014E'),
('income', 'high', '$150K+', 'B19001_015E-B19001_017E'),
-- Commute Modes
('commute', 'drive_alone', 'Drive Alone', 'B08301_003E'),
('commute', 'carpool', 'Carpool', 'B08301_004E'),
('commute', 'transit', 'Public Transit', 'B08301_010E'),
('commute', 'walk', 'Walk', 'B08301_019E'),
('commute', 'wfh', 'Work from Home', 'B08301_021E');
```

### 1.3 Fact Tables

#### FACT_COMPETITORS
Real-time competitor data from Google Places.

```sql
CREATE TABLE fact_competitors (
    competitor_id       VARCHAR(50) PRIMARY KEY,  -- Google place_id

    -- Dimension Keys
    geo_id              VARCHAR(20) NOT NULL,
    naics_code          VARCHAR(6),
    captured_at         TIMESTAMP NOT NULL,

    -- Business Attributes
    business_name       VARCHAR(200) NOT NULL,
    formatted_address   VARCHAR(300),
    latitude            DECIMAL(9,6),
    longitude           DECIMAL(10,6),

    -- Competitive Metrics
    rating              DECIMAL(2,1),             -- 1.0 - 5.0
    review_count        INT DEFAULT 0,
    price_level         TINYINT,                  -- 1-4

    -- Operational
    is_open_now         BOOLEAN,
    hours_json          JSON,                     -- Opening hours by day
    website             VARCHAR(500),
    phone               VARCHAR(20),

    -- Google Places Metadata
    place_types         JSON,                     -- Array of types
    business_status     VARCHAR(20),              -- OPERATIONAL, CLOSED_TEMPORARILY, etc.

    -- Derived Fields
    rating_tier         VARCHAR(10) AS (
        CASE
            WHEN rating >= 4.5 THEN 'excellent'
            WHEN rating >= 4.0 THEN 'good'
            WHEN rating >= 3.0 THEN 'average'
            ELSE 'poor'
        END
    ) STORED,

    review_volume_tier  VARCHAR(10) AS (
        CASE
            WHEN review_count >= 500 THEN 'high'
            WHEN review_count >= 100 THEN 'medium'
            WHEN review_count >= 20 THEN 'low'
            ELSE 'minimal'
        END
    ) STORED,

    -- Tracking
    first_seen_at       TIMESTAMP,
    last_updated_at     TIMESTAMP,
    is_active           BOOLEAN DEFAULT TRUE,

    FOREIGN KEY (geo_id) REFERENCES dim_geography(geo_id),
    INDEX idx_geo_naics (geo_id, naics_code),
    INDEX idx_rating (rating DESC),
    INDEX idx_location (latitude, longitude)
);
```

#### FACT_DEMOGRAPHICS
Census demographic data at geographic level.

```sql
CREATE TABLE fact_demographics (
    fact_id             BIGINT PRIMARY KEY AUTO_INCREMENT,

    -- Dimension Keys
    geo_id              VARCHAR(20) NOT NULL,
    time_id             INT NOT NULL,
    segment_id          INT,                      -- NULL for totals

    -- Population Metrics
    total_population    INT,
    population_density  DECIMAL(10,2),            -- Per square mile

    -- Age Distribution
    pop_under_18        INT,
    pop_18_24           INT,
    pop_25_34           INT,                      -- Young professionals
    pop_35_44           INT,
    pop_45_54           INT,
    pop_55_64           INT,
    pop_65_plus         INT,                      -- Retirees
    median_age          DECIMAL(4,1),

    -- Household Metrics
    total_households    INT,
    avg_household_size  DECIMAL(3,2),
    family_households   INT,
    nonfamily_households INT,

    -- Income Metrics
    median_household_income     INT,
    mean_household_income       INT,
    per_capita_income           INT,
    households_under_35k        INT,
    households_35k_75k          INT,
    households_75k_150k         INT,
    households_150k_plus        INT,

    -- Education (25+ population)
    pop_25_plus                 INT,
    edu_less_than_hs           INT,
    edu_high_school            INT,
    edu_some_college           INT,
    edu_bachelors              INT,
    edu_graduate               INT,
    pct_bachelors_plus         DECIMAL(5,2) AS (
        CASE WHEN pop_25_plus > 0
        THEN ((edu_bachelors + edu_graduate) / pop_25_plus) * 100
        ELSE NULL END
    ) STORED,

    -- Housing
    total_housing_units        INT,
    occupied_units             INT,
    owner_occupied             INT,
    renter_occupied            INT,
    homeownership_rate         DECIMAL(5,2) AS (
        CASE WHEN occupied_units > 0
        THEN (owner_occupied / occupied_units) * 100
        ELSE NULL END
    ) STORED,
    median_home_value          INT,
    median_rent                INT,

    -- Employment
    labor_force                INT,
    employed                   INT,
    unemployed                 INT,
    unemployment_rate          DECIMAL(5,2),

    -- Data Source
    source_dataset             VARCHAR(20),       -- 'ACS_5YR', 'ACS_1YR', 'DECENNIAL'
    margin_of_error_flag       BOOLEAN DEFAULT FALSE,

    FOREIGN KEY (geo_id) REFERENCES dim_geography(geo_id),
    FOREIGN KEY (time_id) REFERENCES dim_time(time_id),
    UNIQUE KEY uk_geo_time (geo_id, time_id),
    INDEX idx_income (median_household_income)
);
```

#### FACT_COMMUTE_PATTERNS
Transportation and accessibility metrics.

```sql
CREATE TABLE fact_commute_patterns (
    fact_id             BIGINT PRIMARY KEY AUTO_INCREMENT,

    -- Dimension Keys
    geo_id              VARCHAR(20) NOT NULL,
    time_id             INT NOT NULL,

    -- Total Workers
    total_workers       INT,

    -- Mode of Transportation
    commute_drive_alone     INT,
    commute_carpool         INT,
    commute_public_transit  INT,
    commute_walk            INT,
    commute_bike            INT,
    commute_other           INT,
    commute_wfh             INT,

    -- Percentages (derived)
    pct_drive               DECIMAL(5,2) AS (
        CASE WHEN total_workers > 0
        THEN ((commute_drive_alone + commute_carpool) / total_workers) * 100
        ELSE NULL END
    ) STORED,
    pct_walkable            DECIMAL(5,2) AS (
        CASE WHEN total_workers > 0
        THEN ((commute_walk + commute_bike + commute_public_transit) / total_workers) * 100
        ELSE NULL END
    ) STORED,

    -- Commute Time
    avg_commute_minutes     DECIMAL(5,2),
    commute_under_15min     INT,
    commute_15_29min        INT,
    commute_30_44min        INT,
    commute_45_59min        INT,
    commute_60plus_min      INT,

    -- Derived Accessibility Score (0-100)
    walkability_score       DECIMAL(5,2) AS (
        CASE WHEN total_workers > 0 THEN
            LEAST(100, (
                (commute_walk / total_workers * 50) +
                (commute_public_transit / total_workers * 30) +
                (commute_bike / total_workers * 20)
            ) * 100)
        ELSE NULL END
    ) STORED,

    -- Data Source
    source_dataset          VARCHAR(20),

    FOREIGN KEY (geo_id) REFERENCES dim_geography(geo_id),
    FOREIGN KEY (time_id) REFERENCES dim_time(time_id),
    UNIQUE KEY uk_geo_time (geo_id, time_id)
);
```

#### FACT_BUSINESS_DENSITY
Establishment counts and trends from CBP/QCEW.

```sql
CREATE TABLE fact_business_density (
    fact_id             BIGINT PRIMARY KEY AUTO_INCREMENT,

    -- Dimension Keys
    geo_id              VARCHAR(20) NOT NULL,
    naics_code          VARCHAR(6) NOT NULL,
    time_id             INT NOT NULL,

    -- Establishment Counts (CBP)
    establishment_count     INT,
    establishments_1_4      INT,                  -- 1-4 employees
    establishments_5_9      INT,
    establishments_10_19    INT,
    establishments_20_49    INT,
    establishments_50_99    INT,
    establishments_100_plus INT,

    -- Employment (QCEW/CBP)
    total_employees         INT,
    annual_payroll          BIGINT,               -- In thousands
    avg_weekly_wage         INT,

    -- Derived Metrics
    avg_employees_per_establishment DECIMAL(8,2) AS (
        CASE WHEN establishment_count > 0
        THEN total_employees / establishment_count
        ELSE NULL END
    ) STORED,

    establishments_per_10k_pop      DECIMAL(8,2),  -- Calculated during ETL

    -- Year-over-Year Changes (calculated during ETL)
    establishment_count_yoy         INT,
    establishment_growth_rate       DECIMAL(6,2),  -- Percentage
    employment_growth_rate          DECIMAL(6,2),

    -- Net Business Activity
    net_new_establishments          INT,           -- Openings minus closures

    -- Data Source
    source_dataset                  VARCHAR(20),   -- 'CBP', 'QCEW'
    data_suppression_flag           BOOLEAN DEFAULT FALSE,

    FOREIGN KEY (geo_id) REFERENCES dim_geography(geo_id),
    FOREIGN KEY (naics_code) REFERENCES dim_industry(naics_code),
    FOREIGN KEY (time_id) REFERENCES dim_time(time_id),
    UNIQUE KEY uk_geo_naics_time (geo_id, naics_code, time_id),
    INDEX idx_growth (establishment_growth_rate DESC)
);
```

#### FACT_DEMAND_SIGNALS
Google Trends and search demand data.

```sql
CREATE TABLE fact_demand_signals (
    fact_id             BIGINT PRIMARY KEY AUTO_INCREMENT,

    -- Dimension Keys
    geo_id              VARCHAR(20) NOT NULL,     -- State or Metro level
    naics_code          VARCHAR(6) NOT NULL,
    time_id             INT NOT NULL,

    -- Google Trends Data
    search_term             VARCHAR(200),
    trends_interest         INT,                  -- 0-100 relative interest
    trends_interest_yoy     INT,                  -- Change from same period last year

    -- Seasonality
    seasonal_index          DECIMAL(5,2),         -- 100 = average month
    peak_month              TINYINT,              -- 1-12
    trough_month            TINYINT,
    seasonality_amplitude   DECIMAL(5,2),         -- Peak/trough ratio

    -- Trend Direction
    trend_direction         VARCHAR(10),          -- 'rising', 'stable', 'declining'
    trend_strength          DECIMAL(5,2),         -- Slope magnitude

    -- Derived Momentum Score
    momentum_score          DECIMAL(5,2) AS (
        CASE
            WHEN trends_interest_yoy > 20 THEN LEAST(100, 70 + trends_interest_yoy / 2)
            WHEN trends_interest_yoy > 0 THEN 50 + trends_interest_yoy
            WHEN trends_interest_yoy > -20 THEN 50 + trends_interest_yoy
            ELSE GREATEST(0, 30 + trends_interest_yoy)
        END
    ) STORED,

    FOREIGN KEY (geo_id) REFERENCES dim_geography(geo_id),
    FOREIGN KEY (naics_code) REFERENCES dim_industry(naics_code),
    FOREIGN KEY (time_id) REFERENCES dim_time(time_id),
    INDEX idx_geo_naics (geo_id, naics_code)
);
```

#### FACT_MARKET_METRICS (Aggregated)
Pre-calculated market-level metrics for fast retrieval.

```sql
CREATE TABLE fact_market_metrics (
    metric_id           BIGINT PRIMARY KEY AUTO_INCREMENT,

    -- Dimension Keys
    geo_id              VARCHAR(20) NOT NULL,
    naics_code          VARCHAR(6) NOT NULL,
    time_id             INT NOT NULL,

    -- Core Market Metrics
    market_size_estimate        BIGINT,           -- Total addressable market ($)
    market_size_per_capita      DECIMAL(10,2),

    -- Competition Metrics
    competitor_count            INT,
    competitors_per_10k_pop     DECIMAL(6,2),
    avg_competitor_rating       DECIMAL(3,2),
    total_market_reviews        INT,

    -- Saturation Score (0-100)
    saturation_score            DECIMAL(5,2),
    saturation_level            VARCHAR(10),      -- 'low', 'medium', 'high'

    -- Growth Metrics
    market_growth_rate          DECIMAL(6,2),     -- Annual %
    establishment_growth_rate   DECIMAL(6,2),
    demand_growth_rate          DECIMAL(6,2),

    -- Opportunity Scoring
    opportunity_score           DECIMAL(5,2),     -- 0-100 composite
    opportunity_level           VARCHAR(15),      -- 'high', 'medium', 'low'
    opportunity_factors         JSON,             -- Contributing factors breakdown

    -- Demand Signals
    search_demand_index         INT,              -- 0-100
    seasonality_factor          DECIMAL(5,2),
    trend_direction             VARCHAR(10),

    -- Target Customer Profile
    primary_age_segment         VARCHAR(30),
    primary_income_segment      VARCHAR(30),
    primary_education_segment   VARCHAR(30),

    -- Competitive Positioning
    avg_price_level             DECIMAL(3,2),
    price_gap_opportunity       VARCHAR(20),      -- 'premium', 'value', 'balanced'
    quality_gap_opportunity     DECIMAL(5,2),     -- Rating gap to fill

    -- Data Quality
    data_completeness_score     DECIMAL(5,2),     -- % of metrics available
    last_calculated_at          TIMESTAMP,
    calculation_version         VARCHAR(10),

    FOREIGN KEY (geo_id) REFERENCES dim_geography(geo_id),
    FOREIGN KEY (naics_code) REFERENCES dim_industry(naics_code),
    FOREIGN KEY (time_id) REFERENCES dim_time(time_id),
    UNIQUE KEY uk_geo_naics_time (geo_id, naics_code, time_id),
    INDEX idx_opportunity (opportunity_score DESC)
);
```

### 1.4 Derived & Calculated Fields Summary

| Field | Formula | Dependencies | Update Frequency |
|-------|---------|--------------|------------------|
| `market_size_estimate` | households × median_income × industry_spend_rate | Demographics, Industry config | Quarterly |
| `saturation_score` | f(competitors_per_sqmi, avg_rating, review_density) | Competitors, Geography | Daily |
| `opportunity_score` | Weighted: 30% low_saturation + 25% high_demand + 25% income_fit + 20% growth | Multiple | Daily |
| `establishments_per_10k_pop` | (establishment_count / population) × 10,000 | CBP, Demographics | Annual |
| `walkability_score` | (walk% × 50 + transit% × 30 + bike% × 20) × 100 | Commute Patterns | Annual |
| `momentum_score` | Normalized trends_interest_yoy | Google Trends | Weekly |

---

## 2. API & Query Design

### 2.1 Google Places API

**Purpose:** Real-time competitor discovery, ratings, reviews, and business details.

**APIs Used:**
- Places API (New): Nearby Search, Text Search, Place Details
- Geocoding API: Address to coordinates conversion

#### Nearby Search (Find Competitors)

```javascript
// REST Endpoint (New API)
POST https://places.googleapis.com/v1/places:searchNearby

// Headers
{
  "Content-Type": "application/json",
  "X-Goog-Api-Key": "YOUR_API_KEY",
  "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.types,places.regularOpeningHours,places.websiteUri,places.businessStatus"
}

// Request Body
{
  "includedTypes": ["restaurant"],  // Or specific type
  "maxResultCount": 20,
  "locationRestriction": {
    "circle": {
      "center": {
        "latitude": 30.2672,
        "longitude": -97.7431
      },
      "radius": 5000.0  // meters
    }
  },
  "rankPreference": "DISTANCE"
}
```

#### Text Search (Industry + Location)

```javascript
// REST Endpoint
POST https://places.googleapis.com/v1/places:searchText

// Request Body
{
  "textQuery": "auto repair shops in Austin, Texas",
  "maxResultCount": 20,
  "locationBias": {
    "circle": {
      "center": { "latitude": 30.2672, "longitude": -97.7431 },
      "radius": 10000.0
    }
  }
}
```

#### Place Details (Competitor Deep-Dive)

```javascript
// REST Endpoint
GET https://places.googleapis.com/v1/places/{place_id}

// Headers
{
  "X-Goog-Api-Key": "YOUR_API_KEY",
  "X-Goog-FieldMask": "id,displayName,formattedAddress,location,rating,userRatingCount,priceLevel,types,regularOpeningHours,websiteUri,nationalPhoneNumber,reviews"
}
```

**Parameters & Resolution:**

| Parameter | Description | Resolution |
|-----------|-------------|------------|
| `locationRestriction.circle.radius` | Search radius in meters | Point + radius (1m - 50km) |
| `includedTypes` | Google place types | See [Place Types](https://developers.google.com/maps/documentation/places/web-service/place-types) |
| `maxResultCount` | Results per request | 1-20 |

**Industry Type Mapping:**

```javascript
const NAICS_TO_PLACES_TYPES = {
  '722511': ['restaurant', 'american_restaurant', 'italian_restaurant'],
  '722513': ['fast_food_restaurant', 'meal_takeaway'],
  '722515': ['cafe', 'coffee_shop'],
  '811111': ['car_repair', 'auto_repair'],
  '713940': ['gym', 'fitness_center'],
  '812111': ['hair_salon', 'barber_shop'],
  '621111': ['doctor', 'medical_clinic'],
  '541110': ['lawyer', 'law_firm']
};
```

**Update Frequency:** Real-time (on-demand), cache for 24 hours

**Limitations & Caveats:**
- Maximum 20 results per request (use pagination token for more)
- Rate limits: 100 requests/second per project
- Reviews limited to 5 most recent per place
- Price level not available for all businesses
- No historical data (current snapshot only)

**Cost:** ~$32 per 1,000 Nearby Search requests (Essentials tier)

---

### 2.2 US Census Bureau - American Community Survey (ACS)

**Purpose:** Demographics, income, education, housing, commute patterns.

**API:** Census Data API (data.census.gov/api)

**Dataset:** ACS 5-Year Estimates (most granular geography, most stable estimates)

#### Base URL Structure

```
https://api.census.gov/data/{year}/acs/acs5?get={variables}&for={geography}&key={api_key}
```

#### Core Demographic Query

```javascript
// Population, Age, Income, Education for a County
GET https://api.census.gov/data/2022/acs/acs5?get=NAME,B01003_001E,B01002_001E,B19013_001E,B15003_022E,B15003_023E,B15003_024E,B15003_025E&for=county:453&in=state:48&key=YOUR_KEY

// Variables:
// B01003_001E = Total Population
// B01002_001E = Median Age
// B19013_001E = Median Household Income
// B15003_022E = Bachelor's Degree
// B15003_023E = Master's Degree
// B15003_024E = Professional Degree
// B15003_025E = Doctorate
```

#### Age Distribution Query

```javascript
// Detailed age groups
GET https://api.census.gov/data/2022/acs/acs5?get=NAME,B01001_001E,B01001_007E,B01001_008E,B01001_009E,B01001_010E,B01001_011E,B01001_012E,B01001_020E,B01001_021E,B01001_022E,B01001_023E,B01001_024E,B01001_025E&for=place:05000&in=state:48&key=YOUR_KEY

// Age group variables (Male - add 24 to get Female equivalents):
// B01001_007E = 18-19 years
// B01001_008E = 20 years
// B01001_009E = 21 years
// B01001_010E = 22-24 years
// B01001_011E = 25-29 years
// B01001_012E = 30-34 years
// B01001_020E = 65-66 years
// B01001_021E = 67-69 years
// B01001_022E = 70-74 years
// B01001_023E = 75-79 years
// B01001_024E = 80-84 years
// B01001_025E = 85+ years
```

#### Commute Patterns Query

```javascript
// Transportation mode and commute time
GET https://api.census.gov/data/2022/acs/acs5?get=NAME,B08301_001E,B08301_003E,B08301_004E,B08301_010E,B08301_019E,B08301_021E,B08303_001E,B08303_002E,B08303_003E,B08303_004E&for=county:453&in=state:48&key=YOUR_KEY

// Variables:
// B08301_001E = Total workers 16+
// B08301_003E = Car, truck, van - drove alone
// B08301_004E = Car, truck, van - carpooled
// B08301_010E = Public transportation
// B08301_019E = Walked
// B08301_021E = Worked from home
// B08303_002E = Less than 10 minutes
// B08303_003E = 10 to 14 minutes
// B08303_004E = 15 to 19 minutes
```

#### Income Distribution Query

```javascript
// Household income brackets
GET https://api.census.gov/data/2022/acs/acs5?get=NAME,B19001_001E,B19001_002E,B19001_003E,B19001_004E,B19001_005E,B19001_006E,B19001_007E,B19001_008E,B19001_009E,B19001_010E,B19001_011E,B19001_012E,B19001_013E,B19001_014E,B19001_015E,B19001_016E,B19001_017E&for=place:05000&in=state:48&key=YOUR_KEY

// Variables:
// B19001_002E = Less than $10,000
// B19001_003E = $10,000 to $14,999
// ... up to ...
// B19001_017E = $200,000 or more
```

**Geographic Resolution:**

| Geography | FIPS Format | Example | ACS 5-Year Available |
|-----------|-------------|---------|---------------------|
| State | `state:XX` | `state:48` (Texas) | Yes |
| County | `county:XXX&in=state:XX` | `county:453&in=state:48` (Travis) | Yes |
| Place (City) | `place:XXXXX&in=state:XX` | `place:05000&in=state:48` (Austin) | Yes |
| ZIP Code (ZCTA) | `zip code tabulation area:XXXXX` | `zcta:78701` | Yes |
| Census Tract | `tract:XXXXXX&in=state:XX&in=county:XXX` | `tract:001700&in=state:48&in=county:453` | Yes |

**Update Frequency:** Annual (December release for prior year)

**Limitations:**
- 5-year estimates lag 2 years (2022 data released Dec 2023)
- Small geographies have higher margins of error
- Some variables suppressed for privacy in small areas
- 50 variables per query limit

**Cost:** Free (requires API key registration)

---

### 2.3 County Business Patterns (CBP)

**Purpose:** Establishment counts, employment, and payroll by NAICS and geography.

**API:** Census Data API

#### Establishment Count by NAICS

```javascript
// Restaurants in Travis County, TX
GET https://api.census.gov/data/2021/cbp?get=NAME,NAICS2017,NAICS2017_LABEL,ESTAB,EMP,PAYANN&for=county:453&in=state:48&NAICS2017=722511&key=YOUR_KEY

// Variables:
// ESTAB = Number of establishments
// EMP = Number of employees (mid-March)
// PAYANN = Annual payroll ($1,000)
```

#### Establishment Size Distribution

```javascript
// Establishments by employee size class
GET https://api.census.gov/data/2021/cbp?get=NAME,NAICS2017,ESTAB,EMP_SIZE_CODE,EMP_SIZE_CLASS&for=county:453&in=state:48&NAICS2017=722511&key=YOUR_KEY

// EMP_SIZE_CODE values:
// 210 = 1-4 employees
// 220 = 5-9 employees
// 230 = 10-19 employees
// 241 = 20-49 employees
// 242 = 50-99 employees
// 251 = 100-249 employees
// 252 = 250-499 employees
// 254 = 500-999 employees
// 260 = 1000+ employees
```

#### Multi-Year Trend Query (requires multiple calls)

```javascript
// 2019 data
GET https://api.census.gov/data/2019/cbp?get=ESTAB,EMP&for=county:453&in=state:48&NAICS2017=722511&key=YOUR_KEY

// 2020 data
GET https://api.census.gov/data/2020/cbp?get=ESTAB,EMP&for=county:453&in=state:48&NAICS2017=722511&key=YOUR_KEY

// 2021 data
GET https://api.census.gov/data/2021/cbp?get=ESTAB,EMP&for=county:453&in=state:48&NAICS2017=722511&key=YOUR_KEY
```

**Geographic Resolution:**

| Geography | Support | Notes |
|-----------|---------|-------|
| National | Yes | `for=us:*` |
| State | Yes | `for=state:XX` |
| County | Yes | `for=county:XXX&in=state:XX` |
| Metro (CBSA) | Yes | `for=metropolitan statistical area/micropolitan statistical area:XXXXX` |
| ZIP Code | Yes | `for=zipcode:XXXXX` |
| Place (City) | No | Must aggregate from ZIP or county |

**NAICS Support:**
- Full 6-digit NAICS hierarchy
- Can query at any level (2, 3, 4, 5, or 6 digits)
- NAICS2017 codes used through 2022 data

**Update Frequency:** Annual (April release for 2 years prior)

**Limitations:**
- Data suppression for privacy (when few establishments)
- Employment often suppressed at detailed NAICS + small geography
- No quarterly or monthly data
- 2-year lag in data availability

**Cost:** Free

---

### 2.4 Bureau of Labor Statistics - QCEW

**Purpose:** Quarterly employment, wages, and establishment counts (more current than CBP).

**API:** BLS Public Data API

#### Single Area, Single Industry Query

```javascript
// API Endpoint
POST https://api.bls.gov/publicAPI/v2/timeseries/data/

// Request Body
{
  "seriesid": ["ENU4845310511722511"],
  "startyear": "2022",
  "endyear": "2023",
  "registrationkey": "YOUR_KEY"
}

// Series ID Structure: ENU + Area Code + Data Type + NAICS
// ENU = QCEW prefix
// 48453 = Travis County, TX (State FIPS + County FIPS)
// 10 = Total covered (ownership code)
// 5 = Industry level (6-digit NAICS)
// 11 = Average weekly wage (data type)
// 722511 = NAICS code
```

#### Series ID Data Type Codes

| Code | Metric |
|------|--------|
| 1 | All employees |
| 2 | Number of establishments |
| 3 | Total wages (quarterly) |
| 4 | Taxable wages |
| 5 | Contributions |
| 10 | Average weekly wage |
| 11 | Average annual pay |

#### Batch Query (Multiple Series)

```javascript
{
  "seriesid": [
    "ENU4845310511722511",  // Travis County restaurants - avg weekly wage
    "ENU4845310521722511",  // Travis County restaurants - establishments
    "ENU4845310511722511"   // Travis County restaurants - employment
  ],
  "startyear": "2020",
  "endyear": "2023",
  "registrationkey": "YOUR_KEY"
}
```

**Geographic Resolution:**

| Level | Area Code Format | Example |
|-------|-----------------|---------|
| National | US000 | US000 |
| State | SSXXX (SS=state FIPS, XXX=000) | 48000 (Texas) |
| County | SSCCC (CC=county FIPS) | 48453 (Travis County) |
| MSA | CSSSS (C=C, SSSS=MSA code) | C1242 (Austin-Round Rock MSA) |

**NAICS Support:**
- Full 6-digit NAICS
- Aggregations at 2, 3, 4, 5-digit levels
- Special "10" total code for all industries

**Update Frequency:** Quarterly (6-month lag)

**Limitations:**
- 50 series per request limit
- Data suppression for confidentiality
- Registration key required for > 25 requests/day
- Complex series ID construction

**Cost:** Free (registration required for higher limits)

---

### 2.5 Google Trends API

**Purpose:** Search demand signals, seasonality patterns, trend direction.

**Note:** Google Trends has no official public API. Options:

1. **Pytrends (Unofficial Python Library)** - Recommended for backend
2. **SerpAPI Google Trends** - Paid service with official-like access
3. **Manual data export** - Limited scalability

#### Pytrends Implementation

```python
from pytrends.request import TrendReq

pytrends = TrendReq(hl='en-US', tz=360)

# Interest over time for industry keywords
def get_demand_signal(keyword, geo_code, timeframe='today 12-m'):
    """
    geo_code format: 'US-TX' for Texas, 'US-TX-635' for Austin DMA
    """
    pytrends.build_payload(
        kw_list=[keyword],
        cat=0,
        timeframe=timeframe,
        geo=geo_code
    )

    interest_over_time = pytrends.interest_over_time()

    # Calculate metrics
    if not interest_over_time.empty:
        current = interest_over_time[keyword].iloc[-1]
        avg = interest_over_time[keyword].mean()
        yoy_change = (
            (interest_over_time[keyword].iloc[-1] - interest_over_time[keyword].iloc[-52])
            / interest_over_time[keyword].iloc[-52] * 100
            if len(interest_over_time) >= 52 else None
        )

        # Seasonality (monthly averages)
        monthly = interest_over_time.resample('M').mean()
        peak_month = monthly[keyword].idxmax().month
        trough_month = monthly[keyword].idxmin().month
        seasonality_amplitude = monthly[keyword].max() / monthly[keyword].min()

        return {
            'current_interest': current,
            'average_interest': avg,
            'yoy_change': yoy_change,
            'peak_month': peak_month,
            'trough_month': trough_month,
            'seasonality_amplitude': seasonality_amplitude,
            'trend_direction': 'rising' if yoy_change > 5 else 'declining' if yoy_change < -5 else 'stable'
        }

    return None

# Related queries (competitive intelligence)
def get_related_queries(keyword, geo_code):
    pytrends.build_payload([keyword], geo=geo_code)
    related = pytrends.related_queries()

    return {
        'rising': related[keyword]['rising'],
        'top': related[keyword]['top']
    }
```

#### Industry Keyword Mapping

```javascript
const NAICS_TO_TRENDS_KEYWORDS = {
  '722511': ['restaurant near me', 'best restaurants', 'dinner reservations'],
  '722513': ['fast food near me', 'drive thru', 'quick lunch'],
  '811111': ['auto repair near me', 'car mechanic', 'oil change'],
  '713940': ['gym near me', 'fitness classes', 'personal trainer'],
  '812111': ['hair salon near me', 'haircut', 'barber'],
  '541110': ['lawyer near me', 'attorney', 'legal help'],
  '561730': ['lawn care', 'landscaping near me', 'lawn service']
};
```

**Geographic Resolution:**

| Level | Geo Code Format | Example |
|-------|-----------------|---------|
| Country | CC | US |
| State | CC-SS | US-TX |
| DMA (Metro) | CC-SS-DDD | US-TX-635 (Austin) |

**Update Frequency:** Weekly refresh recommended

**Limitations:**
- No official API (unofficial methods may break)
- Data is relative (0-100 scale), not absolute
- Rate limiting with unofficial methods
- DMA-level is coarsest local granularity
- Cannot get city-level data directly

**Cost:**
- Pytrends: Free (rate limited)
- SerpAPI: $50/month for 5,000 searches

---

## 3. Market Metrics Framework

### 3.1 Market Size Estimation

Since direct revenue data is unavailable at the local level, we estimate market size using a consumer expenditure model.

#### Formula

```
Market Size = Households × Median Income × Industry Spend Rate × Local Adjustment Factor
```

#### Detailed Calculation

```javascript
function calculateMarketSize(demographics, industry, competitors) {
  // Base inputs
  const households = demographics.total_households;
  const medianIncome = demographics.median_household_income;

  // Industry spending rates (from Consumer Expenditure Survey)
  const INDUSTRY_SPEND_RATES = {
    '722511': 0.055,  // Full-service restaurants: 5.5% of income
    '722513': 0.035,  // Limited-service restaurants: 3.5%
    '811111': 0.025,  // Auto repair: 2.5%
    '713940': 0.012,  // Fitness: 1.2%
    '812111': 0.008,  // Hair care: 0.8%
    '541110': 0.015,  // Legal services: 1.5%
    '561730': 0.010,  // Landscaping: 1.0%
    // ... more industries
  };

  const spendRate = INDUSTRY_SPEND_RATES[industry.naics_code] || 0.02;

  // Local adjustment factors
  const incomeAdjustment = medianIncome > 75000 ? 1.15 :
                           medianIncome < 45000 ? 0.85 : 1.0;

  const urbanAdjustment = demographics.urban_rural_code === 'U' ? 1.10 :
                          demographics.urban_rural_code === 'R' ? 0.90 : 1.0;

  // Calculate total addressable market
  const totalMarket = Math.round(
    households * medianIncome * spendRate * incomeAdjustment * urbanAdjustment
  );

  // Market per establishment
  const competitorCount = competitors.length || 1;
  const marketPerBusiness = Math.round(totalMarket / (competitorCount + 1));

  return {
    total_addressable_market: totalMarket,
    market_per_business: marketPerBusiness,
    methodology: 'Consumer Expenditure Model',
    inputs: {
      households,
      median_income: medianIncome,
      spend_rate: spendRate * 100, // As percentage
      income_adjustment: incomeAdjustment,
      urban_adjustment: urbanAdjustment
    },
    confidence: calculateConfidence(demographics, industry)
  };
}

function calculateConfidence(demographics, industry) {
  let confidence = 100;

  // Reduce confidence for estimated demographics
  if (demographics.source === 'estimated') confidence -= 20;

  // Reduce for unusual income levels
  if (demographics.median_household_income < 30000 ||
      demographics.median_household_income > 150000) confidence -= 10;

  // Reduce for industries with variable spending
  const volatileIndustries = ['541110', '531210']; // Legal, Real Estate
  if (volatileIndustries.includes(industry.naics_code)) confidence -= 15;

  return Math.max(50, confidence);
}
```

#### Plain English Explanation

> **Market Size** represents the estimated total annual spending by local consumers on this industry. We calculate it by:
> 1. Starting with the number of households in the area
> 2. Multiplying by median household income
> 3. Applying an industry-specific spending rate based on national consumer surveys
> 4. Adjusting for local income levels and urban/rural characteristics
>
> *Example: A market with 50,000 households earning $70,000 median income has an estimated restaurant market of $192M annually (50,000 × $70,000 × 5.5%).*

---

### 3.2 Competitor Density & Saturation

#### Formula

```
Saturation Score = w1(Density Score) + w2(Quality Score) + w3(Activity Score)

Where:
- Density Score = f(competitors per 10,000 population, industry benchmark)
- Quality Score = f(average rating, rating distribution)
- Activity Score = f(total reviews, reviews per competitor)
```

#### Detailed Calculation

```javascript
function calculateSaturation(competitors, demographics, industry) {
  const population = demographics.total_population;
  const competitorCount = competitors.length;

  // Industry benchmarks (competitors per 10K population)
  const DENSITY_BENCHMARKS = {
    '722511': { low: 2, medium: 5, high: 10 },    // Restaurants
    '722513': { low: 3, medium: 8, high: 15 },    // Fast food
    '811111': { low: 1, medium: 3, high: 6 },     // Auto repair
    '713940': { low: 0.5, medium: 1.5, high: 3 }, // Gyms
    '812111': { low: 2, medium: 5, high: 10 },    // Salons
    '541110': { low: 1, medium: 3, high: 7 },     // Lawyers
    // Default
    'default': { low: 1.5, medium: 4, high: 8 }
  };

  const benchmark = DENSITY_BENCHMARKS[industry.naics_code] || DENSITY_BENCHMARKS.default;

  // 1. DENSITY SCORE (0-100)
  const competitorsPer10K = (competitorCount / population) * 10000;
  let densityScore;

  if (competitorsPer10K <= benchmark.low) {
    densityScore = 20; // Low density = low saturation
  } else if (competitorsPer10K <= benchmark.medium) {
    densityScore = 20 + ((competitorsPer10K - benchmark.low) / (benchmark.medium - benchmark.low)) * 30;
  } else if (competitorsPer10K <= benchmark.high) {
    densityScore = 50 + ((competitorsPer10K - benchmark.medium) / (benchmark.high - benchmark.medium)) * 30;
  } else {
    densityScore = Math.min(100, 80 + (competitorsPer10K - benchmark.high) * 2);
  }

  // 2. QUALITY SCORE (0-100) - Higher quality competition = higher saturation
  const ratings = competitors.filter(c => c.rating).map(c => c.rating);
  const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
  const highRatedCount = ratings.filter(r => r >= 4.0).length;
  const highRatedPct = competitorCount > 0 ? (highRatedCount / competitorCount) * 100 : 0;

  const qualityScore = (avgRating / 5 * 50) + (highRatedPct / 100 * 50);

  // 3. ACTIVITY SCORE (0-100) - More reviews = more established market
  const totalReviews = competitors.reduce((sum, c) => sum + (c.review_count || 0), 0);
  const avgReviews = competitorCount > 0 ? totalReviews / competitorCount : 0;

  let activityScore;
  if (totalReviews < 100) activityScore = 10;
  else if (totalReviews < 500) activityScore = 30;
  else if (totalReviews < 2000) activityScore = 50;
  else if (totalReviews < 5000) activityScore = 70;
  else activityScore = 90;

  // Weighted combination
  const saturationScore = Math.round(
    (densityScore * 0.50) +
    (qualityScore * 0.30) +
    (activityScore * 0.20)
  );

  // Determine level
  let saturationLevel;
  if (saturationScore < 35) saturationLevel = 'low';
  else if (saturationScore < 65) saturationLevel = 'medium';
  else saturationLevel = 'high';

  return {
    saturation_score: saturationScore,
    saturation_level: saturationLevel,
    components: {
      density: {
        score: Math.round(densityScore),
        competitors_per_10k: Math.round(competitorsPer10K * 10) / 10,
        benchmark: benchmark
      },
      quality: {
        score: Math.round(qualityScore),
        avg_rating: Math.round(avgRating * 10) / 10,
        high_rated_pct: Math.round(highRatedPct)
      },
      activity: {
        score: Math.round(activityScore),
        total_reviews: totalReviews,
        avg_reviews: Math.round(avgReviews)
      }
    },
    interpretation: getSaturationInterpretation(saturationLevel, densityScore, qualityScore)
  };
}

function getSaturationInterpretation(level, density, quality) {
  if (level === 'low') {
    if (density < 30) return 'Underserved market with few competitors - strong entry opportunity';
    return 'Market has competitors but limited quality options - differentiation opportunity';
  }
  if (level === 'medium') {
    if (quality > 60) return 'Competitive market with quality players - requires strong differentiation';
    return 'Moderate competition with room for quality-focused entrants';
  }
  return 'Highly saturated market - success requires significant competitive advantage';
}
```

#### Plain English Explanation

> **Saturation Score** measures how competitive a market is, combining:
> - **Density (50%)**: How many businesses exist relative to population and industry norms
> - **Quality (30%)**: How well-established competitors are (ratings and reviews)
> - **Activity (20%)**: Total market engagement (review volume indicates customer activity)
>
> | Score | Level | Meaning |
> |-------|-------|---------|
> | 0-34 | Low | Few competitors, potential opportunity |
> | 35-64 | Medium | Moderate competition, differentiation needed |
> | 65-100 | High | Crowded market, significant barriers |

---

### 3.3 Market Growth Rate

#### Formula

```
Growth Rate = w1(Establishment Growth) + w2(Demand Growth) + w3(Demographic Growth)
```

#### Detailed Calculation

```javascript
function calculateGrowthRate(businessDensity, demandSignals, demographics, industry) {
  // 1. ESTABLISHMENT GROWTH (CBP/QCEW data)
  const estabGrowthRate = businessDensity.establishment_growth_rate || 0;

  // Normalize to -20 to +20 range, then scale to component score
  const estabGrowthScore = Math.max(-20, Math.min(20, estabGrowthRate));

  // 2. DEMAND GROWTH (Google Trends YoY)
  const demandYoY = demandSignals?.trends_interest_yoy || 0;
  const demandGrowthScore = Math.max(-20, Math.min(20, demandYoY / 5));

  // 3. DEMOGRAPHIC GROWTH (population trends)
  const popGrowthRate = demographics.population_growth_rate || 0;
  const incomeGrowthRate = demographics.income_growth_rate || 0;

  const demoGrowthScore = (popGrowthRate * 0.6 + incomeGrowthRate * 0.4);

  // Industry base growth rates (BLS projections)
  const INDUSTRY_BASE_GROWTH = {
    '722511': 3.5,   // Restaurants
    '722513': 2.5,   // Fast food
    '811111': 2.0,   // Auto repair
    '713940': 5.0,   // Fitness (high growth)
    '812111': 2.5,   // Salons
    '541110': 1.5,   // Legal (slower)
    '561730': 4.0,   // Landscaping
    'default': 2.5
  };

  const industryBase = INDUSTRY_BASE_GROWTH[industry.naics_code] || INDUSTRY_BASE_GROWTH.default;

  // Combine components
  const compositeGrowth = industryBase +
    (estabGrowthScore * 0.40) +
    (demandGrowthScore * 0.35) +
    (demoGrowthScore * 0.25);

  // Cap at reasonable bounds
  const finalGrowthRate = Math.max(-10, Math.min(15, Math.round(compositeGrowth * 10) / 10));

  // Trend direction
  let trendDirection;
  if (finalGrowthRate > 4) trendDirection = 'strong_growth';
  else if (finalGrowthRate > 1) trendDirection = 'moderate_growth';
  else if (finalGrowthRate > -1) trendDirection = 'stable';
  else if (finalGrowthRate > -4) trendDirection = 'slight_decline';
  else trendDirection = 'declining';

  return {
    annual_growth_rate: finalGrowthRate,
    trend_direction: trendDirection,
    five_year_projection: Math.round((Math.pow(1 + finalGrowthRate / 100, 5) - 1) * 100),
    components: {
      industry_base: industryBase,
      establishment_trend: estabGrowthScore,
      demand_trend: demandGrowthScore,
      demographic_trend: demoGrowthScore
    },
    confidence: calculateGrowthConfidence(businessDensity, demandSignals)
  };
}
```

#### Plain English Explanation

> **Growth Rate** projects the annual market expansion by combining:
> - **Industry Base**: National growth projections for the industry (BLS data)
> - **Local Establishment Trends**: Are businesses opening or closing? (CBP/QCEW data)
> - **Consumer Demand Trends**: Is search interest rising or falling? (Google Trends)
> - **Demographic Trends**: Population and income changes
>
> *A market with 3.5% industry growth, +5% local establishments, and rising search demand would show ~5-6% projected growth.*

---

### 3.4 Opportunity Score

The flagship metric combining all signals into an actionable score.

#### Formula

```
Opportunity Score =
  (100 - Saturation Score) × 0.30 +      // Lower saturation = higher opportunity
  (Growth Score × 0.25) +                 // Higher growth = higher opportunity
  (Income Fit Score × 0.20) +             // Better income fit = higher opportunity
  (Demand Momentum Score × 0.15) +        // Rising demand = higher opportunity
  (Quality Gap Score × 0.10)              // Weak competitor ratings = opportunity
```

#### Detailed Calculation

```javascript
function calculateOpportunityScore(marketMetrics, demographics, competitors, industry) {
  // 1. SATURATION INVERSE (30%)
  const saturationInverse = 100 - marketMetrics.saturation_score;

  // 2. GROWTH SCORE (25%) - Normalize growth rate to 0-100
  const growthRate = marketMetrics.annual_growth_rate;
  const growthScore = Math.max(0, Math.min(100, 50 + (growthRate * 10)));

  // 3. INCOME FIT SCORE (20%) - Does local income match industry?
  const medianIncome = demographics.median_household_income;
  const INDUSTRY_INCOME_SWEET_SPOTS = {
    '722511': { min: 50000, ideal: 80000, max: 150000 },  // Full-service restaurants
    '722513': { min: 30000, ideal: 50000, max: 80000 },   // Fast food
    '713940': { min: 45000, ideal: 75000, max: 120000 },  // Gyms
    '541110': { min: 70000, ideal: 120000, max: 200000 }, // Legal
    'default': { min: 40000, ideal: 65000, max: 120000 }
  };

  const sweetSpot = INDUSTRY_INCOME_SWEET_SPOTS[industry.naics_code] || INDUSTRY_INCOME_SWEET_SPOTS.default;
  let incomeFitScore;

  if (medianIncome >= sweetSpot.min && medianIncome <= sweetSpot.max) {
    // In range - calculate distance from ideal
    const distanceFromIdeal = Math.abs(medianIncome - sweetSpot.ideal);
    const maxDistance = Math.max(sweetSpot.ideal - sweetSpot.min, sweetSpot.max - sweetSpot.ideal);
    incomeFitScore = 100 - ((distanceFromIdeal / maxDistance) * 40); // 60-100 if in range
  } else {
    // Out of range
    const distanceOutside = medianIncome < sweetSpot.min ?
      sweetSpot.min - medianIncome : medianIncome - sweetSpot.max;
    incomeFitScore = Math.max(20, 60 - (distanceOutside / 10000) * 10);
  }

  // 4. DEMAND MOMENTUM (15%)
  const momentumScore = marketMetrics.momentum_score || 50;

  // 5. QUALITY GAP SCORE (10%) - Opportunity if competitors have low ratings
  const ratings = competitors.filter(c => c.rating).map(c => c.rating);
  const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 4.0;
  const lowRatedCount = ratings.filter(r => r < 3.5).length;
  const lowRatedPct = competitors.length > 0 ? (lowRatedCount / competitors.length) : 0;

  // Lower avg rating = more opportunity (quality gap)
  const qualityGapScore = ((5 - avgRating) / 2 * 50) + (lowRatedPct * 50);

  // COMPOSITE SCORE
  const opportunityScore = Math.round(
    (saturationInverse * 0.30) +
    (growthScore * 0.25) +
    (incomeFitScore * 0.20) +
    (momentumScore * 0.15) +
    (qualityGapScore * 0.10)
  );

  // Determine level and label
  let opportunityLevel, opportunityLabel;
  if (opportunityScore >= 70) {
    opportunityLevel = 'high';
    opportunityLabel = 'High Opportunity';
  } else if (opportunityScore >= 50) {
    opportunityLevel = 'medium';
    opportunityLabel = 'Moderate Opportunity';
  } else if (opportunityScore >= 35) {
    opportunityLevel = 'low';
    opportunityLabel = 'Limited Opportunity';
  } else {
    opportunityLevel = 'challenging';
    opportunityLabel = 'Challenging Market';
  }

  // Identify top contributing factors
  const factors = [
    { name: 'Low Competition', score: saturationInverse, weight: 0.30, contribution: saturationInverse * 0.30 },
    { name: 'Market Growth', score: growthScore, weight: 0.25, contribution: growthScore * 0.25 },
    { name: 'Income Match', score: incomeFitScore, weight: 0.20, contribution: incomeFitScore * 0.20 },
    { name: 'Rising Demand', score: momentumScore, weight: 0.15, contribution: momentumScore * 0.15 },
    { name: 'Quality Gap', score: qualityGapScore, weight: 0.10, contribution: qualityGapScore * 0.10 }
  ].sort((a, b) => b.contribution - a.contribution);

  return {
    opportunity_score: opportunityScore,
    opportunity_level: opportunityLevel,
    opportunity_label: opportunityLabel,
    factors: factors,
    top_factors: factors.slice(0, 3).map(f => f.name),
    rationale: generateOpportunityRationale(factors, opportunityLevel)
  };
}

function generateOpportunityRationale(factors, level) {
  const topFactor = factors[0];
  const secondFactor = factors[1];

  if (level === 'high') {
    return `Strong opportunity driven by ${topFactor.name.toLowerCase()} (${Math.round(topFactor.score)}/100) and ${secondFactor.name.toLowerCase()}.`;
  } else if (level === 'medium') {
    return `Moderate opportunity. ${topFactor.name} is favorable, but consider ${factors.find(f => f.score < 50)?.name.toLowerCase() || 'market dynamics'}.`;
  } else {
    const weakestFactor = factors[factors.length - 1];
    return `Challenging market primarily due to ${weakestFactor.name.toLowerCase()}. Success requires strong differentiation.`;
  }
}
```

#### Plain English Explanation

> **Opportunity Score** is your go/no-go indicator, answering: "How attractive is this market for a new business?"
>
> | Score | Label | Recommendation |
> |-------|-------|----------------|
> | 70-100 | High Opportunity | Strong market entry potential |
> | 50-69 | Moderate Opportunity | Viable with differentiation |
> | 35-49 | Limited Opportunity | Requires careful positioning |
> | 0-34 | Challenging Market | Consider alternative locations |
>
> The score weighs:
> - **30% Competition Level**: Fewer competitors = more room
> - **25% Growth Trajectory**: Rising markets reward early entry
> - **20% Income Alignment**: Right customers with right spending power
> - **15% Demand Momentum**: Consumer interest trends
> - **10% Quality Gaps**: Weak competitor ratings create openings

---

### 3.5 Business Density Trends

```javascript
function calculateBusinessDensityTrends(cbpData, yearsOfData = 3) {
  // Sort by year
  const sortedData = cbpData.sort((a, b) => a.year - b.year);

  if (sortedData.length < 2) {
    return {
      trend_available: false,
      message: 'Insufficient historical data'
    };
  }

  const latestYear = sortedData[sortedData.length - 1];
  const previousYear = sortedData[sortedData.length - 2];
  const oldestYear = sortedData[0];

  // Year-over-year change
  const yoyChange = latestYear.establishment_count - previousYear.establishment_count;
  const yoyGrowthRate = previousYear.establishment_count > 0 ?
    ((yoyChange / previousYear.establishment_count) * 100) : 0;

  // Compound annual growth rate (if 3+ years)
  let cagr = null;
  if (sortedData.length >= 3) {
    const years = latestYear.year - oldestYear.year;
    cagr = (Math.pow(latestYear.establishment_count / oldestYear.establishment_count, 1 / years) - 1) * 100;
  }

  // Net new businesses
  const netNew = yoyChange;

  // Trend classification
  let trendLabel;
  if (yoyGrowthRate > 5) trendLabel = 'Rapidly Growing';
  else if (yoyGrowthRate > 2) trendLabel = 'Growing';
  else if (yoyGrowthRate > -2) trendLabel = 'Stable';
  else if (yoyGrowthRate > -5) trendLabel = 'Declining';
  else trendLabel = 'Rapidly Declining';

  return {
    trend_available: true,
    current_count: latestYear.establishment_count,
    previous_count: previousYear.establishment_count,
    net_change: netNew,
    yoy_growth_rate: Math.round(yoyGrowthRate * 10) / 10,
    cagr: cagr ? Math.round(cagr * 10) / 10 : null,
    trend_label: trendLabel,
    data_years: sortedData.map(d => d.year),
    interpretation: getTrendInterpretation(trendLabel, netNew, industry)
  };
}
```

---

## 4. Tiered Product Strategy

### 4.1 Tier Overview

| Feature | Starter | Growth | Scale |
|---------|---------|--------|-------|
| **Price Point** | Free / $29/mo | $79/mo | $199/mo |
| **Reports/Month** | 5 | 25 | Unlimited |
| **Target User** | Solo entrepreneurs | SMB owners, consultants | Agencies, franchises |
| **Data Freshness** | Weekly cache | Daily refresh | Real-time |

### 4.2 Starter Tier

**Goal:** Fast, affordable market overview for initial feasibility assessment.

#### Data Sources

| Source | Data Used | Update Frequency |
|--------|-----------|------------------|
| Google Places API | Competitor names, ratings, review counts | Cached 7 days |
| Census ACS 5-Year | Population, median income, households | Annual |
| Census CBP | Establishment counts (total only) | Annual |

#### Features Included

1. **Competitor Discovery**
   - Up to 20 competitors displayed
   - Name, address, rating, review count
   - Basic saturation level (Low/Medium/High)

2. **Basic Demographics**
   - Total population
   - Median household income
   - Total households
   - Homeownership rate

3. **Market Size Estimate**
   - Total addressable market (TAM)
   - Market per business estimate

4. **Competition Score**
   - Simple saturation badge
   - Competitor count
   - Average competitor rating

#### Excluded Features
- Detailed age distribution
- Education level breakdown
- Commute patterns
- Historical trends
- Interactive visualizations
- PDF export
- Custom radius selection

#### API Calls per Report

| API | Calls | Est. Cost |
|-----|-------|-----------|
| Google Places Nearby Search | 1 | $0.032 |
| Census ACS | 1 | Free |
| Census CBP | 1 | Free |
| **Total** | 3 | ~$0.03 |

#### Sample Output (Starter)

```json
{
  "report_tier": "starter",
  "location": {
    "city": "Austin",
    "state": "TX",
    "geo_id": "4805000"
  },
  "industry": {
    "display_name": "Full-Service Restaurants",
    "naics_code": "722511"
  },
  "market_overview": {
    "competitor_count": 847,
    "saturation_level": "high",
    "saturation_badge": "High Competition",
    "market_size_estimate": "$2.4B",
    "market_per_business": "$2.8M"
  },
  "demographics": {
    "population": 978908,
    "median_income": 75752,
    "households": 419837,
    "homeownership_rate": 45.2
  },
  "competitors": [
    {
      "name": "Uchi",
      "address": "801 S Lamar Blvd",
      "rating": 4.7,
      "reviews": 3842
    },
    // ... up to 20 competitors
  ],
  "upgrade_prompt": {
    "message": "Unlock age demographics, trends, and recommendations",
    "cta": "Upgrade to Growth"
  }
}
```

---

### 4.3 Growth Tier

**Goal:** Deeper insight and decision support with actionable recommendations.

#### Data Sources

| Source | Data Used | Update Frequency |
|--------|-----------|------------------|
| Google Places API | Full competitor data + details | Cached 24 hours |
| Census ACS 5-Year | Full demographic profile | Annual |
| Census CBP | Establishment counts + size distribution | Annual |
| BLS QCEW | Employment, wages (quarterly) | Quarterly |
| Google Trends (via Pytrends) | Search interest, seasonality | Weekly |

#### Features Included

**Everything in Starter, plus:**

##### Enhanced Demographics
```javascript
// Age Distribution Analysis
{
  "age_distribution": {
    "young_professionals_25_34": {
      "count": 178543,
      "percentage": 18.2,
      "index_vs_national": 112  // 12% above national average
    },
    "families_35_54": {
      "count": 245678,
      "percentage": 25.1,
      "index_vs_national": 98
    },
    "retirees_65_plus": {
      "count": 89234,
      "percentage": 9.1,
      "index_vs_national": 78
    }
  },
  "target_persona_fit": {
    "best_fit": "Young Professionals",
    "fit_score": 85,
    "rationale": "High concentration of 25-34 year olds with above-average income"
  }
}
```

##### Education Level Analysis
```javascript
{
  "education_profile": {
    "high_school": { "count": 89000, "pct": 15.2 },
    "some_college": { "count": 112000, "pct": 19.1 },
    "bachelors": { "count": 198000, "pct": 33.8 },
    "graduate": { "count": 87000, "pct": 14.9 }
  },
  "education_index": 128,  // vs national average
  "professional_services_fit": "Excellent",
  "insight": "48.7% with bachelor's or higher - strong market for professional services"
}
```

##### Commute & Accessibility Analysis
```javascript
{
  "commute_profile": {
    "drive_alone": { "count": 312000, "pct": 68.5 },
    "carpool": { "count": 41000, "pct": 9.0 },
    "public_transit": { "count": 18000, "pct": 4.0 },
    "walk": { "count": 14000, "pct": 3.1 },
    "work_from_home": { "count": 65000, "pct": 14.3 }
  },
  "avg_commute_minutes": 26.4,
  "walkability_score": 34,
  "location_strategy": {
    "recommendation": "Drive-to location with parking",
    "rationale": "68% drive alone, low walkability score",
    "ideal_visibility": "High-traffic corridors, strip centers"
  }
}
```

##### Business Density Trends
```javascript
{
  "establishment_trends": {
    "current_count": 847,
    "yoy_change": +23,
    "yoy_growth_rate": 2.8,
    "3yr_cagr": 3.2,
    "trend_label": "Growing",
    "historical": [
      { "year": 2019, "count": 756 },
      { "year": 2020, "count": 712 },  // COVID dip
      { "year": 2021, "count": 789 },
      { "year": 2022, "count": 824 },
      { "year": 2023, "count": 847 }
    ]
  },
  "insight": "Market recovered from 2020 dip and continues steady growth"
}
```

##### Interactive Visualizations

1. **Map View**
   - Competitor pins with color coding (rating-based)
   - Cluster view for dense areas
   - Heatmap option

2. **Market Saturation Chart**
   - Donut chart showing saturation components
   - Benchmark comparison bar

3. **Income Distribution Histogram**
   - Household income brackets
   - Industry sweet spot overlay

4. **Competitor Rating Distribution**
   - Histogram of ratings
   - Quality gap highlight

5. **Trend Line Charts**
   - Establishment count over time
   - Search interest over time

##### Actionable Recommendations

```javascript
{
  "recommendations": {
    "opportunity_score": 68,
    "opportunity_label": "Moderate Opportunity",

    "best_opportunity_rationale": "Above-average income and growing demand offset moderate competition. Young professional density creates loyal customer base potential.",

    "target_customer_profile": {
      "primary": "Young Professionals (25-34)",
      "secondary": "Dual-Income Families",
      "income_range": "$75K - $120K",
      "characteristics": [
        "Tech-savvy, uses online reviews",
        "Values quality over price",
        "Frequent diners, 3+ times/week"
      ]
    },

    "competitive_differentiators": [
      {
        "opportunity": "Service Quality Gap",
        "insight": "23% of competitors rated below 3.5 stars",
        "recommendation": "Focus on exceptional service to capture dissatisfied customers"
      },
      {
        "opportunity": "Hours Gap",
        "insight": "Only 34% of competitors open past 10pm",
        "recommendation": "Late-night hours could capture underserved demand"
      },
      {
        "opportunity": "Price Tier Gap",
        "insight": "Heavy concentration in $$ tier, few $ or $$$$ options",
        "recommendation": "Consider premium positioning or value play"
      }
    ],

    "risks": [
      "High saturation requires clear differentiation",
      "Rising commercial rents may pressure margins"
    ]
  }
}
```

#### API Calls per Report

| API | Calls | Est. Cost |
|-----|-------|-----------|
| Google Places Nearby Search | 1-3 | $0.03-0.10 |
| Google Places Details | 5-10 | $0.09-0.17 |
| Census ACS | 3-5 | Free |
| Census CBP | 2-3 | Free |
| BLS QCEW | 2-4 | Free |
| Google Trends (Pytrends) | 3-5 | Free |
| **Total** | 16-30 | ~$0.15-0.30 |

---

### 4.4 Scale Tier

**Goal:** Enterprise-grade insights with automation and advanced data sources.

#### Additional Data Sources

| Source | Data Used | Cost |
|--------|-----------|------|
| Yelp Fusion API | Additional reviews, business attributes | Free (5000/day) |
| OpenStreetMap / Overpass | POI density, walkability verification | Free |
| DOT Traffic Data | Traffic counts, commute corridors | Free |
| Google Trends (expanded) | Related queries, rising topics | Free |
| SerpAPI (optional) | More reliable Trends access | $50/mo |

#### Features Included

**Everything in Growth, plus:**

##### Multi-Source Competitor Data
```javascript
{
  "competitor_enrichment": {
    "google_places": { "count": 847, "with_rating": 823 },
    "yelp_fusion": { "count": 792, "with_price": 654 },
    "cross_reference_rate": 89.2,  // % matched between sources

    "enriched_competitors": [
      {
        "name": "Uchi",
        "google_rating": 4.7,
        "google_reviews": 3842,
        "yelp_rating": 4.5,
        "yelp_reviews": 2156,
        "combined_score": 4.6,
        "price_level": "$$$$",
        "categories": ["Japanese", "Sushi", "Fine Dining"],
        "highlights": ["Outdoor seating", "Reservations required"],
        "recent_reviews_sentiment": "positive"
      }
    ]
  }
}
```

##### Traffic & Accessibility Data
```javascript
{
  "traffic_analysis": {
    "nearby_road_aadt": [  // Annual Average Daily Traffic
      { "road": "S Lamar Blvd", "traffic_count": 32500, "distance_ft": 150 },
      { "road": "Barton Springs Rd", "traffic_count": 18200, "distance_ft": 800 }
    ],
    "drive_time_population": {
      "5_min": 45000,
      "10_min": 156000,
      "15_min": 312000
    },
    "peak_hours": {
      "weekday": ["11:30-13:00", "17:30-19:30"],
      "weekend": ["10:00-14:00", "18:00-21:00"]
    }
  }
}
```

##### Advanced Trend Analysis
```javascript
{
  "trend_analysis": {
    "primary_keyword": "japanese restaurant austin",
    "search_interest": {
      "current": 78,
      "yoy_change": +12,
      "5yr_trend": "growing"
    },
    "seasonality": {
      "peak_months": ["March", "October"],
      "trough_months": ["January", "August"],
      "amplitude": 1.35,  // Peak is 35% above trough
      "current_seasonal_index": 108  // 8% above average for this time
    },
    "related_rising_queries": [
      { "query": "omakase austin", "growth": "+250%" },
      { "query": "sushi happy hour austin", "growth": "+120%" },
      { "query": "japanese brunch austin", "growth": "+90%" }
    ],
    "insight": "Rising interest in omakase suggests opportunity for premium positioning"
  }
}
```

##### PDF Report Generation
```javascript
// Using html2pdf.js on client or Puppeteer on server
{
  "export_options": {
    "pdf": {
      "available": true,
      "includes": [
        "Executive Summary",
        "Market Overview",
        "Competitive Landscape",
        "Demographic Analysis",
        "Trend Analysis",
        "Recommendations",
        "Appendix: Data Sources"
      ],
      "branding": "custom_logo_supported"
    },
    "excel": {
      "available": true,
      "sheets": ["Summary", "Competitors", "Demographics", "Trends"]
    },
    "api_webhook": {
      "available": true,
      "formats": ["json", "csv"]
    }
  }
}
```

##### Pitch Auto-Population
```javascript
{
  "pitch_integration": {
    "available_fields": [
      "market_size",
      "competitor_count",
      "saturation_level",
      "growth_rate",
      "target_demographic",
      "key_differentiators",
      "opportunity_score"
    ],
    "template_variables": {
      "{{MARKET_SIZE}}": "$2.4B",
      "{{COMPETITOR_COUNT}}": "847",
      "{{GROWTH_RATE}}": "3.2%",
      "{{OPPORTUNITY_LABEL}}": "Moderate Opportunity",
      "{{TARGET_DEMO}}": "Young Professionals (25-34)"
    }
  }
}
```

##### Longitudinal Analysis
```javascript
{
  "historical_comparison": {
    "available_periods": ["2019", "2020", "2021", "2022", "2023"],
    "metrics_tracked": [
      "establishment_count",
      "avg_competitor_rating",
      "market_size_estimate",
      "saturation_score"
    ],
    "trend_summary": {
      "market_trajectory": "Growing",
      "competition_trajectory": "Intensifying",
      "quality_trajectory": "Improving"
    }
  }
}
```

#### API Calls per Report

| API | Calls | Est. Cost |
|-----|-------|-----------|
| Google Places | 5-15 | $0.15-0.50 |
| Yelp Fusion | 3-5 | Free |
| Census APIs | 5-8 | Free |
| BLS QCEW | 4-6 | Free |
| Google Trends | 5-10 | Free |
| OpenStreetMap | 2-3 | Free |
| **Total** | 24-47 | ~$0.20-0.50 |

---

## 5. Output & UX Alignment

### 5.1 Dashboard Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│  MARKET INTELLIGENCE                                    [Dashboard] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  GENERATE REPORT                                             │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌─────────────┐ │   │
│  │  │ City     │ │ State    │ │ Industry     │ │ Sub-Industry│ │   │
│  │  │ Austin   │ │ Texas ▼  │ │ Food & Bev ▼ │ │ Full Svc ▼  │ │   │
│  │  └──────────┘ └──────────┘ └──────────────┘ └─────────────┘ │   │
│  │                                        [Generate Report]     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  MARKET OVERVIEW                                Austin, TX   │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐│   │
│  │  │  $2.4B  │ │   847   │ │  68/100 │ │  3.2%   │ │   4.1   ││   │
│  │  │ Market  │ │Competi- │ │Opportun-│ │ Growth  │ │  Avg    ││   │
│  │  │  Size   │ │  tors   │ │  ity    │ │  Rate   │ │ Rating  ││   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘│   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────┐ ┌────────────────────────────────┐   │
│  │  SATURATION              │ │  OPPORTUNITY FACTORS           │   │
│  │  ┌─────────────────────┐ │ │  ┌────────────────────────┐   │   │
│  │  │     MEDIUM          │ │ │  │ ▓▓▓▓▓▓▓░░░ Low Compet. │   │   │
│  │  │     Competition     │ │ │  │ ▓▓▓▓▓▓▓▓░░ Growth      │   │   │
│  │  │     Score: 58       │ │ │  │ ▓▓▓▓▓▓░░░░ Income Fit  │   │   │
│  │  │  [=========>----]   │ │ │  │ ▓▓▓▓▓░░░░░ Demand      │   │   │
│  │  └─────────────────────┘ │ │  └────────────────────────┘   │   │
│  └──────────────────────────┘ └────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  [Map View] [Demographics] [Trends] [Competitors]           │   │
│  │  ┌─────────────────────────────────────────────────────────┐│   │
│  │  │                                                         ││   │
│  │  │              📍 Interactive Map                         ││   │
│  │  │           or Selected Tab Content                       ││   │
│  │  │                                                         ││   │
│  │  └─────────────────────────────────────────────────────────┘│   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  RECOMMENDATIONS                                             │   │
│  │  ┌─────────────────────────────────────────────────────────┐│   │
│  │  │ 🎯 Target: Young Professionals (25-34)                  ││   │
│  │  │ 💡 Differentiator: Late-night hours (only 34% compete)  ││   │
│  │  │ ⚠️ Risk: High saturation requires clear positioning     ││   │
│  │  └─────────────────────────────────────────────────────────┘│   │
│  │                               [Download PDF] [Add to Pitch]  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 Label Definitions & Logic

All customer-facing labels must have clear, defensible definitions.

#### Competition/Saturation Labels

| Label | Score Range | Logic |
|-------|-------------|-------|
| **Low Competition** | 0-34 | Competitors per 10K pop < industry benchmark "low" threshold AND avg rating < 4.0 OR total competitors < 10 |
| **Medium Competition** | 35-64 | Between low and high thresholds |
| **High Competition** | 65-100 | Competitors per 10K pop > industry benchmark "high" threshold OR (avg rating > 4.3 AND total reviews > 5000) |

#### Opportunity Labels

| Label | Score Range | Logic |
|-------|-------------|-------|
| **High Opportunity** | 70-100 | Low saturation + (growing market OR strong income fit OR rising demand) |
| **Moderate Opportunity** | 50-69 | Balanced factors, opportunity exists with differentiation |
| **Limited Opportunity** | 35-49 | One or more significant challenges (high saturation, declining demand, poor income fit) |
| **Challenging Market** | 0-34 | Multiple challenges, entry not recommended without significant advantages |

#### Growth Labels

| Label | Growth Rate | Logic |
|-------|-------------|-------|
| **Rapidly Growing** | > 5% | Establishment growth > 5% YoY AND demand trend rising |
| **Growing** | 2-5% | Positive establishment and/or demand trends |
| **Stable** | -2% to 2% | Minimal change in establishments and demand |
| **Declining** | -5% to -2% | Negative establishment trend OR declining demand |
| **Rapidly Declining** | < -5% | Significant establishment closures AND falling demand |

### 5.3 Visualization Specifications

#### Map View (Growth/Scale Tiers)

```javascript
const mapConfig = {
  center: [lat, lng],  // From geocoded city
  zoom: 12,

  competitorMarkers: {
    colorScale: {
      excellent: '#22c55e',  // Green: rating >= 4.5
      good: '#84cc16',       // Light green: 4.0-4.4
      average: '#eab308',    // Yellow: 3.0-3.9
      poor: '#ef4444'        // Red: < 3.0
    },
    sizeScale: {
      // Size by review count
      min: 8,   // < 50 reviews
      mid: 12,  // 50-200 reviews
      max: 18   // > 200 reviews
    }
  },

  heatmapLayer: {
    enabled: true,
    metric: 'competitor_density',
    colors: ['#22c55e', '#eab308', '#ef4444']  // Low to high density
  }
};
```

#### Chart Specifications

**Saturation Donut Chart:**
```javascript
{
  type: 'doughnut',
  data: {
    labels: ['Density', 'Quality', 'Activity'],
    values: [densityScore * 0.5, qualityScore * 0.3, activityScore * 0.2]
  },
  centerText: `${saturationScore}/100`
}
```

**Income Distribution Histogram:**
```javascript
{
  type: 'bar',
  data: {
    labels: ['<$25K', '$25-50K', '$50-75K', '$75-100K', '$100-150K', '$150K+'],
    values: [incomeData]
  },
  overlay: {
    type: 'range',
    label: 'Industry Sweet Spot',
    range: [sweetSpot.min, sweetSpot.max],
    color: 'rgba(74, 222, 128, 0.3)'
  }
}
```

### 5.4 PDF Report Structure

```
┌─────────────────────────────────────────────────────────┐
│                    MARKET INTELLIGENCE REPORT           │
│                    Austin, TX | Restaurants             │
│                    Generated: January 28, 2026          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  EXECUTIVE SUMMARY                                      │
│  ─────────────────                                      │
│  Opportunity Score: 68/100 (Moderate Opportunity)       │
│  Market Size: $2.4B | Competitors: 847 | Growth: 3.2%   │
│                                                         │
│  Key Finding: Strong young professional presence and    │
│  rising demand offset moderate competition. Late-night  │
│  dining represents an underserved segment.              │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  MARKET OVERVIEW                                   [1]  │
│  ─────────────────                                      │
│  [Market size methodology]                              │
│  [Competition breakdown]                                │
│  [Growth trajectory]                                    │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  COMPETITIVE LANDSCAPE                             [2]  │
│  ────────────────────                                   │
│  [Saturation analysis]                                  │
│  [Top 15 competitors table]                             │
│  [Rating distribution chart]                            │
│  [Quality gap analysis]                                 │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  DEMOGRAPHIC ANALYSIS                              [3]  │
│  ────────────────────                                   │
│  [Population & income]                                  │
│  [Age distribution chart]                               │
│  [Education levels]                                     │
│  [Commute patterns]                                     │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  DEMAND & TRENDS                                   [4]  │
│  ───────────────                                        │
│  [Search interest chart]                                │
│  [Seasonality analysis]                                 │
│  [Rising queries]                                       │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  RECOMMENDATIONS                                   [5]  │
│  ───────────────                                        │
│  [Target customer profile]                              │
│  [Differentiation opportunities]                        │
│  [Risks to consider]                                    │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  APPENDIX: DATA SOURCES & METHODOLOGY              [A]  │
│  ────────────────────────────────────                   │
│  • Google Places API (competitor data)                  │
│  • US Census ACS 5-Year 2022 (demographics)             │
│  • Census County Business Patterns 2022                 │
│  • BLS QCEW Q2 2025                                     │
│  • Google Trends (search demand)                        │
│                                                         │
│  [Methodology notes for each metric]                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 5.5 Sales-Ready Summary

For pitch integration, generate a concise summary block:

```javascript
{
  "pitch_summary": {
    "headline": "Austin, TX: Moderate Opportunity for Full-Service Restaurants",

    "key_stats": [
      { "label": "Market Size", "value": "$2.4B", "context": "Total addressable market" },
      { "label": "Competition", "value": "847 competitors", "context": "58/100 saturation score" },
      { "label": "Growth", "value": "+3.2% annually", "context": "Above national average" },
      { "label": "Target Demo", "value": "178K young professionals", "context": "25-34 age group" }
    ],

    "opportunity_statement": "Austin's restaurant market offers moderate opportunity driven by above-average income ($75K median) and strong young professional presence. While competition is substantial, 23% of competitors have ratings below 3.5 stars, creating a quality gap opportunity.",

    "differentiators": [
      "Late-night dining (only 34% compete)",
      "Premium positioning (few $$$$ options)",
      "Service quality focus (address rating gaps)"
    ],

    "call_to_action": "Position for the underserved late-night, quality-focused segment to capture share in this growing market."
  }
}
```

---

## 6. Implementation Roadmap

### Phase 1: Foundation (Starter Tier)
- Implement core data model (geography, industry, time dimensions)
- Integrate Google Places API (competitor search)
- Integrate Census ACS API (basic demographics)
- Build basic market size and saturation calculations
- Create simple report UI

### Phase 2: Enhancement (Growth Tier)
- Add CBP and QCEW integrations
- Implement detailed demographic breakdowns
- Add Google Trends integration
- Build interactive visualizations (maps, charts)
- Implement recommendation engine
- Add business density trend calculations

### Phase 3: Scale (Scale Tier)
- Add Yelp Fusion API integration
- Implement OpenStreetMap/traffic data
- Build PDF export system
- Create pitch auto-population system
- Add longitudinal analysis features
- Build multi-market comparison tools

---

## 7. Data Refresh Schedule

| Data Source | Refresh Frequency | Trigger |
|-------------|-------------------|---------|
| Google Places | On-demand (24hr cache) | Report generation |
| Census ACS | Annual (December) | Scheduled job |
| Census CBP | Annual (April) | Scheduled job |
| BLS QCEW | Quarterly (6mo lag) | Scheduled job |
| Google Trends | Weekly | Scheduled job |
| Yelp Fusion | On-demand (24hr cache) | Report generation |
| Derived Metrics | Daily | Nightly batch job |

---

## Appendix A: NAICS Code Reference

### Supported Industries (Initial Release)

| Sector | NAICS | Industry | Sub-categories |
|--------|-------|----------|----------------|
| 72 | 722511 | Full-Service Restaurants | Fine Dining, Casual, Family |
| 72 | 722513 | Limited-Service Restaurants | Fast Food, Fast Casual, QSR |
| 72 | 722515 | Snack and Beverage Bars | Coffee Shops, Juice Bars |
| 81 | 811111 | General Automotive Repair | - |
| 81 | 811121 | Automotive Body Repair | - |
| 71 | 713940 | Fitness Centers | Gyms, CrossFit, Yoga Studios |
| 81 | 812111 | Barber Shops | - |
| 81 | 812112 | Beauty Salons | Hair Salons |
| 81 | 812113 | Nail Salons | - |
| 54 | 541110 | Offices of Lawyers | - |
| 54 | 541211 | Offices of CPAs | - |
| 53 | 531210 | Real Estate Agents | - |
| 62 | 621111 | Offices of Physicians | - |
| 62 | 621210 | Offices of Dentists | - |
| 56 | 561730 | Landscaping Services | - |
| 23 | 238220 | Plumbing & HVAC | - |
| 23 | 238210 | Electrical Contractors | - |

---

## Appendix B: Census Variable Reference

### ACS 5-Year Key Variables

| Variable | Description | Table |
|----------|-------------|-------|
| B01003_001E | Total Population | B01003 |
| B01002_001E | Median Age | B01002 |
| B19013_001E | Median Household Income | B19013 |
| B19001_002E-017E | Income Distribution | B19001 |
| B15003_017E-025E | Educational Attainment | B15003 |
| B08301_001E-021E | Commute Mode | B08301 |
| B08303_001E-013E | Commute Time | B08303 |
| B25003_001E-003E | Housing Tenure | B25003 |
| B23025_001E-007E | Employment Status | B23025 |

---

*Document Version: 1.0*
*Last Updated: January 28, 2026*
*Author: PathSynch Data Architecture Team*
