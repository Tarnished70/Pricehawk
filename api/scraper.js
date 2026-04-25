const cheerio = require('cheerio');

async function scrapeUrl(url, platform) {
  const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY;

  let fetchUrl;
  if (SCRAPER_API_KEY) {
    if (platform === 'amazon') {
      fetchUrl = `https://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}&autoparse=true`;
    } else {
      // wait=3000 gives Flipkart JS extra time to hydrate prices
      fetchUrl = `https://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}&country_code=in&render=true&device_type=desktop&wait=3000`;
    }
  } else {
    fetchUrl = url;
    console.warn('[scraper] No SCRAPER_API_KEY — direct fetch will likely be blocked');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  try {
    const res = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-IN,en;q=0.9',
      },
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (!html || html.length < 500) throw new Error('Empty page returned');

    console.log(`[scraper] ${platform} page size: ${html.length} chars`);

    const $ = cheerio.load(html);
    const result = platform === 'amazon' ? parseAmazon($, html) : parseFlipkart($, html);

    if (!result.name || result.name.length < 4) result.name = nameFromUrl(url, platform);
    console.log(`[scraper] price=${result.price} name=${(result.name||'').slice(0,50)}`);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

function toNum(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace(/[₹,\s\u20B9$Rs.]/g, '').trim().split('.')[0]);
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
    return (generics.includes(slug) || slug.length < 4)
      ? (platform === 'amazon' ? 'Amazon Product' : 'Flipkart Product') : slug;
  } catch { return platform === 'amazon' ? 'Amazon Product' : 'Flipkart Product'; }
}

// ─── Amazon ────────────────────────────────────────────────────────────────────

function parseAmazon($, html) {
  // 1. ScraperAPI autoparse JSON
  try {
    const json = JSON.parse(html);
    if (json.name || json.price) {
      const price = toNum(String(json.price || json.pricing || ''));
      const orig = toNum(String(json.original_price || json.list_price || ''));
      return { price, name: json.name || null, originalPrice: orig && orig > price ? orig : null };
    }
  } catch (e) {}

  let price = null;

  // 2. Regex on raw HTML
  for (const pat of [
    /"priceAmount"\s*:\s*([\d.]+)/,
    /"buyingPrice"\s*:\s*([\d.]+)/,
    /class="a-price-whole"[^>]*>([\d,]+)</,
  ]) {
    const m = html.match(pat);
    if (m) { price = toNum(m[1]); if (price && price > 50) break; }
  }

  // 3. CSS selectors
  if (!price) {
    for (const sel of [
      '#corePriceDisplay_desktop_feature_div .a-offscreen',
      '#corePrice_feature_div .a-offscreen',
      '#apex_desktop .a-offscreen',
      '.a-price[data-a-size="xl"] .a-offscreen',
      '.a-price[data-a-size="b"] .a-offscreen',
      '.a-price[data-a-color="price"] .a-offscreen',
      '#priceblock_ourprice', '#priceblock_dealprice',
      '#price_inside_buybox', '.a-price-whole',
    ]) { price = toNum($(sel).first().text()); if (price && price > 50) break; }
  }

  const name = ($('#productTitle').text().trim() ||
    $('meta[property="og:title"]').attr('content') || '').replace(/\s+/g, ' ').trim();

  let originalPrice = null;
  for (const sel of ['.basisPrice .a-offscreen', '.a-price.a-text-price .a-offscreen', '#listPrice', '.a-text-strike']) {
    const v = toNum($(sel).first().text());
    if (v && v > (price || 0)) { originalPrice = v; break; }
  }
  return { price, name: name || null, originalPrice };
}

// ─── Flipkart ──────────────────────────────────────────────────────────────────

