/**
 * End-to-end verification of the real app in a real browser.
 *
 * Serves the project over local HTTP, opens it in Chromium via
 * Playwright, loads the Lena sample, runs the actual Anonymize button,
 * and checks the detection + blur pipeline end to end:
 *
 *   - OpenCV.js initialises from the CDN and the cascade loads
 *   - at least one face is detected on lena.jpg
 *   - pixels inside the (padded) face rect changed a lot (blur happened)
 *   - pixels outside the face rects are unchanged (blur stayed local)
 *
 * Artefacts written to examples/ (all produced by this run, not mocked):
 *   - lena-blurred.png        blurred result canvas, downloaded from the app
 *   - app-screenshot.png      the app UI after anonymising, boxes visible
 *   - verification-report.json the numbers from this run
 *
 * Run:  node tests/verify.mjs
 * Env:  CHROMIUM_PATH — optional path to a Chromium binary; when unset,
 *       Playwright uses its own downloaded Chromium (headless shell).
 *       Note: the sandbox's /opt/meta-chromium/chrome cannot be used here —
 *       it refuses to start outside the managed Hatch browser
 *       ("Hatch WebGL domain policy is required for browser startup").
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = path.join(ROOT, 'examples');
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || undefined;
const PORT = 8931;

function serve() {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  return server;
}

async function waitFor(predicate, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout waiting for: ${label}`);
}

const server = serve();
try {
  await mkdir(EXAMPLES, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await waitFor(
    () => page.evaluate(() => window.__faceBlur?.ready === true),
    120000,
    'OpenCV.js ready (window.__faceBlur.ready)',
  );

  // Load the bundled sample and run the real UI button.
  await page.click('#sampleBtn');
  await waitFor(
    () => page.evaluate(() => !document.getElementById('anonymizeBtn').disabled),
    30000,
    'sample image loaded',
  );
  await page.click('#anonymizeBtn');
  await waitFor(
    () => page.evaluate(() => window.__faceBlur?.metrics !== null),
    60000,
    'anonymize finished (window.__faceBlur.metrics)',
  );

  const report = await page.evaluate(() => window.__faceBlur.metrics);
  const faces = report.facesDetected;
  const inside = report.meanAbsDiffInsideAvg;
  const outside = report.meanAbsDiffOutside;

  // Download the blurred canvas as a real PNG via the app's canvas.
  const pngBase64 = await page.evaluate(() => {
    const c = document.getElementById('resultCanvas');
    return c.toDataURL('image/png').split(',')[1];
  });
  await writeFile(path.join(EXAMPLES, 'lena-blurred.png'), Buffer.from(pngBase64, 'base64'));
  await page.screenshot({ path: path.join(EXAMPLES, 'app-screenshot.png'), fullPage: true });

  const fullReport = {
    verifiedAt: new Date().toISOString(),
    method: 'Playwright + Chromium (real browser), OpenCV.js 4.9.0 vendored in vendor/, cascade from local assets/',
    url: `http://127.0.0.1:${PORT}/index.html`,
    sampleImage: 'assets/lena.jpg (512x512, from opencv/opencv samples/data/lena.jpg)',
    consoleErrors,
    ...report,
    checks: {
      opencvReady: true,
      faceDetected: faces >= 1,
      // Blur must visibly change the face region (mean abs diff >> 1).
      facePixelsChanged: inside > 5,
      // Blur must not touch anything outside the padded face rects.
      outsidePixelsUnchanged: outside === 0,
    },
  };
  await writeFile(
    path.join(EXAMPLES, 'verification-report.json'),
    JSON.stringify(fullReport, null, 2) + '\n',
  );

  const failed = Object.entries(fullReport.checks).filter(([, v]) => v !== true);
  console.log(JSON.stringify(fullReport, null, 2));
  await browser.close();
  if (failed.length > 0) {
    console.error(`FAILED CHECKS: ${failed.map(([k]) => k).join(', ')}`);
    process.exit(1);
  }
  console.log('All verification checks passed.');
} finally {
  server.kill();
}
