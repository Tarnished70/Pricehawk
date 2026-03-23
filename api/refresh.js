const { getSupabase } = require('./db');
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

  const { ids } = req.body || {};
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Array of ids required' });
  }

  const supabase = getSupabase();

  try {
    // Fetch specifically requested products
    const { data: products, error } = await supabase
      .from('products')
      .select('*')
      .in('id', ids);

    if (error) throw error;
    if (!products || products.length === 0) {
      return res.status(200).json({ updated: 0, results: [] });
    }

    const today = new Date().toISOString().split('T')[0];
    const results = [];

    // Scrape each product (sequential to avoid hammering)
    for (const product of products) {
      try {
        const scraped = await scrapeUrl(product.url, product.platform);

        if (!scraped.price || scraped.price <= 0) {
          results.push({ id: product.id, name: product.name, success: false, reason: 'Price not found on page' });
          continue;
        }

        const newPrice = scraped.price;

        // Update product current price and updated_at
        await supabase
          .from('products')
          .update({
            current_price: newPrice,
            updated_at: new Date().toISOString(),
          })
          .eq('id', product.id);

        // Upsert today's price into history (one entry per day)
        await supabase.from('price_history').upsert(
          { product_id: product.id, price: newPrice, recorded_at: today },
          { onConflict: 'product_id,recorded_at' }
        );

        results.push({
          id: product.id,
          name: product.name,
          oldPrice: parseFloat(product.current_price),
          newPrice,
          success: true,
        });
      } catch (err) {
        console.error(`Failed to scrape ${product.url}:`, err.message);
        results.push({ id: product.id, name: product.name, success: false, reason: err.message });
      }
    }

    const successCount = results.filter(r => r.success).length;

    return res.status(200).json({ updated: successCount, total: products.length, results });
  } catch (err) {
    console.error('Refresh error:', err);
    return res.status(500).json({ error: err.message });
  }
};
