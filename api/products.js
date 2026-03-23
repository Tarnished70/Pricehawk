const { getSupabase, processProduct } = require('./db');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Session-ID',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

function setCors(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sessionId = req.headers['x-session-id'];
  if (!sessionId) {
    return res.status(400).json({ error: 'X-Session-ID header required' });
  }

  const supabase = getSupabase();

  try {
    switch (req.method) {
      case 'GET':    return await getProducts(req, res, supabase);
      case 'POST':   return await addProduct(res, supabase, sessionId, req.body || {});
      case 'PUT':    return await updateProduct(res, supabase, req.body || {});
      case 'DELETE': return res.status(200).json({ success: true, note: 'Global delete disabled' });
      default:       return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('Products error:', err);
    return res.status(500).json({ error: err.message });
  }
};

async function getProducts(req, res, supabase) {
  const urlObj = new URL(req.url, 'http://localhost');
  const idsParam = urlObj.searchParams.get('ids');
  const trending = urlObj.searchParams.get('trending');

  let query = supabase.from('products').select('*, price_history(price, recorded_at)');

  if (idsParam) {
    const ids = idsParam.split(',').filter(Boolean);
    if (ids.length === 0) return res.status(200).json([]);
    query = query.in('id', ids);
  } else if (trending === 'true') {
    // Trending: recently updated/scraped products globally
    query = query.order('updated_at', { ascending: false }).limit(40);
  } else {
    // Default fallback
    query = query.order('created_at', { ascending: false }).limit(20);
  }

  const { data, error } = await query;
  if (error) throw error;
  return res.status(200).json((data || []).map(processProduct));
}

function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    // Strip all query params like ?tag=, &ref=
    url.search = '';
    url.hash = '';
    let clean = url.toString();
    return clean.endsWith('/') ? clean.slice(0, -1) : clean;
  } catch {
    return rawUrl;
  }
}

async function addProduct(res, supabase, sessionId, body) {
  const { name, url, platform, category, currentPrice, originalPrice } = body;

  if (!url) return res.status(400).json({ error: 'url is required' });
  const cleanUrl = normalizeUrl(url);

  // 1. Check if product already exists globally
  const { data: existing } = await supabase
    .from('products')
    .select('*, price_history(price, recorded_at)')
    .eq('url', cleanUrl)
    .single();

  if (existing) {
    // Product exists! Return it instantly with all history.
    return res.status(200).json({ id: existing.id, isNew: false, product: processProduct(existing) });
  }

  // 2. If it does not exist, we create it
  if (!name || !currentPrice) {
    return res.status(400).json({ error: 'name and currentPrice are required to create a new product' });
  }

  const { data: product, error } = await supabase
    .from('products')
    .insert({
      session_id: sessionId, // Track original creator
      name: name.trim(),
      url: cleanUrl,
      platform: platform || 'amazon',
      category: category || 'Electronics',
      current_price: parseFloat(currentPrice),
      original_price: originalPrice ? parseFloat(originalPrice) : null,
      notes: '',
      tags: [],
    })
    .select()
    .single();

  if (error) throw error;

  // Seed initial price history point over
  const today = new Date().toISOString().split('T')[0];
  await supabase.from('price_history').insert({
    product_id: product.id,
    price: parseFloat(currentPrice),
    recorded_at: today,
  });

  return res.status(201).json({ id: product.id, isNew: true });
}

async function updateProduct(res, supabase, body) {
  const { id, ...updates } = body;
  if (!id) return res.status(400).json({ error: 'id required' });

  const dbUpdates = { updated_at: new Date().toISOString() };
  if (updates.name !== undefined)          dbUpdates.name = updates.name;
  if (updates.currentPrice !== undefined)  dbUpdates.current_price = Math.max(0, parseFloat(updates.currentPrice));
  if (updates.originalPrice !== undefined) dbUpdates.original_price = updates.originalPrice ? parseFloat(updates.originalPrice) : null;
  if (updates.category !== undefined)      dbUpdates.category = updates.category;

  // Notice we no longer update alerts/notes/tags in the DB, as they are now personal/local features.
  
  // No session_id restriction — anyone auto-updating the price globally can update the row.
  const { error } = await supabase
    .from('products')
    .update(dbUpdates)
    .eq('id', id);

  if (error) throw error;

  // Add price history entry if price changed
  if (updates.currentPrice !== undefined) {
    const today = new Date().toISOString().split('T')[0];
    await supabase.from('price_history').upsert(
      { product_id: id, price: parseFloat(updates.currentPrice), recorded_at: today },
      { onConflict: 'product_id,recorded_at' }
    );
  }

  return res.status(200).json({ success: true });
}

