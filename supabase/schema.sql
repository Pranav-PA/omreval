-- ============================================================
-- OMREval - Supabase schema
-- Run this in the Supabase SQL editor (Dashboard -> SQL -> New query).
-- ============================================================

-- Users are handled entirely by Supabase Auth (auth.users).
-- We never store password hashes ourselves.

-- ------------------------------------------------------------
-- omr_templates
-- ------------------------------------------------------------
create table if not exists public.omr_templates (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  college_name        text not null,
  template_image_url  text not null,
  template_image_path text,                       -- storage object path, for cleanup
  bubble_positions    jsonb not null,             -- { width, height, questions: [...] }
  answer_key          jsonb not null,             -- { "1": "A", "2": "C", ... }
  created_at          timestamptz not null default now()
);

create index if not exists omr_templates_user_id_idx
  on public.omr_templates (user_id, created_at desc);

-- ------------------------------------------------------------
-- omr_evaluations
-- ------------------------------------------------------------
create table if not exists public.omr_evaluations (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  template_id            uuid not null references public.omr_templates (id) on delete cascade,
  student_name           text not null,
  roll_number            text,
  student_omr_image_url  text,
  student_omr_image_path text,
  results                jsonb not null,          -- full result payload (see lib/types.ts)
  marks                  integer not null,
  max_marks              integer not null default 180,
  created_at             timestamptz not null default now()
);

create index if not exists omr_evaluations_user_id_idx
  on public.omr_evaluations (user_id, created_at desc);

-- ------------------------------------------------------------
-- Row level security: a teacher only ever sees their own rows.
-- ------------------------------------------------------------
alter table public.omr_templates   enable row level security;
alter table public.omr_evaluations enable row level security;

drop policy if exists "templates_select_own" on public.omr_templates;
create policy "templates_select_own" on public.omr_templates
  for select using (auth.uid() = user_id);

drop policy if exists "templates_insert_own" on public.omr_templates;
create policy "templates_insert_own" on public.omr_templates
  for insert with check (auth.uid() = user_id);

drop policy if exists "templates_update_own" on public.omr_templates;
create policy "templates_update_own" on public.omr_templates
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "templates_delete_own" on public.omr_templates;
create policy "templates_delete_own" on public.omr_templates
  for delete using (auth.uid() = user_id);

drop policy if exists "evaluations_select_own" on public.omr_evaluations;
create policy "evaluations_select_own" on public.omr_evaluations
  for select using (auth.uid() = user_id);

drop policy if exists "evaluations_insert_own" on public.omr_evaluations;
create policy "evaluations_insert_own" on public.omr_evaluations
  for insert with check (auth.uid() = user_id);

drop policy if exists "evaluations_delete_own" on public.omr_evaluations;
create policy "evaluations_delete_own" on public.omr_evaluations
  for delete using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- Storage bucket for template + student OMR images.
-- Public read so result PDFs / previews can embed the image directly.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('omr', 'omr', true)
on conflict (id) do nothing;

-- Uploads are namespaced by user id: omr/<user_id>/<...>
drop policy if exists "omr_read_public" on storage.objects;
create policy "omr_read_public" on storage.objects
  for select using (bucket_id = 'omr');

drop policy if exists "omr_insert_own" on storage.objects;
create policy "omr_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'omr'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "omr_delete_own" on storage.objects;
create policy "omr_delete_own" on storage.objects
  for delete using (
    bucket_id = 'omr'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
