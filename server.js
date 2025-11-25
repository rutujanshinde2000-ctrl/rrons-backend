// server.js
// Run with Node (in Docker we use Playwright image)
// Packages: express, axios, cheerio, robots-parser, playwright

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const RobotsParser = require('robots-parser');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

// Helper: normalize URL
function normalizeUrl(u) {
  try {
    return new URL(u).toString();
  } catch (e) {
    // try adding https
    try {
      return new URL('https://' + u).toString();
    } catch (e2) {
      return null;
    }
  }
}

// Fetch robots.txt and check permission for User-agent: *
async function isAllowedByRobots(targetUrl) {
  try {
    const urlObj = new URL(targetUrl);
    const robotsUrl = `${urlObj.origin}/robots.txt`;
    const rres = await axios.get(robotsUrl, { timeout: 5000 }).catch(() => null);
    if (!rres || !rres.data) {
      // no robots.txt => assume allowed
      return { allowed: true, reason: 'no-robots' };
    }
    const robotsTxt = rres.data;
    const robots = RobotsParser(robotsUrl, robotsTxt);
    const allowed = robots.isAllowed(targetUrl, '*');
    return { allowed, reason: allowed ? 'robots-allowed' : 'disallowed-by-robots' };
  } catch (err) {
    return { allowed: true, reason: 'robots-check-failed' }; // fallback allow
  }
}

// Detect simple Cloudflare/bot-block responses by headers/body
function detectBlocking(body, headers) {
  const headerServer = (headers && (headers.server || headers['cf-ray'] || headers['cf-chl-bypass'])) || '';
  const bodyStr = (body || '').toString().toLowerCase();

  if (/cloudflare/.test(headerServer) || /cloudflare/i.test(bodyStr) ||
      /attention required|verify you are human|challenge-form|cf-chl-bypass/i.test(bodyStr)) {
    return 'cloudflare';
  }
  if (/captcha/i.test(bodyStr)) return 'captcha';
  if (/access denied/i.test(bodyStr)) return 'access-denied';
  return null;
}

// Try lightweight fetch with axios
async function fetchWithAxios(url) {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'RRONS-Scraper/1.0 (+https://rrons.in)'
      },
      // allow large bodies
      maxBodyLength: 5 * 1024 * 1024
    });
    return { ok: true, status: res.status, headers: res.headers, data: res.data };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

// Use Playwright to render JavaScript pages (only when allowed and requested)
async function fetchWithPlaywright(url) {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ userAgent: 'RRONS-Scraper-Playwright/1.0' });
  try {
    await page.goto(url, { timeout: 30000, waitUntil: 'networkidle' });
    const html = await page.content();
    await browser.close();
    return { ok: true, data: html };
  } catch (err) {
    await browser.close();
    return { ok: false, error: err.message || String(err) };
  }
}

// Extract content with cheerio
function extractFromHtml(html, targetUrl) {
  const $ = cheerio.load(html);
  const title = $('title').text().trim();
  const headings = [];
  $('h1,h2,h3,h4').each((i, el) => { headings.push($(el).text().trim()); });

  // gather links, making them absolute
  const links = [];
  $('a[href]').each((i, el) => {
    let href = $(el).attr('href');
    try {
      href = new URL(href, targetUrl).toString();
    } catch (e) { /* ignore */ }
    links.push(href);
  });

  // main text: collect paragraphs
  const paragraphs = [];
  $('p').each((i, el) => {
    const t = $(el).text().trim();
    if (t) paragraphs.push(t);
  });

  const text = paragraphs.join('\n\n');
  return { title, headings, links, text };
}

// Main endpoint
app.post('/scrape', async (req, res) => {
  const { url, usePlaywright } = req.body || {};
  if (!url) return res.status(400).json({ success: false, error: 'url is required' });

  const normalized = normalizeUrl(url);
  if (!normalized) return res.status(400).json({ success: false, error: 'invalid url' });

  // 1) Robots check
  const robots = await isAllowedByRobots(normalized);
  if (!robots.allowed) {
    return res.status(403).json({
      success: false,
      reason: 'blocked_by_robots',
      message: 'This site disallows scraping via robots.txt'
    });
  }

  // 2) Try lightweight fetch
  const ax = await fetchWithAxios(normalized);
  if (!ax.ok) {
    // network error — we may show a clear message
    return res.status(502).json({ success: false, reason: 'fetch_failed', message: ax.error || 'fetch failed' });
  }

  // 3) Detect blocking
  const block = detectBlocking(ax.data, ax.headers);
  if (block) {
    return res.status(403).json({
      success: false,
      reason: 'blocked_by_bot_protection',
      message: `This site appears to be protected (${block}). Scraping blocked.`,
    });
  }

  // 4) Parse with cheerio
  const parsed = extractFromHtml(ax.data, normalized);

  // If text is very small AND user allows JS rendering, try Playwright
  const textLength = (parsed.text || '').trim().length;
  if (textLength < 100 && (usePlaywright === true || usePlaywright === 'auto')) {
    // Double-check robots.txt allowed for user-agent (we already checked), proceed
    const pw = await fetchWithPlaywright(normalized);
    if (!pw.ok) {
      return res.status(502).json({ success: false, reason: 'playwright_failed', message: pw.error });
    }
    const parsed2 = extractFromHtml(pw.data, normalized);
    // detect if still blocked
    const block2 = detectBlocking(pw.data, {});
    if (block2) {
      return res.status(403).json({
        success: false,
        reason: 'blocked_after_playwright',
        message: `Site blocks automated browsers (${block2}).`
      });
    }
    // respond with richer parse
    return res.json({ success: true, engine: 'playwright', data: parsed2 });
  }

  // otherwise return the axios parse
  return res.json({ success: true, engine: 'axios', data: parsed });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('Scraper API running on port', PORT));
