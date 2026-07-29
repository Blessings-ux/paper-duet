-- Run this in the Supabase SQL editor once, on a fresh project.

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  storage_path text not null,
  mime_type text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists merge_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'processing', -- processing | done | failed
  output_path text,
  output_url text,
  error_message text,
  created_at timestamptz not null default now()
);

alter table documents enable row level security;
alter table merge_jobs enable row level security;

-- The backend uses the service role key (bypasses RLS), so these policies
-- exist mainly as a safety net if the anon/authenticated key is ever used
-- directly against the database.
create policy "Users manage their own documents"
  on documents for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users view their own merge jobs"
  on merge_jobs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Create a Storage bucket named "paper-duet-files" (private) in the
-- Supabase dashboard, then add matching storage policies so each user
-- can only read/write inside their own uid-prefixed folder.
