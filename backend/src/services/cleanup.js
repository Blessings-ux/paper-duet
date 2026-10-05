import { supabaseAdmin, BUCKET } from '../supabaseClient.js';

export async function purgeExpiredMerges() {
  const { data: jobs, error } = await supabaseAdmin
    .from('merge_jobs')
    .select('id, output_path')
    .not('output_path', 'is', null)
    .lt('expires_at', new Date().toISOString());

  if (error) return console.error('Cleanup query failed:', error.message);
  if (!jobs?.length) return;

  const { error: removeError } = await supabaseAdmin.storage
    .from(BUCKET)
    .remove(jobs.map((j) => j.output_path));
  if (removeError) return console.error('Cleanup remove failed:', removeError.message);

  await supabaseAdmin
    .from('merge_jobs')
    .update({ output_path: null, output_url: null })
    .in('id', jobs.map((j) => j.id));
}

export function startCleanupSweeper() {
  purgeExpiredMerges();
  setInterval(purgeExpiredMerges, 10 * 60 * 1000); // every 10 minutes
}