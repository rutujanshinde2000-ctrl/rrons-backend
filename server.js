const cors = require("cors");
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const RobotsParser = require("robots-parser");
const { chromium } = require("playwright");
const jwt = require("jsonwebtoken");

const { verifyGoogleToken, createJWT } = require("./auth");

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "rrons_secret_key";

/* =========================
   HELPER FUNCTIONS
========================= */

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

// robots.txt check
async function checkRobots(url) {
  try {
    const origin = new URL(url).origin;
    const robotsUrl = origin + "/robots.txt";
    const res = await axios.get(robotsUrl).catch(() => null);
    if (!res) return { allowed: true };

    const robots = RobotsParser(robotsUrl, res.data);
    return { allowed: robots.isAllowed(url, "*") };
  } catch {
    return { allowed: true };
  }
}

// detect bot protection
function blocked(body) {
  const text = (body || "").toLowerCase();
  return /cloudflare|captcha|verify you are human|access denied/.test(text);
}

// axios scrape
async function scrapeAxios(url) {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: { "User-Agent": "RRONS-SCRAPER/1.0" }
    });
    if (blocked(res.data)) return { ok: false, reason: "blocked" };
    return { ok: true, html: res.data };
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }
}

// playwright scrape
async function scrapePlaywright(url) {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    const content = await page.content();
    await browser.close();
    return { ok: true, html: content };
  } catch {
    await browser.close();
    return { ok: false, reason: "playwright_failed" };
  }
}

// extract content
function extract(html, url, fields = [], selector = null) {
  const $ = cheerio.load(html);
  const scope = selector ? $(selector) : $.root();

  const data = {};

  if (fields.includes("title")) {
    data.title = $("title").text().trim();
  }

  if (fields.includes("headings")) {
    data.headings = [];
    scope.find("h1,h2,h3").each((_, el) => {
      const t = $(el).text().trim();
      if (t) data.headings.push(t);
    });
  }

  if (fields.includes("links")) {
    data.links = [];
    scope.find("a[href]").each((_, el) => {
      try {
        data.links.push(new URL($(el).attr("href"), url).toString());
      } catch {}
    });
  }

  if (fields.includes("text")) {
    const paragraphs = [];
    scope.find("p").each((_, el) => {
      const t = $(el).text().trim();
      if (t) paragraphs.push(t);
    });
    data.text = paragraphs.join("\n\n");
  }

  return data;
}

/* =========================
   AUTH ROUTE
========================= */

app.post("/auth/google", async (req, res) => {
  const { token } = req.body;

  try {
    const payload = await verifyGoogleToken(token);

    const user = {
      email: payload.email,
      name: payload.name,
      picture: payload.picture
    };

    const jwtToken = createJWT(user);

    res.json({
      success: true,
      token: jwtToken,
      user
    });
  } catch {
    res.status(401).json({
      success: false,
      message: "Google authentication failed"
    });
  }
});

/* =========================
   OPTIONAL AUTH MIDDLEWARE
========================= */

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ success: false });

  try {
    const token = auth.split(" ")[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ success: false });
  }
}

/* ================*
