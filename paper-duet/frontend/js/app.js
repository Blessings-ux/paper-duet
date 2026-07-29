const { createClient } = supabase;
const sb = createClient(PAPER_DUET_CONFIG.SUPABASE_URL, PAPER_DUET_CONFIG.SUPABASE_ANON_KEY);

const heroSection = document.getElementById('heroSection');
const dashboardSection = document.getElementById('dashboardSection');
const headerAccount = document.getElementById('headerAccount');

const authForm = document.getElementById('authForm');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authSubmit = document.getElementById('authSubmit');
const authMessage = document.getElementById('authMessage');
const toggleButtons = document.querySelectorAll('.auth-toggle-btn');
let authMode = 'signin';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const queueList = document.getElementById('queueList');
const queueCount = document.getElementById('queueCount');
const queueEmpty = document.getElementById('queueEmpty');
const mergeBtn = document.getElementById('mergeBtn');
const mergeStatus = document.getElementById('mergeStatus');

let documents = [];

// ---------- Auth ----------

toggleButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    authMode = btn.dataset.mode;
    toggleButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
    authSubmit.textContent = authMode === 'signin' ? 'Sign in' : 'Create account';
    authMessage.textContent = '';
  });
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authMessage.textContent = '';
  authSubmit.disabled = true;

  const email = authEmail.value.trim();
  const password = authPassword.value;

  const { error } =
    authMode === 'signin'
      ? await sb.auth.signInWithPassword({ email, password })
      : await sb.auth.signUp({ email, password });

  authSubmit.disabled = false;

  if (error) {
    authMessage.textContent = error.message;
    return;
  }

  if (authMode === 'signup') {
    authMessage.textContent = 'Check your email to confirm your account, then sign in.';
  }
});

async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

async function authHeader() {
  const session = await getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

sb.auth.onAuthStateChange((_event, session) => {
  renderAuthState(session);
});

async function renderAuthState(session) {
  if (session?.user) {
    heroSection.hidden = true;
    dashboardSection.hidden = false;
    headerAccount.innerHTML = `
      <span class="account-email">${session.user.email}</span>
      <button class="link-btn" id="signOutBtn">Sign out</button>
    `;
    document.getElementById('signOutBtn').addEventListener('click', () => sb.auth.signOut());
    await loadDocuments();
  } else {
    heroSection.hidden = false;
    dashboardSection.hidden = true;
    headerAccount.innerHTML = '';
  }
}

// ---------- Upload / dropzone ----------

browseBtn.addEventListener('click', () => fileInput.click());
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
  const headers = await authHeader();

  for (const file of fileList) {
    const formData = new FormData();
    formData.append('file', file);

    mergeStatus.textContent = `Uploading ${file.name}...`;
    const res = await fetch(`${PAPER_DUET_CONFIG.BACKEND_URL}/api/documents/upload`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      mergeStatus.textContent = `Couldn't upload ${file.name}: ${body.error || res.statusText}`;
      return;
    }
  }

  mergeStatus.textContent = '';
  fileInput.value = '';
  await loadDocuments();
}

// ---------- Queue list + reorder ----------

async function loadDocuments() {
  const headers = await authHeader();
  const res = await fetch(`${PAPER_DUET_CONFIG.BACKEND_URL}/api/documents`, { headers });
  if (!res.ok) return;

  const body = await res.json();
  documents = body.documents || [];
  renderQueue();
}

function renderQueue() {
  queueList.innerHTML = '';
  queueEmpty.hidden = documents.length > 0;
  queueCount.textContent = `${documents.length} file${documents.length === 1 ? '' : 's'}`;
  mergeBtn.disabled = documents.length === 0;

  documents.forEach((doc, index) => {
    const li = document.createElement('li');
    li.className = 'queue-item';
    li.draggable = true;
    li.dataset.id = doc.id;
    li.innerHTML = `
      <span class="queue-handle" aria-hidden="true">⠿</span>
      <span class="queue-index">${index + 1}</span>
      <span class="queue-filename">${doc.filename}</span>
      <button class="queue-remove" data-id="${doc.id}" aria-label="Remove ${doc.filename}">&times;</button>
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
  await fetch(`${PAPER_DUET_CONFIG.BACKEND_URL}/api/documents/reorder`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ order: documents.map((d) => d.id) }),
  });
}

async function removeDocument(id) {
  const headers = await authHeader();
  await fetch(`${PAPER_DUET_CONFIG.BACKEND_URL}/api/documents/${id}`, {
    method: 'DELETE',
    headers,
  });
  await loadDocuments();
}

// ---------- Merge ----------

mergeBtn.addEventListener('click', async () => {
  mergeBtn.disabled = true;
  mergeStatus.textContent = 'Stitching your files together...';

  const headers = await authHeader();
  const res = await fetch(`${PAPER_DUET_CONFIG.BACKEND_URL}/api/merge`, {
    method: 'POST',
    headers,
  });

  const body = await res.json();
  if (!res.ok) {
    mergeStatus.textContent = body.error || 'Something went wrong starting the merge.';
    mergeBtn.disabled = false;
    return;
  }

  pollMergeJob(body.jobId);
});

async function pollMergeJob(jobId) {
  const headers = await authHeader();
  const res = await fetch(`${PAPER_DUET_CONFIG.BACKEND_URL}/api/merge/${jobId}`, { headers });
  const body = await res.json();
  const job = body.job;

  if (job.status === 'processing') {
    setTimeout(() => pollMergeJob(jobId), 1500);
    return;
  }

  mergeBtn.disabled = false;

  if (job.status === 'done') {
    mergeStatus.innerHTML = `Done — <a href="${job.output_url}" target="_blank" rel="noopener">download your paper</a>`;
  } else {
    mergeStatus.textContent = job.error_message || 'The merge failed. Please try again.';
  }
}

// ---------- Boot ----------

(async () => {
  const session = await getSession();
  renderAuthState(session);
})();
