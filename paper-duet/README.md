# Paper Duet

Drop in any documents — PDFs, Word docs, slides, images, whatever — reorder them, and merge them into one clean PDF.

## Structure

```
paper-duet/
  backend/     Node.js/Express API: auth check, upload, convert, merge
  frontend/    Plain HTML/CSS/JS client (no build step)
```

## 1. Set up Supabase

1. Create a project at supabase.com.
2. In the SQL editor, run `backend/supabase-schema.sql` to create the `documents` and `merge_jobs` tables.
3. In Storage, create a **private** bucket named `paper-duet-files` (or update `SUPABASE_BUCKET` if you name it differently).
4. Copy your Project URL, `anon` public key, and `service_role` key from Project Settings → API.

## 2. Run the backend

```bash
cd backend
cp .env.example .env   # fill in your Supabase URL + service role key
npm install
```

LibreOffice needs to be installed wherever this runs, since it's what converts Word/PowerPoint/etc. files to PDF:

- **Locally (for testing):** `sudo apt install libreoffice` (Linux) or `brew install --cask libreoffice` (Mac).
- **In production:** use the included `Dockerfile`, which installs LibreOffice automatically. Deploy the image to Render, Railway, or Fly.io.

Then start it:

```bash
npm start
```

The API runs on `http://localhost:4000` by default.

## 3. Run the frontend

Edit `frontend/js/config.js` with your Supabase URL, anon key, and the backend URL. Then just open `frontend/index.html` in a browser, or serve the folder with any static file server:

```bash
cd frontend
npx serve .
```

## How it works

1. User signs up/logs in — handled entirely by Supabase Auth.
2. Uploaded files go straight to Supabase Storage, with metadata (name, order) tracked in the `documents` table.
3. Reordering (drag-and-drop) updates each document's `position`.
4. Hitting "Stitch into one PDF" kicks off a merge job: the backend downloads each file, converts non-PDFs to PDF with LibreOffice headless, concatenates everything with `pdf-lib`, and uploads the result back to Storage.
5. The frontend polls the job until it's done, then shows a download link (a signed URL valid for 1 hour).

## Notes / next steps

- Large batches of Office-format files can take a while to convert — if this becomes a bottleneck, move merge jobs to a proper background queue (e.g. BullMQ + Redis) instead of the current fire-and-forget approach.
- Add OAuth providers (Google, etc.) in the Supabase Auth dashboard — the frontend code will need small additions to trigger `signInWithOAuth`.
