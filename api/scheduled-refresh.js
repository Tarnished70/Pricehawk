// Vercel Cron Job - runs daily (configure schedule in vercel.json)
const { getSupabase } = require('./db');
const { scrapeUrl } = require('./scraper');

module.exports = async (req, res) => {
  console.log('[Scheduled Refresh] Starting daily price refresh...');

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    console.error('[Scheduled Refresh] DB init failed:', err.message);
    return res.status(500).json({ error: 'DB init failed' });
  }

  // Get ALL products across all sessions
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, url, platform, current_price, target_price, alert_enabled, alert_triggered, session_id');

  if (error) {
    console.error('[Scheduled Refresh] Fetch error:', error.message);
    return res.status(500).json({ error: error.message });
  }

  if (!products || products.length === 0) {
    console.log('[Scheduled Refresh] No products to refresh');
    return res.status(200).json({ message: 'No products to refresh' });
  }

  console.log(`[Scheduled Refresh] Refreshing ${products.length} products...`);

  const today = new Date().toISOString().split('T')[0];
  let updated = 0;
  let failed = 0;
  let alertsTriggered = 0;

  // Process sequentially to avoid hammering ScraperAPI
  for (const product of products) {
    try {
      const scraped = await scrapeUrl(product.url, product.platform);

      if (!scraped.price || scraped.price <= 0) {
        console.warn(`[Skip] ${product.name}: no price found`);
        failed++;
        continue;
      }

      const newPrice = scraped.price;
      const wasTriggered = product.alert_triggered;
      const isTriggered = product.alert_enabled && product.target_price && newPrice <= parseFloat(product.target_price);

      await supabase
        .from('products')
        .update({
          current_price: newPrice,
          alert_triggered: isTriggered || wasTriggered,
          updated_at: new Date().toISOString(),
        })
        .eq('id', product.id);

      await supabase
        .from('price_history')
        .upsert(
          { product_id: product.id, price: newPrice, recorded_at: today },
          { onConflict: 'product_id,recorded_at' }
        );

      if (isTriggered && !wasTriggered) alertsTriggered++;
      updated++;

      console.log(`[OK] ${product.name}: ₹${newPrice}`);

      // Small delay between requests to be polite
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`[Fail] ${product.name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`[Scheduled Refresh] Done. Updated: ${updated}, Failed: ${failed}, Alerts: ${alertsTriggered}`);
  return res.status(200).json({ updated, failed, alertsTriggered });
};
