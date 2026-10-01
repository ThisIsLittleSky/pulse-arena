'use strict';
/**
 * Headless pixel probe for Intel-style canvas blue-screen.
 * Samples the game canvas after auto-join.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME ||
  (fs.existsSync('C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe')
    ? 'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe'
    : 'C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe');

const BASE = process.env.PULSE_URL || 'http://127.0.0.1:4001';
const OUT = path.join(__dirname, '_probe-shot.png');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--no-sandbox',
      '--window-size=1280,720',
      '--use-gl=angle',
      '--use-angle=d3d11'
    ]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.goto(BASE + '/', { waitUntil: 'networkidle0', timeout: 20000 });

  await page.evaluate(() => {
    const inp = document.getElementById('nameInput');
    inp.value = 'ProbeBot';
    document.getElementById('startBtn').click();
  });

  await page.waitForFunction(() => window.myId != null || document.getElementById('joinScreen').classList.contains('hidden'), { timeout: 10000 });
  // myId is let not on window - wait for join screen hidden
  await page.waitForFunction(() => document.getElementById('joinScreen').classList.contains('hidden'), { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 1500));

  const sample = await page.evaluate(() => {
    const c = document.getElementById('game');
    const ctx = c.getContext('2d');
    // sample several points in CSS pixel space via temporary read
    // read backing store center
    const x = Math.floor(c.width / 2);
    const y = Math.floor(c.height / 2);
    const pts = [
      [x, y],
      [40, 40],
      [x, 80],
      [80, c.height - 80],
      [c.width - 80, 80]
    ];
    const out = [];
    for (const [px, py] of pts) {
      const d = ctx.getImageData(px, py, 1, 1).data;
      out.push({ x: px, y: py, r: d[0], g: d[1], b: d[2], a: d[2] === undefined ? d[3] : d[3] });
    }
    // detect near #2eccff
    const cyan = out.filter((p) => Math.abs(p.r - 46) < 12 && Math.abs(p.g - 204) < 12 && Math.abs(p.b - 255) < 12);
    const dark = out.filter((p) => p.r < 40 && p.g < 40 && p.b < 55);
    return {
      size: [c.width, c.height],
      samples: out,
      cyanCount: cyan.length,
      darkCount: dark.length,
      joinHidden: document.getElementById('joinScreen').classList.contains('hidden')
    };
  });

  await page.screenshot({ path: OUT, fullPage: false });
  await browser.close();

  const fail = sample.cyanCount >= 3 && sample.darkCount === 0;
  console.log(JSON.stringify({ fail, shot: OUT, ...sample }, null, 2));
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
