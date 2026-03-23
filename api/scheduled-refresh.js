// Vercel Cron Job - runs daily (configure schedule in vercel.json)
const { getSupabase } = require('./db');
const { scrapeUrl } = require('./scraper');
const { Resend } = require('resend');
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

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
    .select('id, name, url, platform, current_price, session_id');

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

      await supabase
        .from('products')
        .update({
          current_price: newPrice,
          updated_at: new Date().toISOString(),
        })
        .eq('id', product.id);

      await supabase
        .from('price_history')
        .upsert(
          { product_id: product.id, price: newPrice, recorded_at: today },
          { onConflict: 'product_id,recorded_at' }
        );

      // --- EMAIL ALERTS PROCESSING ---
      const { data: triggeredAlerts } = await supabase
        .from('email_alerts')
        .select('id, email, target_price')
        .eq('product_id', product.id)
        .gte('target_price', newPrice);

      if (triggeredAlerts && triggeredAlerts.length > 0) {
        for (const alert of triggeredAlerts) {
          if (resend) {
            await resend.emails.send({
              from: 'PriceHawk <alerts@pricehawk.app>',
              to: alert.email,
              subject: `🚨 Price Drop Alert: ${product.name.slice(0, 40)}`,
              html: `<p>Great news! The product <strong>${product.name}</strong> has dropped to <strong>₹${newPrice}</strong>, which meets your target price of ₹${alert.target_price}!</p>
                     <p><a href="${product.url}" style="display:inline-block;padding:10px 16px;background:#00d4a1;color:#111827;text-decoration:none;border-radius:4px;font-weight:bold;">Buy it now on ${product.platform === 'amazon' ? 'Amazon' : 'Flipkart'}</a></p>
                     <p>- The PriceHawk Team</p>`
            }).catch(e => console.error('[Resend Error]', e.message));
          } else {
            console.log(`[MOCK EMAIL] To: ${alert.email} | Drop: ₹${newPrice} (Target: ₹${alert.target_price})`);
          }
          alertsTriggered++;
        }
        
        // Remove triggered alerts to avoid spamming tomorrow
        const alertIds = triggeredAlerts.map(a => a.id);
        await supabase.from('email_alerts').delete().in('id', alertIds);
      }

      updated++;

      console.log(`[OK] ${product.name}: ₹${newPrice}`);

      // Small delay between requests to be polite
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`[Fail] ${product.name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`[Scheduled Refresh] Done. Updated: ${updated}, Failed: ${failed}, Emails Dispatched: ${alertsTriggered}`);
  return res.status(200).json({ updated, failed, emails_sent: alertsTriggered });
};
