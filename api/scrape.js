const { scrapeUrl } = require('./scraper');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Session-ID',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function setCors(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const platform =
      url.includes('amazon.in') || url.includes('amazon.com') || url.includes('amzn.in') ? 'amazon'
      : url.includes('flipkart.com') || url.includes('fkrt.it') ? 'flipkart'
      : null;

    if (!platform) {
      return res.status(400).json({ error: 'Only Amazon.in and Flipkart.com URLs are supported' });
    }

    const result = await scrapeUrl(url, platform);
    return res.status(200).json({ ...result, platform, success: true });
  } catch (err) {
    console.error('Scrape error:', err.message);
    return res.status(500).json({ error: err.message, success: false });
  }
};
