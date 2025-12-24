const express = require("express");
const cors = require("cors");
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
   AUTH ROUTE (GOOGLE)
========================= */
app.post("/auth/google", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Google token missing"
      });
    }

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
  } catch (err) {
    res.status(401).json({
      success: false,
      message: "Invalid Google token"
    });
  }
});

/* =========================
   AUTH MIDDLEWARE (OPTIONAL)
========================= */
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) {
    return res.status(401).json({ success: false, message: "No token" });
  }

  try {
    const token = auth.split(" ")[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ success: false, message: "Invalid token" });
  }
}

/* =========================
   HELPER FUNCTIONS
========================= */

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

function blocked(body) {
  const text = (body || "").toLowerCase();
  return /cloudflare|captcha|verify you are human|access denied/.test(text);
}

async function scrapeAxios(url) {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: { "User-Agent": "RRONS-SCRAPER/1.0" }
    });
    if (blocked(res.data)) return { ok: false };
    return { ok: true, html: res.data };
  } catch {
    return { ok: false };
  }
}

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
    return { ok: false };
  }
}

function extract(html, url) {
  const $ = cheerio.load(html);
  return {
    title: $("title").text().trim(),
    headings: $("h1,h2,h3").map((_, el) => $(el).text().trim()).get(),
    links: $("a[href]").map((_, el) => {
      try {
        return new URL($(el).attr("href"), url).toString();
      } catch {
        return null;
      }
    }).get(),
    text: $("p").map((_, el) => $(el).text().trim()).get().join("\n\n")
  };
}

/* =========================
   SCRAPE ROUTE
========================= */
app.post("/scrape", async (req, res) => {
  const { url } = req.body;
  const finalUrl = normalizeUrl(url);

  if (!finalUrl) {
    return res.json({ success: false, message: "Invalid URL" });
  }

  const robots = await checkRobots(finalUrl);
  if (!robots.allowed) {
    return res.json({
      success: false,
      message: "Blocked by robots.txt"
    });
  }

  let result = await scrapeAxios(finalUrl);
  if (!result.ok) {
    result = await scrapePlaywright(finalUrl);
  }

  if (!result.ok) {
    return res.json({
      success: false,
      message: "Scraping failed"
    });
  }

  const data = extract(result.html, finalUrl);
  res.json({ success: true, data });
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log("RRONS backend running on port", PORT)
);
