const { createClient } = supabase;
const sb = createClient(PAPER_DUET_CONFIG.SUPABASE_URL, PAPER_DUET_CONFIG.SUPABASE_ANON_KEY);

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const queueList = document.getElementById('queueList');
const queueCount = document.getElementById('queueCount');
const queueEmpty = document.getElementById('queueEmpty');
const mergeBtn = document.getElementById('mergeBtn');
const clearBtn = document.getElementById('clearBtn');
const mergeStatus = document.getElementById('mergeStatus');
const shrinkSelect = document.getElementById('shrinkSelect');

const API = PAPER_DUET_CONFIG.BACKEND_URL;
let documents = [];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Guest session (no sign-up needed) ----------

async function ensureSession() {
  const { data } = await sb.auth.getSession();
  if (data.session) return data.session;

  const { data: anon, error } = await sb.auth.signInAnonymously();
  if (error) {
    mergeStatus.textContent = "Couldn't start a session. Please refresh the page.";
    throw error;
  }
  return anon.session;
}

async function authHeader() {
  const session = await ensureSession();
  return { Authorization: `Bearer ${session.access_token}` };
}

// ---------- Upload / dropzone ----------

browseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});
dropzone.addEventListener('click', (e) => {
  if (e.target === dropzone || e.target.closest('.dropzone-title, .dropzone-hint, .dropzone-icon')) {
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => uploadFiles(fileInput.files));

['dragenter', 'dragover'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('is-dragover');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
  })
);
dropzone.addEventListener('drop', (e) => uploadFiles(e.dataTransfer.files));

async function uploadFiles(fileList) {
  if (!fileList.length) return;

  try {
    const headers = await authHeader();

    for (const file of fileList) {
      const formData = new FormData();
      formData.append('file', file);

      setStatus(`Uploading ${file.name}...`);
      const res = await fetch(`${API}/api/documents/upload`, {
        method: 'POST',
        headers,
        body: formData,
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus(`Couldn't upload ${file.name}: ${body.error || res.statusText}`);
        return;
      }
      if (!body.document) {
        setStatus(`Uploaded ${file.name}, but the server didn't return its file record.`);
        return;
      }

      documents.push(body.document);
      renderQueue();
    }

    setStatus('Ready to merge');
  } catch (error) {
    setStatus(`Couldn't upload files: ${error.message || 'Please try again.'}`);
  } finally {
    fileInput.value = '';
  }
}

// ---------- Queue list + reorder ----------

function setStatus(text) {
  mergeStatus.textContent = text;
}

async function loadDocuments() {
  try {
    const headers = await authHeader();
    const res = await fetch(`${API}/api/documents`, { headers });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || `Server responded with ${res.status}.`);
    }
    if (!Array.isArray(body.documents)) {
      throw new Error('The server returned an invalid file list.');
    }

    documents = body.documents;
    renderQueue();
    return true;
  } catch (error) {
    setStatus(`Couldn't load files: ${error.message || 'Please refresh the page.'}`);
    return false;
  }
}

function renderQueue() {
  queueList.innerHTML = '';
  queueEmpty.hidden = documents.length > 0;
  queueCount.textContent = `(${documents.length})`;
  mergeBtn.disabled = documents.length === 0;
  clearBtn.hidden = documents.length === 0;

  documents.forEach((doc, index) => {
    const name = escapeHtml(doc.filename);
    const li = document.createElement('li');
    li.className = 'queue-item';
    li.draggable = true;
    li.dataset.id = doc.id;
    li.innerHTML = `
      <span class="queue-handle" aria-hidden="true">⋮⋮</span>
      <span class="queue-index">${index + 1}</span>
      <span class="queue-filename">${name}</span>
      <button class="queue-remove" data-id="${doc.id}" aria-label="Remove ${name}">&times;</button>
    `;
    queueList.appendChild(li);
  });

  queueList.querySelectorAll('.queue-remove').forEach((btn) => {
    btn.addEventListener('click', () => removeDocument(btn.dataset.id));
  });

  attachDragHandlers();
}

function attachDragHandlers() {
  let dragSrcId = null;

  queueList.querySelectorAll('.queue-item').forEach((item) => {
    item.addEventListener('dragstart', () => {
      dragSrcId = item.dataset.id;
      item.classList.add('is-dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('is-dragging'));
    item.addEventListener('dragover', (e) => e.preventDefault());
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      const targetId = item.dataset.id;
      if (targetId === dragSrcId) return;
      reorderLocally(dragSrcId, targetId);
    });
  });
}

function reorderLocally(sourceId, targetId) {
  const sourceIndex = documents.findIndex((d) => d.id === sourceId);
  const targetIndex = documents.findIndex((d) => d.id === targetId);
  const [moved] = documents.splice(sourceIndex, 1);
  documents.splice(targetIndex, 0, moved);
  renderQueue();
  persistOrder();
}

async function persistOrder() {
  const headers = await authHeader();
  await fetch(`${API}/api/documents/reorder`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ order: documents.map((d) => d.id) }),
  });
}

async function removeDocument(id) {
  const headers = await authHeader();
  await fetch(`${API}/api/documents/${id}`, { method: 'DELETE', headers });
  if (!(await loadDocuments())) return;
  if (!documents.length) setStatus('Waiting for files');
}

// ---------- Clear all ----------

clearBtn.addEventListener('click', async () => {
  if (!documents.length) return;
  clearBtn.disabled = true;
  setStatus('Clearing...');
  const headers = await authHeader();
  await Promise.all(
    documents.map((d) => fetch(`${API}/api/documents/${d.id}`, { method: 'DELETE', headers }))
  );
  clearBtn.disabled = false;
  if (!(await loadDocuments())) return;
  setStatus('Waiting for files');
});

// ---------- Merge ----------

mergeBtn.addEventListener('click', async () => {
  mergeBtn.disabled = true;
  setStatus(shrinkSelect.value ? 'Stitching and shrinking your files...' : 'Stitching your files together...');

  const headers = await authHeader();
  const res = await fetch(`${API}/api/merge`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetMb: shrinkSelect.value ? Number(shrinkSelect.value) : null }),
  });

  const body = await res.json();
  if (!res.ok) {
    setStatus(body.error || 'Something went wrong starting the merge.');
    mergeBtn.disabled = false;
    return;
  }

  pollMergeJob(body.jobId);
});

async function pollMergeJob(jobId) {
  const headers = await authHeader();
  const res = await fetch(`${API}/api/merge/${jobId}`, { headers });
  const body = await res.json();
  const job = body.job;

  if (job.status === 'processing') {
    setTimeout(() => pollMergeJob(jobId), 1500);
    return;
  }

  mergeBtn.disabled = documents.length === 0;

  if (job.status === 'done') {
    const size = job.final_size_bytes ? ` (${(job.final_size_bytes / 1048576).toFixed(1)} MB)` : '';
    const warn = job.target_met === false
      ? " It's still over your size limit. We shrank it as far as we could."
      : '';
    mergeStatus.innerHTML = `Done — <a href="${job.output_url}" target="_blank" rel="noopener">download your PDF</a>${size}.${warn}`;
    await loadDocuments(); // the server deleted the originals, so refresh the queue
  } else {
    setStatus(job.error_message || 'The merge failed. Please try again.');
  }
}

// ---------- Boot ----------

(async () => {
  try {
    await ensureSession();
    if (await loadDocuments()) {
      setStatus(documents.length ? 'Ready to merge' : 'Waiting for files');
    }
  } catch (error) {
    setStatus(`Couldn't start a session: ${error.message || 'Please refresh the page.'}`);
  }
})();