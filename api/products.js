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
      case 'GET':    return await getProducts(res, supabase, sessionId);
      case 'POST':   return await addProduct(res, supabase, sessionId, req.body || {});
      case 'PUT':    return await updateProduct(res, supabase, sessionId, req.body || {});
      case 'DELETE': return await deleteProduct(res, supabase, sessionId, req.body || {});
      default:       return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('Products error:', err);
    return res.status(500).json({ error: err.message });
  }
};

async function getProducts(res, supabase, sessionId) {
  const { data, error } = await supabase
    .from('products')
    .select('*, price_history(price, recorded_at)')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return res.status(200).json((data || []).map(processProduct));
}

async function addProduct(res, supabase, sessionId, body) {
  const { name, url, platform, category, currentPrice, originalPrice, targetPrice, alertEnabled, notes, tags } = body;

  if (!name || !url || !currentPrice) {
    return res.status(400).json({ error: 'name, url, currentPrice are required' });
  }

  const { data: product, error } = await supabase
    .from('products')
    .insert({
      session_id: sessionId,
      name: name.trim(),
      url: url.trim(),
      platform: platform || 'amazon',
      category: category || 'Electronics',
      current_price: parseFloat(currentPrice),
      original_price: originalPrice ? parseFloat(originalPrice) : null,
      target_price: targetPrice ? parseFloat(targetPrice) : null,
      alert_enabled: !!alertEnabled,
      alert_triggered: !!(alertEnabled && targetPrice && parseFloat(currentPrice) <= parseFloat(targetPrice)),
      notes: notes || '',
      tags: tags || [],
    })
    .select()
    .single();

  if (error) throw error;

  // Seed price history with today's price
  const today = new Date().toISOString().split('T')[0];
  await supabase.from('price_history').insert({
    product_id: product.id,
    price: parseFloat(currentPrice),
    recorded_at: today,
  });

  return res.status(201).json({ id: product.id, success: true });
}

async function updateProduct(res, supabase, sessionId, body) {
  const { id, ...updates } = body;
  if (!id) return res.status(400).json({ error: 'id required' });

  const dbUpdates = { updated_at: new Date().toISOString() };
  if (updates.name !== undefined)          dbUpdates.name = updates.name;
  if (updates.currentPrice !== undefined)  dbUpdates.current_price = parseFloat(updates.currentPrice);
  if (updates.originalPrice !== undefined) dbUpdates.original_price = updates.originalPrice ? parseFloat(updates.originalPrice) : null;
  if (updates.targetPrice !== undefined)   dbUpdates.target_price = updates.targetPrice ? parseFloat(updates.targetPrice) : null;
  if (updates.alertEnabled !== undefined)  dbUpdates.alert_enabled = updates.alertEnabled;
  if (updates.alertTriggered !== undefined)dbUpdates.alert_triggered = updates.alertTriggered;
  if (updates.favorite !== undefined)      dbUpdates.favorite = updates.favorite;
  if (updates.notes !== undefined)         dbUpdates.notes = updates.notes;
  if (updates.category !== undefined)      dbUpdates.category = updates.category;
  if (updates.tags !== undefined)          dbUpdates.tags = updates.tags;

  const { error } = await supabase
    .from('products')
    .update(dbUpdates)
    .eq('id', id)
    .eq('session_id', sessionId);

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

async function deleteProduct(res, supabase, sessionId, body) {
  const { id } = body;
  if (!id) return res.status(400).json({ error: 'id required' });

  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id)
    .eq('session_id', sessionId);

  if (error) throw error;
  return res.status(200).json({ success: true });
}
