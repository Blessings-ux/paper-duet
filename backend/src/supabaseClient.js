import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// The service role key bypasses row-level security, so this client only
// ever runs on the server, never sent to the browser.
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const BUCKET = process.env.SUPABASE_BUCKET || 'paper-duet-files';
