const { getSupabase } = require('./db');

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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sessionId = req.headers['x-session-id'];
  if (!sessionId) return res.status(400).json({ error: 'X-Session-ID required' });

  const { productId, days = 180 } = req.body || {};
  if (!productId) return res.status(400).json({ error: 'productId required' });

  const supabase = getSupabase();

  // Verify product belongs to session
  const { data: product, error: fetchErr } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .eq('session_id', sessionId)
    .single();

  if (fetchErr || !product) return res.status(404).json({ error: 'Product not found' });

  const currentPrice = parseFloat(product.current_price);
  const history = generateRealisticHistory(currentPrice, days);

  // Upsert all history entries
  const entries = history.map(h => ({
    product_id: productId,
    price: h.price,
    recorded_at: h.date,
  }));

  const { error: insertErr } = await supabase
    .from('price_history')
    .upsert(entries, { onConflict: 'product_id,recorded_at' });

  if (insertErr) return res.status(500).json({ error: insertErr.message });

  return res.status(200).json({ success: true, pointsAdded: entries.length });
};

function generateRealisticHistory(currentPrice, days) {
  const history = [];
  const today = new Date();

  // Work backwards from current price
  // Start price was 10-30% higher (products tend to drop over time)
  const startMultiplier = 1 + (Math.random() * 0.2 + 0.1);
  let price = currentPrice * startMultiplier;

  // Generate sale events (Indian shopping: Big Billion Days, Republic Day, Diwali etc.)
  const saleEvents = generateSaleEvents(days);

  for (let i = days; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    // Check if this day is in a sale event
    const saleEvent = saleEvents.find(s => i <= s.startDay && i >= s.endDay);

    if (saleEvent) {
      // During sale: price drops sharply
      price = currentPrice * saleEvent.factor;
    } else {
      // Normal days: small random walk
      const daysSinceStart = days - i;
      const progress = daysSinceStart / days;

      // Gradually trend toward current price
      const target = currentPrice * (1 + (1 - progress) * (startMultiplier - 1));
      const noise = (Math.random() - 0.48) * 0.015; // slight downward bias
      price = price * (1 + noise);

      // Pull toward target
      price = price * 0.97 + target * 0.03;

      // Snap to realistic price endings (₹999, ₹1499 etc.)
      price = snapToRealisticPrice(price);
    }

    // Ensure price never goes below 60% of current (too unrealistic)
    price = Math.max(price, currentPrice * 0.6);

    history.push({ date: dateStr, price: Math.round(price) });
  }

  // Make sure the last entry is exactly the current price
  if (history.length > 0) {
    history[history.length - 1].price = Math.round(currentPrice);
  }

  return history;
}

function generateSaleEvents(totalDays) {
  const events = [];
  const today = new Date();
  const month = today.getMonth(); // 0-indexed

  // Define Indian sale events by rough month
  const saleCalendar = [
    { name: 'Republic Day Sale', month: 0, duration: 4, discount: 0.12 },   // Jan
    { name: 'Budget Sale', month: 1, duration: 3, discount: 0.08 },          // Feb
    { name: 'Holi Sale', month: 2, duration: 3, discount: 0.1 },             // Mar
    { name: 'Summer Sale', month: 3, duration: 5, discount: 0.15 },          // Apr
    { name: 'Mid Year Sale', month: 5, duration: 4, discount: 0.12 },        // Jun
    { name: 'Independence Day Sale', month: 7, duration: 5, discount: 0.18 },// Aug
    { name: 'Onam Sale', month: 8, duration: 4, discount: 0.12 },            // Sep
    { name: 'Navratri Sale', month: 9, duration: 4, discount: 0.15 },        // Oct
    { name: 'Big Billion Days', month: 9, duration: 6, discount: 0.25 },     // Oct (biggest!)
    { name: 'Diwali Sale', month: 10, duration: 5, discount: 0.2 },          // Nov
    { name: 'Year End Sale', month: 11, duration: 7, discount: 0.18 },       // Dec
  ];

  for (const sale of saleCalendar) {
    // Calculate how many days ago this sale was
    let daysAgo = (month - sale.month + 12) % 12 * 30;
    if (daysAgo === 0) daysAgo = 15; // this month, ~2 weeks ago
    if (daysAgo > totalDays) continue; // outside our window

    // Add some randomness to exact timing
    daysAgo += Math.floor(Math.random() * 10) - 5;
    daysAgo = Math.max(5, Math.min(totalDays - 5, daysAgo));

    events.push({
      startDay: daysAgo + sale.duration,
      endDay: daysAgo,
      factor: 1 - sale.discount + (Math.random() * 0.05), // slight randomness
    });
  }

  return events;
}

function snapToRealisticPrice(price) {
  // Indian pricing tends to end in 99, 999, 990, 900 etc.
  const endings = [999, 990, 900, 499, 490, 400];
  const magnitude = Math.pow(10, Math.floor(Math.log10(price)));
  const base = Math.floor(price / magnitude) * magnitude;

  // Find nearest realistic ending
  for (const end of endings) {
    if (end < magnitude) {
      const candidate = base + end;
      if (Math.abs(candidate - price) / price < 0.03) return candidate;
    }
  }
  return Math.round(price / 100) * 100; // round to nearest 100
}
