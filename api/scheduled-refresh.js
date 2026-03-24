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
              subject: `🦅 Price Drop: ${product.name.slice(0, 50)} is now ₹${newPrice}`,
              html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#101418;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#0c1120;border:1px solid rgba(255,255,255,0.1);border-radius:16px;overflow:hidden;">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#4dd0e1,#4f9eff);padding:24px 28px;display:flex;align-items:center;gap:12px;">
      <span style="font-size:28px;">🦅</span>
      <span style="font-size:20px;font-weight:800;color:#101418;letter-spacing:-0.5px;">PriceHawk</span>
      <span style="margin-left:auto;background:rgba(6,10,20,0.2);color:#101418;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;">PRICE ALERT</span>
    </div>
    <!-- Body -->
    <div style="padding:28px;">
      <p style="color:#94a3b8;font-size:13px;margin:0 0 6px;">Your target price was reached!</p>
      <h2 style="color:#f1f5f9;font-size:16px;font-weight:700;margin:0 0 20px;line-height:1.4;">${product.name}</h2>
      <!-- Price row -->
      <div style="background:#22272e;border-radius:12px;padding:18px;margin-bottom:20px;display:flex;align-items:center;gap:20px;">
        <div>
          <div style="color:#475569;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Current Price</div>
          <div style="color:#4dd0e1;font-size:28px;font-weight:800;font-family:'Courier New',monospace;">₹${newPrice.toLocaleString('en-IN')}</div>
        </div>
        <div style="color:#475569;font-size:20px;">→</div>
        <div>
          <div style="color:#475569;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Your Target</div>
          <div style="color:#94a3b8;font-size:20px;font-weight:700;font-family:'Courier New',monospace;">₹${alert.target_price.toLocaleString('en-IN')}</div>
        </div>
      </div>
      <a href="${product.url}" style="display:block;text-align:center;padding:14px;background:#4dd0e1;color:#101418;text-decoration:none;border-radius:10px;font-size:15px;font-weight:800;letter-spacing:-0.3px;">
        Buy on ${product.platform === 'amazon' ? 'Amazon' : 'Flipkart'} →
      </a>
      <p style="color:#475569;font-size:11.5px;margin:20px 0 0;text-align:center;">This alert has been removed. Track the product again to set a new one.</p>
    </div>
  </div>
</body></html>`
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
