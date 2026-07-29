import { Router } from 'express';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import path from 'path';
import { supabaseAdmin, BUCKET } from '../supabaseClient.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// List the current user's documents, in their chosen merge order.
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('documents')
    .select('*')
    .eq('user_id', req.user.id)
    .order('position', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ documents: data });
});

// Upload one file: store it in Supabase Storage and record it in the DB.
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const ext = path.extname(req.file.originalname);
  const storagePath = `${req.user.id}/${uuid()}${ext}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype });

  if (uploadError) return res.status(500).json({ error: uploadError.message });

  // New files go to the end of the current merge order.
  const { count } = await supabaseAdmin
    .from('documents')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', req.user.id);

  const { data, error } = await supabaseAdmin
    .from('documents')
    .insert({
      user_id: req.user.id,
      filename: req.file.originalname,
      storage_path: storagePath,
      mime_type: req.file.mimetype,
      position: count ?? 0,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ document: data });
});

// Persist a new drag-to-reorder order. Body: { order: [documentId, ...] }
router.put('/reorder', requireAuth, async (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: '"order" must be an array of document ids' });

  const updates = order.map((documentId, position) =>
    supabaseAdmin
      .from('documents')
      .update({ position })
      .eq('id', documentId)
      .eq('user_id', req.user.id)
  );

  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed) return res.status(500).json({ error: failed.error.message });

  res.json({ success: true });
});

// Remove a document the user no longer wants in the merge.
router.delete('/:id', requireAuth, async (req, res) => {
  const { data: doc, error: fetchError } = await supabaseAdmin
    .from('documents')
    .select('storage_path')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (fetchError || !doc) return res.status(404).json({ error: 'Document not found' });

  await supabaseAdmin.storage.from(BUCKET).remove([doc.storage_path]);

  const { error } = await supabaseAdmin
    .from('documents')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

export default router;
