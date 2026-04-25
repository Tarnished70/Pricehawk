const cheerio = require('cheerio');

async function scrapeUrl(url, platform) {
  const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY;

  let fetchUrl;
  if (SCRAPER_API_KEY) {
    if (platform === 'amazon') {
      // Amazon: autoparse=true returns clean JSON instantly
      fetchUrl = `https://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}&autoparse=true`;
    } else {
      // Flipkart: needs render=true since prices load via JavaScript
      // We have 60s on Vercel so this is fine
      fetchUrl = `https://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}&country_code=in&render=true&device_type=desktop`;
    }
  } else {
    fetchUrl = url;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000); // 55s timeout (under Vercel's 60s)

  try {
    const res = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-IN,en;q=0.9',
      },
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (!html || html.length < 200) throw new Error('Empty page returned');

    const $ = cheerio.load(html);
    const result = platform === 'amazon' ? parseAmazon($, html) : parseFlipkart($, html);

    if (!result.name || result.name.length < 4) {
      result.name = nameFromUrl(url, platform);
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

function toNum(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace(/[₹,\s\u20B9$]/g, '').trim().split('.')[0]);
  return isNaN(n) || n <= 0 ? null : n;
}

function nameFromUrl(url, platform) {
  try {
    const path = new URL(url).pathname;
    const parts = path.split('/').filter(Boolean);
    let slug = platform === 'amazon'
      ? (() => { const i = parts.findIndex(p => p === 'dp'); return i > 0 ? parts[i-1] : parts[0]; })()
      : parts.find(p => p.length > 15 && !p.startsWith('p')) || parts[0] || '';

    slug = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
      .replace(/\b(\d+)\s*Gb\b/gi, '$1GB').replace(/\b(\d+)\s*Tb\b/gi, '$1TB')
      .replace(/\bSsd\b/g, 'SSD').replace(/\bRam\b/g, 'RAM').slice(0, 80).trim();

    const generics = ['Electronics','Mobiles','Mobile','Laptops','Laptop','Fashion','Home','Beauty'];
    return generics.includes(slug) || slug.length < 4
      ? (platform === 'amazon' ? 'Amazon Product' : 'Flipkart Product')
      : slug;
  } catch {
    return platform === 'amazon' ? 'Amazon Product' : 'Flipkart Product';
  }
}

function parseAmazon($, html) {
  // ScraperAPI autoparse returns JSON
  try {
    const json = JSON.parse(html);
    if (json.name || json.price) {
      const price = toNum(String(json.price || json.pricing || ''));
      const originalPrice = toNum(String(json.original_price || json.list_price || ''));
      return { price, name: json.name || null, originalPrice: originalPrice > price ? originalPrice : null };
    }
  } catch(e) {}

  // HTML fallback
  let price = null;
  try { const m = html.match(/"priceAmount"\s*:\s*([\d.]+)/); if (m) price = toNum(m[1]); } catch(e) {}
  if (!price) {
    for (const sel of [
      '#corePriceDisplay_desktop_feature_div .a-offscreen',
      '#corePrice_feature_div .a-offscreen',
      '.a-price[data-a-size="xl"] .a-offscreen',
      '.a-price[data-a-size="b"] .a-offscreen',
      '#priceblock_ourprice', '#priceblock_dealprice', '.a-price-whole',
    ]) { price = toNum($(sel).first().text()); if (price && price > 50) break; }
  }

  const name = ($('#productTitle').text().trim() ||
    $('meta[property="og:title"]').attr('content') || ''
  ).replace(/\s+/g, ' ').trim();

  let originalPrice = null;
  for (const sel of ['.basisPrice .a-offscreen', '.a-price.a-text-price .a-offscreen', '#listPrice', '.a-text-strike']) {
    const v = toNum($(sel).first().text());
    if (v && v > (price || 0)) { originalPrice = v; break; }
  }
  return { price, name: name || null, originalPrice };
}

function parseFlipkart($, html) {
  let price = null, name = null, originalPrice = null;

  // With render=true the full JS page is loaded so CSS selectors work
  for (const sel of ['div.Nx9bqj.CxhGGd', 'div.Nx9bqj', '._30jeq3._16Jk6d', '._30jeq3', 'div[class*="Nx9bqj"]', '._16Jk6d']) {
    const v = toNum($(sel).first().text());
    if (v && v > 100) { price = v; break; }
  }

  name = ($('span.B_NuCI').text().trim() ||
    $('h1._6EBuvT').text().trim() ||
    $('h1.yhB1nd').text().trim() ||
    $('h1 span').first().text().trim() ||
    $('h1').first().text().trim()
  ).replace(/\s+/g, ' ').trim() || null;

  // JSON-LD fallback
  if (!price || !name) {
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).html());
        const items = Array.isArray(json['@graph']) ? json['@graph'] : [json];
        for (const item of items) {
          if (!price && item.offers) { const p = toNum(String(item.offers.price || '')); if (p > 100) price = p; }
          if (!name && item.name && item.name.length > 10) name = item.name;
        }
      } catch(e) {}
    });
  }

  // og:title fallback for name
  if (!name) {
    const raw = $('meta[property="og:title"]').attr('content') || $('title').text() || '';
    name = raw.replace(/^Buy\s+/i,'').replace(/\s*[-|].*$/,'').replace(/\s*online.*$/i,'').replace(/\s*at best price.*$/i,'').replace(/\s*in india.*$/i,'').replace(/\s+/g,' ').trim() || null;
  }

  // MRP
  for (const sel of ['._3I9_wc._2p6lqe', '._3I9_wc', 'div[class*="yRaY8j"]']) {
    const v = toNum($(sel).first().text());
    if (v && v > (price || 0)) { originalPrice = v; break; }
  }

  return { price, name: name || null, originalPrice };
}

module.exports = { scrapeUrl };
