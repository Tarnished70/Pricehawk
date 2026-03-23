const { getSupabase } = require('./db');

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

  const supabase = getSupabase();

  try {
    switch (req.method) {
      case 'POST': {
        const { product_id, email, target_price, user_id } = req.body || {};
        if (!product_id || !email || !target_price) {
          return res.status(400).json({ error: 'product_id, email, and target_price are required' });
        }

        const record = {
          product_id,
          email: email.toLowerCase().trim(),
          target_price: parseFloat(target_price),
        };
        if (user_id) record.user_id = user_id;

        // Upsert the alert (if they already have an alert for this product, update the target price)
        const { error } = await supabase
          .from('email_alerts')
          .upsert(record, { onConflict: 'email,product_id' });

        if (error) throw error;
        return res.status(200).json({ success: true, message: 'Alert registered successfully' });
      }

      case 'DELETE': {
        const { product_id, email } = req.body || {};
        if (!product_id || !email) {
          return res.status(400).json({ error: 'product_id and email are required to unsubscribe' });
        }

        const { error } = await supabase
          .from('email_alerts')
          .delete()
          .match({ product_id, email: email.toLowerCase().trim() });

        if (error) throw error;
        return res.status(200).json({ success: true, message: 'Alert removed successfully' });
      }

      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('Alerts error:', err);
    return res.status(500).json({ error: err.message });
  }
};
