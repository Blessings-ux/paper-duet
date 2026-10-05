import { compressToTarget } from '../services/compress.js';
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

  const wantedMb = Number(req.body?.targetMb);
  const targetBytes = [2, 5].includes(wantedMb) ? wantedMb * 1024 * 1024 : 0;

  const { data: job, error: jobError } = await supabaseAdmin
    .from('merge_jobs')
    .insert({ user_id: req.user.id, status: 'processing' })
    .select()
    .single();

  if (jobError) return res.status(500).json({ error: jobError.message });

  // Respond immediately with the job id; the frontend polls for completion
  // since office-format conversions can take a few seconds each.
  res.json({ jobId: job.id, status: 'processing' });

    processMergeJob(job.id, req.user.id, docs, targetBytes).catch((err) => {
    console.error(`Merge job ${job.id} failed:`, err);
    supabaseAdmin
      .from('merge_jobs')
      .update({ status: 'failed', error_message: err.message })
      .eq('id', job.id)
      .then(() => {});
  });
});

async function processMergeJob(jobId, userId, docs, targetBytes) {
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

    let finalBytes = mergedBytes;
    if (targetBytes) {
      const result = await compressToTarget(mergedBytes, targetBytes, workDir);
      finalBytes = result.bytes;
      console.log(`Compression: ${mergedBytes.length} -> ${finalBytes.length} bytes, reached target: ${result.reachedTarget}`);
    }
    const outputStoragePath = `${userId}/merged/${uuid()}.pdf`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(outputStoragePath, finalBytes, { contentType: 'application/pdf' });

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
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .eq('id', jobId);

    await deleteOriginals(docs); // <-- new line
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
// Originals are no longer needed once the merged PDF exists.
// A cleanup failure is logged but never fails the job.
async function deleteOriginals(docs) {
  const { error: removeError } = await supabaseAdmin.storage
    .from(BUCKET)
    .remove(docs.map((d) => d.storage_path));
  if (removeError) console.error('Could not delete original files:', removeError.message);

  const { error: rowError } = await supabaseAdmin
    .from('documents')
    .delete()
    .in('id', docs.map((d) => d.id));
  if (rowError) console.error('Could not delete document rows:', rowError.message);
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