function parseFlipkart($, html) {
  let price = null, name = null, originalPrice = null;

  // STRATEGY 1: JSON-LD (class-name independent, most reliable)
  $('script[type="application/ld+json"]').each((_, el) => {
    if (price && name) return false;
    try {
      const json = JSON.parse($(el).html() || '');
      const items = Array.isArray(json['@graph']) ? json['@graph'] : [json];
      for (const item of items) {
        if (!price && item.offers) {
          const p = toNum(String(item.offers.price || item.offers.lowPrice || ''));
          if (p && p > 100) price = p;
        }
        if (!name && item.name && String(item.name).length > 5) name = item.name;
      }
    } catch (e) {}
  });

  // STRATEGY 2: Regex on raw HTML (survives class-name changes)
  if (!price) {
    for (const pat of [
      /"finalPrice"\s*:\s*\{\s*"value"\s*:\s*([\d.]+)/,
      /"sellingPrice"\s*:\s*["']?([\d]+)/,
      /"price"\s*:\s*["']?([\d]+)["']?\s*,\s*"currency"/,
      /property="product:price:amount"\s+content="([\d.]+)"/,
      /content="([\d.]+)"\s+property="product:price:amount"/,
      /data-price="([\d]+)"/,
      /"selling_price"\s*:\s*([\d]+)/,
      /"discountedPrice"\s*:\s*([\d]+)/,
    ]) {
      const m = html.match(pat);
      if (m) { const p = toNum(m[1]); if (p && p > 100) { price = p; break; } }
    }
  }

  // STRATEGY 3: CSS selectors — try both old and new class patterns
  if (!price) {
    const selectors = [
      'div.Nx9bqj', 'div.Nx9bqj.CxhGGd',  // 2024-2025
      '._30jeq3._16Jk6d', '._30jeq3',       // older
      'div[class*="finalPrice"]',
      'div[class*="selling"] span',
      '[class*="sellingPrice"]',
      'div.hl05eU span',
      'div._25b18c ._30jeq3',
    ];
    for (const sel of selectors) {
      try {
        $(sel).each((_, el) => {
          if (price) return false;
          const v = toNum($(el).text());
          if (v && v > 100) { price = v; return false; }
        });
        if (price) break;
      } catch (e) {}
    }
  }

  // STRATEGY 4: Scan all ₹ occurrences in raw HTML — last resort
  if (!price) {
    const freq = {};
    const re = /₹\s*([\d,]+)/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const p = toNum(m[1]);
      if (p && p > 100 && p < 10000000) freq[p] = (freq[p] || 0) + 1;
    }
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    if (sorted.length) price = parseInt(sorted[0][0]);
  }

  // NAME: CSS selectors
  if (!name) {
    for (const sel of ['span.B_NuCI', 'h1._6EBuvT span', 'h1.yhB1nd', 'h1[class*="title"]', 'h1 span', 'h1']) {
      const text = $(sel).first().text().replace(/\s+/g, ' ').trim();
      if (text && text.length > 5 && text.length < 300) { name = text; break; }
    }
  }

  // NAME: og:title / page title fallback
  if (!name) {
    const raw = $('meta[property="og:title"]').attr('content') || $('title').text() || '';
    name = raw.replace(/^Buy\s+/i,'').replace(/\s*[-|].*$/,'')
      .replace(/\s*online.*$/i,'').replace(/\s*at best price.*$/i,'')
      .replace(/\s*in india.*$/i,'').replace(/\s+/g,' ').trim() || null;
  }

  // ORIGINAL PRICE (MRP)
  if (price) {
    for (const pat of [
      /"mrpPrice"\s*:\s*([\d.]+)/,
      /"mrp"\s*:\s*([\d.]+)/,
      /"listingPrice"\s*:\s*([\d.]+)/,
    ]) {
      const m = html.match(pat);
      if (m) { const v = toNum(m[1]); if (v && v > price) { originalPrice = v; break; } }
    }
    if (!originalPrice) {
      for (const sel of ['._3I9_wc._2p6lqe', '._3I9_wc', 'div.BBBY2G', '[class*="MRP"]']) {
        try {
          const v = toNum($(sel).first().text());
          if (v && v > price) { originalPrice = v; break; }
        } catch (e) {}
      }
    }
  }

  return { price, name: name || null, originalPrice };
}

module.exports = { scrapeUrl };
