import { supabaseAdmin } from '../supabaseClient.js';

// Every request from the frontend carries the user's Supabase access token
// in the Authorization header. We verify it here and attach the user to
// req.user so downstream routes know who's making the request.
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data?.user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  req.user = data.user;
  next();
}
