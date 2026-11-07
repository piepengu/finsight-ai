const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const firebaseJson = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
const firebaserc = JSON.parse(fs.readFileSync(path.join(root, '.firebaserc'), 'utf8'));

let failed = false;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
}

try {
  // eslint-disable-next-line no-new-func
  new Function(js);
  check('app.js syntax', true);
} catch (e) {
  check('app.js syntax', false, e.message);
}

const ids = ['dashboard', 'markets', 'portfolio', 'trade', 'research', 'watchlist'];
check(
  'hash sections present',
  ids.every((id) => html.includes(`id="${id}"`)),
  ids.join(', ')
);
check('formatMoney utility', js.includes('usdCurrencyFormatter') && js.includes('function formatMoney'));
check('hash navigation', js.includes('function initHashNavigation'));
check('research analyze', js.includes('function analyzeResearch'));
check('chart ranges', js.includes('setPortfolioChartRange'));
check('CSS design tokens', css.includes('--accent: #0f766e') && css.includes('.app-nav'));
check('Firebase project default', firebaserc.projects.default === 'finsight-ai-jd');
check('Hosting public dir', firebaseJson.hosting.public === 'public');
check('Hosting site', firebaseJson.hosting.site === 'finsight-ai-jd');
check('Client projectId', html.includes('projectId: "finsight-ai-jd"'));
check('No secrets in public HTML beyond Firebase web config', !/GEMINI|ALPHA_VANTAGE|private_key/i.test(html + js));

console.log(failed ? '\nPre-deploy checks FAILED' : '\nPre-deploy checks PASSED');
process.exit(failed ? 1 : 0);
