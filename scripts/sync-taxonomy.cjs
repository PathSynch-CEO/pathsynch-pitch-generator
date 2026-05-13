const fs = require('fs');
const path = require('path');

const source = path.resolve(__dirname, '../functions/config/industryTaxonomy.json');
const targetDir = path.resolve(__dirname, '../../synchintro-app/config');
const target = path.join(targetDir, 'industryTaxonomy.json');

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
  console.log('Created directory:', targetDir);
}

fs.copyFileSync(source, target);

const src = fs.readFileSync(source, 'utf8');
const dst = fs.readFileSync(target, 'utf8');
if (src === dst) {
  console.log('✓ Synced industryTaxonomy.json to frontend. Files are identical.');
} else {
  console.error('✗ SYNC FAILED');
  process.exit(1);
}
