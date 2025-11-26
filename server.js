const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const RobotsParser = require("robots-parser");
const { chromium } = require("playwright");

const app = express();
app.use(express.json());

// Normalize URL
function normalizeUrl(u) {
  try {
    return new URL(u).toString();
  } catch {
    try {
      return new URL("https://" + u).toString();
    } catch {
      return null;
    }
  }
}

// Check robots.txt legality
async function checkRobots(url) {
  try {
    const origin = new URL(url).origin;
    const robotsUrl = origin + "/robots.txt";
    const res = await axios.get(robotsUrl).catch(() => null);

    if (!res) return { allowed: true };

    const robots = RobotsParser(robotsUrl, res.data);
    const allowed = robots.isAllowed(url, "*");

    return { allowed };
  } catch {
    return { allowed: true };
  }
}

// Detect blocked / protected sites
function blocked(body, headers) {
  const text = (body || "").toString().toLowerCase();

  if (
    /cloudflare|captcha|access denied|verify you are human|challenge-form/.test(
      text
    )
  ) {
    return true;
  }
  return false;
}

// Try normal axios scraping
async function scrapeAxios(url) {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: { "User-Agent": "RRONS-SCRAPER/1.0" },
    });

    if (blocked(res.data, res.headers)) {
      return { ok: false, reason: "blocked" };
    }

    return { ok: true, html: res.data };
  } catch (e) {
    return { ok: false, reason: "fetch_failed" };
  }
}

// Try dynamic JS scraping using Playwright
async function scrapePlaywright(url) {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    const content = await page.content();
    await browser.close();
    return { ok: true, html: content };
  } catch (e) {
    await browser.close();
    return { ok: false, reason: "playwright_failed" };
  }
}

// Extract content with Cheerio
function extract(html, url) {
  const $ = cheerio.load(html);

  const title = $("title").text().trim();
  const headings = [];
  $("h1,h2,h3").each((i, el) => headings.push($(el).text().trim()));

  const links = [];
  $("a[href]").each((i, el) => {
    try {
      links.push(new URL($(el).attr("href"), url).toString());
    } catch {}
  });

  const paragraphs = [];
  $("p").each((i, el) => {
    const t = $(el).text().trim();
    if (t) paragraphs.push(t);
  });

  return {
    title,
    headings,
    links,
    text: paragraphs.join("\n\n"),
  };
}

// Main scraping endpoint
app.post("/scrape", async (req, res) => {
  const { url } = req.body;

  const finalUrl = normalizeUrl(url);
  if (!finalUrl) return res.json({ success: false, message: "Invalid URL" });

  // 1. robots.txt check (legal)
  const robots = await checkRobots(finalUrl);
  if (!robots.allowed) {
    return res.json({
      success: false,
      reason: "robots_block",
      message: "This website does not legally allow scraping.",
    });
  }

  // 2. Try axios
  let result = await scrapeAxios(finalUrl);

  // 3. If blocked or small HTML, try Playwright
  if (!result.ok || (result.ok && result.html.length < 500)) {
    result = await scrapePlaywright(finalUrl);
  }

  if (!result.ok) {
    return res.json({
      success: false,
      reason: result.reason,
      message: "Website cannot be scraped due to protection.",
    });
  }

  // 4. Extract data
  const data = extract(result.html, finalUrl);

  res.json({
    success: true,
    engine: "scraper",
    data,
  });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Scraper running on port", PORT));

    

  
