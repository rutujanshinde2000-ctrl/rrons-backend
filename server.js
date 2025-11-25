const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

app.post("/scrape", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    let data = {
      title: $("title").text(),
      headings: [],
      links: [],
    };

    $("h1, h2, h3").each(function () {
      data.headings.push($(this).text());
    });

    $("a").each(function () {
      const href = $(this).attr("href");
      if (href) data.links.push(href);
    });

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Scraping failed",
      details: error.message,
    });
  }
});

app.listen(5000, () => console.log("Server running on port 5000"));
