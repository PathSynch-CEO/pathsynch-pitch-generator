/**
 * ROI Snapshot Style - L2 One-Pager
 *
 * Numbers-forward layout with large metric cards and financial breakdown.
 * PLACEHOLDER - Full implementation coming soon.
 *
 * @module pitch/level2Styles/roiSnapshot
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
    <title>${businessName} - ROI Snapshot | ${companyName}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background: #f0fdf4;
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
        h1 { color: #059669; margin-bottom: 16px; }
        p { color: #64748b; font-size: 16px; }
        .badge {
            display: inline-block;
            background: #059669;
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
        <h1>ROI Snapshot</h1>
        <p>This style variant is coming soon.</p>
        <p>Data-heavy metrics and financial projections for <strong>${businessName}</strong> will appear here.</p>
        <span class="badge">Style: roi_snapshot</span>
    </div>
</body>
</html>`;
}

module.exports = { generate };
