const { getSupabase } = require('./db');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Session-ID',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

function setCors(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const { action, email, password, name } = req.body || {};

  try {
    switch (action) {
      case 'signup': {
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
        if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

        const { data, error } = await supabase.auth.signUp({
          email: email.toLowerCase().trim(),
          password,
          options: { data: { name: name || '' } },
        });

        if (error) return res.status(400).json({ error: error.message });

        return res.status(200).json({
          success: true,
          user: { id: data.user?.id, email: data.user?.email, name: data.user?.user_metadata?.name },
          session: data.session?.access_token ? { token: data.session.access_token } : null,
          message: data.session ? 'Account created!' : 'Check your email to confirm your account.',
          requiresConfirmation: !data.session,
        });
      }

      case 'login': {
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.toLowerCase().trim(),
          password,
        });

        if (error) return res.status(401).json({ error: 'Invalid email or password' });

        return res.status(200).json({
          success: true,
          user: { id: data.user?.id, email: data.user?.email, name: data.user?.user_metadata?.name || '' },
          session: { token: data.session.access_token },
        });
      }

      case 'logout': {
        await supabase.auth.signOut().catch(() => {});
        return res.status(200).json({ success: true });
      }

      default:
        return res.status(400).json({ error: 'Invalid action. Use: signup, login, logout' });
    }
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(500).json({ error: err.message });
  }
};
