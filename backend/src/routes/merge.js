import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { supabaseAdmin, BUCKET } from '../supabaseClient.js';
import { requireAuth } from '../middleware/auth.js';
import { convertToPdf, makeTempWorkDir } from '../services/convert.js';
import { mergePdfs } from '../services/merge.js';

const router = Router();

// Kicks off a merge of all the user's current documents, in their saved order.
router.post('/', requireAuth, async (req, res) => {
  const { data: docs, error } = await supabaseAdmin
    .from('documents')
    .select('*')
    .eq('user_id', req.user.id)
    .order('position', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  if (!docs?.length) return res.status(400).json({ error: 'No documents to merge' });

  const { data: job, error: jobError } = await supabaseAdmin
    .from('merge_jobs')
    .insert({ user_id: req.user.id, status: 'processing' })
    .select()
    .single();

  if (jobError) return res.status(500).json({ error: jobError.message });

  // Respond immediately with the job id; the frontend polls for completion
  // since office-format conversions can take a few seconds each.
  res.json({ jobId: job.id, status: 'processing' });

  processMergeJob(job.id, req.user.id, docs).catch((err) => {
    console.error(`Merge job ${job.id} failed:`, err);
    supabaseAdmin
      .from('merge_jobs')
      .update({ status: 'failed', error_message: err.message })
      .eq('id', job.id)
      .then(() => {});
  });
});

async function processMergeJob(jobId, userId, docs) {
  const workDir = await makeTempWorkDir();

  try {
    const pdfPaths = [];

    for (const doc of docs) {
      const localInputPath = path.join(workDir, `${doc.id}${path.extname(doc.storage_path)}`);
      const { data: fileData, error: downloadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .download(doc.storage_path);

      if (downloadError) throw new Error(`Could not download ${doc.filename}: ${downloadError.message}`);

      await fs.writeFile(localInputPath, Buffer.from(await fileData.arrayBuffer()));
      const pdfPath = await convertToPdf(localInputPath, workDir);
      pdfPaths.push(pdfPath);
    }

    const mergedBytes = await mergePdfs(pdfPaths);
    const outputStoragePath = `${userId}/merged/${uuid()}.pdf`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(outputStoragePath, mergedBytes, { contentType: 'application/pdf' });

    if (uploadError) throw new Error(uploadError.message);

    const { data: signedUrlData, error: signError } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(outputStoragePath, 60 * 60); // valid 1 hour

    if (signError) throw new Error(signError.message);

    await supabaseAdmin
      .from('merge_jobs')
      .update({
        status: 'done',
        output_path: outputStoragePath,
        output_url: signedUrlData.signedUrl,
      })
      .eq('id', jobId);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

// Frontend polls this to find out when a merge job is done.
router.get('/:jobId', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('merge_jobs')
    .select('*')
    .eq('id', req.params.jobId)
    .eq('user_id', req.user.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Job not found' });
  res.json({ job: data });
});

export default router;
