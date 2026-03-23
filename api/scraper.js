const cheerio = require('cheerio');

async function scrapeUrl(url, platform) {
  const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY;

  const fetchUrl = SCRAPER_API_KEY
    ? platform === 'amazon'
      ? `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}&autoparse=true`
      : `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}&country_code=in&render=false&device_type=mobile`
    : url;

  const options = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.119 Mobile Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-IN,en;q=0.9',
    },
    signal: AbortSignal.timeout(SCRAPER_API_KEY ? 24000 : 8000),
  };

  const res = await fetch(fetchUrl, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();
  if (html.length < 100) throw new Error('Empty page returned');

  const $ = cheerio.load(html);
  const result = platform === 'amazon' ? parseAmazon($, html) : parseFlipkart($, html);

  // ALWAYS fall back to URL slug for name if scraping fails
  if (!result.name || result.name.length < 4) {
    result.name = nameFromUrl(url, platform);
  }

  return result;
}

function toNum(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace(/[₹,\s\u20B9$]/g, '').trim().split('.')[0]);
  return isNaN(n) || n <= 0 ? null : n;
}

// Extract a clean name from the URL slug - always works as fallback
function nameFromUrl(url, platform) {
  try {
    const path = new URL(url).pathname;
    const parts = path.split('/').filter(Boolean);
    // Flipkart: first segment is the product slug e.g. "apple-macbook-air-m5-2026-m5-16-gb-512-gb-ssd"
    // Amazon: find the part before /dp/
    let slug = '';
    if (platform === 'amazon') {
      const dpIdx = parts.findIndex(p => p === 'dp');
      slug = dpIdx > 0 ? parts[dpIdx - 1] : parts[0];
    } else {
      slug = parts[0] || '';
    }
    // Convert slug to title case, remove size/storage noise at the end
    return slug
      .replace(/-/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
      .replace(/\b(\d+)\s*Gb\b/gi, '$1GB')
      .replace(/\b(\d+)\s*Tb\b/gi, '$1TB')
      .replace(/\bSsd\b/g, 'SSD')
      .replace(/\bRam\b/g, 'RAM')
      .replace(/\bM(\d)\b/g, 'M$1')
      .slice(0, 80)
      .trim();
  } catch {
    return platform === 'amazon' ? 'Amazon Product' : 'Flipkart Product';
  }
}

// ─── AMAZON ────────────────────────────────────────────────
function parseAmazon($, html) {
  // ScraperAPI autoparse=true returns JSON
  try {
    const json = JSON.parse(html);
    if (json.name || json.price) {
      const price = toNum(String(json.price || json.pricing || ''));
      const originalPrice = toNum(String(json.original_price || json.list_price || ''));
      return {
        price,
        name: json.name || null,
        originalPrice: originalPrice && originalPrice > price ? originalPrice : null,
      };
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
    $('span#productTitle').text().trim() ||
    $('meta[property="og:title"]').attr('content') || ''
  ).replace(/\s+/g, ' ').trim();

  let originalPrice = null;
  for (const sel of ['.basisPrice .a-offscreen', '.a-price.a-text-price .a-offscreen', '#listPrice', '.a-text-strike']) {
    const v = toNum($(sel).first().text());
    if (v && v > (price || 0)) { originalPrice = v; break; }
  }
  return { price, name: name || null, originalPrice };
}

// ─── FLIPKART ───────────────────────────────────────────────
function parseFlipkart($, html) {
  let price = null;
  let name = null;
  let originalPrice = null;

  // Strategy 1: Embedded JSON in script tags
  $('script').each((_, el) => {
    if (price && name) return;
    const src = $(el).html() || '';
    if (!price) {
      for (const pat of [
        /"finalPrice"\s*:\s*\{[^}]*"value"\s*:\s*([\d.]+)/,
        /"sellingPrice"\s*:\s*([\d.]+)/,
        /"discountedPrice"\s*:\s*([\d.]+)/,
        /"currentPrice"\s*:\s*([\d.]+)/,
        /finalPrice["\s:]+(\d{4,6})/,
      ]) {
        const m = src.match(pat);
        if (m) { const v = toNum(m[1]); if (v && v > 100 && v < 10000000) { price = v; break; } }
      }
    }
    if (!name) {
      for (const pat of [
        /"title"\s*:\s*"([^"]{10,200})"/,
        /"productTitle"\s*:\s*"([^"]{10,200})"/,
        /"name"\s*:\s*"([^"]{10,200})"/,
      ]) {
        const m = src.match(pat);
        if (m && !m[1].includes('\\u') && !m[1].startsWith('http') && !/^(buy|shop|sell)/i.test(m[1])) {
          name = m[1].replace(/\\n/g, '').replace(/\s+/g, ' ').trim();
          break;
        }
      }
    }
  });

  // Strategy 2: JSON-LD
  if (!price || !name) {
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).html());
        const items = Array.isArray(json['@graph']) ? json['@graph'] : [json];
        for (const item of items) {
          if (!price && item.offers) {
            const p = toNum(String(item.offers.price || item.offers.lowPrice || ''));
            if (p && p > 100) price = p;
          }
          if (!name && item.name && item.name.length > 5 && !/^(buy|shop)/i.test(item.name)) {
            name = item.name;
          }
        }
      } catch(e) {}
    });
  }

  // Strategy 3: Meta tags
  if (!price) {
    const m = $('meta[property="product:price:amount"]').attr('content') ||
              $('meta[itemprop="price"]').attr('content');
    if (m) price = toNum(m);
  }

  // Strategy 4: og:title — clean up Flipkart's "Buy X Online at Best Price in India"
  if (!name) {
    const raw = $('meta[property="og:title"]').attr('content') ||
                $('meta[name="twitter:title"]').attr('content') ||
                $('title').text() || '';
    if (raw) {
      name = raw
        .replace(/^Buy\s+/i, '')
        .replace(/\s*[-|].*$/, '')
        .replace(/\s*online.*$/i, '')
        .replace(/\s*at best price.*$/i, '')
        .replace(/\s*in india.*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (name.length < 4) name = null;
    }
  }

  // Strategy 5: CSS selectors
  if (!price) {
    for (const sel of ['div.Nx9bqj.CxhGGd', 'div.Nx9bqj', '._30jeq3._16Jk6d', '._30jeq3', 'div[class*="Nx9bqj"]']) {
      const v = toNum($(sel).first().text());
      if (v && v > 100) { price = v; break; }
    }
  }
  if (!name) {
    name = ($('span.B_NuCI').text().trim() || $('h1._6EBuvT').text().trim() || $('h1').first().text().trim()).replace(/\s+/g, ' ').trim() || null;
  }

  // MRP
  for (const pat of [/"mrp"\s*:\s*\{[^}]*"value"\s*:\s*([\d.]+)/, /"originalPrice"\s*:\s*([\d.]+)/, /"maximumRetailPrice"\s*:\s*([\d.]+)/]) {
    const m = html.match(pat);
    if (m) { const v = toNum(m[1]); if (v && v > (price || 0)) { originalPrice = v; break; } }
  }
  if (!originalPrice) {
    for (const sel of ['._3I9_wc._2p6lqe', '._3I9_wc', 'div[class*="yRaY8j"]']) {
      const v = toNum($(sel).first().text());
      if (v && v > (price || 0)) { originalPrice = v; break; }
    }
  }

  return { price, name: name || null, originalPrice };
}

module.exports = { scrapeUrl };
