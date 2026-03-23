const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

function processProduct(p) {
  const history = (p.price_history || [])
    .sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at))
    .map(h => ({ date: h.recorded_at, price: parseFloat(h.price) }));

  const prices = history.map(h => h.price);
  const cur = parseFloat(p.current_price) || 0;

  return {
    id: p.id,
    name: p.name,
    url: p.url,
    platform: p.platform,
    category: p.category || 'Electronics',
    currentPrice: cur,
    originalPrice: p.original_price ? parseFloat(p.original_price) : null,
    targetPrice: p.target_price ? parseFloat(p.target_price) : null,
    alertEnabled: p.alert_enabled || false,
    alertTriggered: p.alert_triggered || false,
    favorite: p.favorite || false,
    notes: p.notes || '',
    tags: p.tags || [],
    addedAt: new Date(p.created_at).getTime(),
    priceHistory: history,
    highestPrice: prices.length ? Math.max(...prices) : cur,
    lowestPrice: prices.length ? Math.min(...prices) : cur,
    avgPrice: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : cur,
  };
}

module.exports = { getSupabase, processProduct };
