/**
 * Competitive Battlecard Style - L2 One-Pager
 *
 * Side-by-side comparison grid layout.
 * PLACEHOLDER - Full implementation coming soon.
 *
 * @module pitch/level2Styles/battlecard
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
    <title>${businessName} - Battlecard | ${companyName}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background: #f8fafc;
            margin: 0;
        }
        .placeholder {
            text-align: center;
            padding: 48px;
            background: white;
            border-radius: 16px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            max-width: 500px;
        }
        h1 { color: #1e3a5f; margin-bottom: 16px; }
        p { color: #64748b; font-size: 16px; }
        .badge {
            display: inline-block;
            background: #1e3a5f;
            color: white;
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 14px;
            margin-top: 24px;
        }
    </style>
</head>
<body>
    <div class="placeholder">
        <h1>Competitive Battlecard</h1>
        <p>This style variant is coming soon.</p>
        <p><strong>${businessName}</strong> vs. Current State comparison grid will appear here.</p>
        <span class="badge">Style: battlecard</span>
    </div>
</body>
</html>`;
}

module.exports = { generate };
