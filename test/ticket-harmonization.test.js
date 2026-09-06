const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const css = read('assets/css/pages/ticket-harmonization.css');
const runtime = read('js/ticket-harmonization.js');

const TARGETS = [
  'ce.html',
  'complaints.html',
  'free-orders.html',
  'free-order-requests.html',
  'free-order-share.html'
];

test('the harmonization layer is loaded by all five authorized ticket modules', () => {
  TARGETS.forEach((file) => {
    const html = read(file);
    assert.match(html, /assets\/css\/pages\/ticket-harmonization\.css/, `${file} CSS`);
    assert.match(html, /js\/ticket-harmonization\.js/, `${file} presentation runtime`);
  });
  assert.equal((runtime.match(/bodyClass:/g) || []).length, 5);
});

test('the visual grammar encodes the compact CCTV-led hierarchy', () => {
  assert.match(css, /padding:\s*18px 0 15px/);
  assert.match(css, /font-size:\s*clamp\(27px, 2\.15vw, 34px\)/);
  assert.match(css, /min-height:\s*58px/);
  assert.match(css, /height:\s*44px/);
  assert.match(css, /border-radius:\s*7px/);
  assert.match(css, /\.ticket-status-accent[\s\S]*?height:\s*2px/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*?\.ticket-stage-switcher/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /url\(|animation\s*:/);
});

test('the presentation runtime is data-neutral and preserves dynamic target stages', () => {
  assert.match(runtime, /directColumns\(\)/);
  assert.match(runtime, /--switcher-count/);
  assert.match(runtime, /ArrowLeft/);
  assert.match(runtime, /ArrowRight/);
  assert.match(runtime, /MutationObserver/);
  assert.doesNotMatch(runtime, /fetch\(|localStorage|sessionStorage|\.netlify|API_ENDPOINT/);
});

test('the final parity remediation keeps mobile density readable without changing behavior', () => {
  const customerExperience = read('ce.html');
  assert.match(css, /font-size:\s*clamp\(21px, 5\.6vw, 23px\)/);
  assert.match(css, /flex:\s*0 0 112px/);
  assert.match(css, /font-size:\s*9\.5px/);
  assert.match(css, /grid-template-rows:\s*minmax\(20px, auto\) 18px/);
  assert.match(css, /\.ticket-stage-tab span[\s\S]*?white-space:\s*nowrap/);
  assert.match(css, /\.ticket-metadata-rows > :is\(span, \.field-line\)[\s\S]*?padding-block:\s*5px/);
  assert.match(css, /\.free-orders-ticket-discount\.ticket-snapshot[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  assert.match(css, /\.ticket-record-title[\s\S]*?color:\s*var\(--th-text\) !important/);
  ['clipboard-list', 'history', 'phone-call', 'badge-check'].forEach((icon) => {
    assert.match(customerExperience, new RegExp(`ce-stat-icon" data-cc-icon="${icon}"`));
  });
});
