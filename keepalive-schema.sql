-- Supabase keepalive table for Vercel Cron.
-- Run this once in Supabase SQL Editor.

create table if not exists public.app_keepalive (
  id text primary key,
  last_seen_at timestamptz not null default now(),
  note text,
  updated_at timestamptz not null default now()
);

alter table public.app_keepalive enable row level security;

drop policy if exists "Service role can manage app keepalive" on public.app_keepalive;
create policy "Service role can manage app keepalive"
on public.app_keepalive
for all
to service_role
using (true)
with check (true);

grant usage on schema public to service_role;
grant select, insert, update on public.app_keepalive to service_role;
