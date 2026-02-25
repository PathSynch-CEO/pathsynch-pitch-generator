/**
 * Data Analyst Style - L3 Slide Deck
 *
 * Dense, information-rich. Charts, tables, metrics grids.
 * PLACEHOLDER - Full implementation coming soon.
 *
 * @module pitch/level3Styles/dataAnalyst
 */

function generate(inputs, reviewData, roiData, options = {}, marketData = null, pitchId = '') {
    const businessName = inputs.businessName || 'Your Business';
    const companyName = options.sellerContext?.companyName || options.companyName || 'PathSynch';

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${businessName} - Data Analyst Deck | ${companyName}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background: #1e3a5f;
            margin: 0;
            color: white;
        }
        .placeholder {
            text-align: center;
            padding: 48px;
            background: #2c5282;
            border-radius: 8px;
            max-width: 500px;
        }
        h1 { margin-bottom: 16px; }
        p { opacity: 0.9; font-size: 16px; }
        .badge {
            display: inline-block;
            background: #38b2ac;
            color: white;
            padding: 8px 16px;
            border-radius: 4px;
            font-size: 14px;
            margin-top: 24px;
        }
    </style>
</head>
<body>
    <div class="placeholder">
        <h1>Data Analyst Deck</h1>
        <p>This style variant is coming soon.</p>
        <p>Chart-heavy, metrics-focused presentation for <strong>${businessName}</strong> will appear here.</p>
        <span class="badge">Style: data_analyst</span>
    </div>
</body>
</html>`;
}

module.exports = { generate };
