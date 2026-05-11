create table if not exists public.area_notes (
  id text primary key,
  edit_token text not null,
  address text not null default '',
  road text not null default '',
  jibun text not null default '',
  floor text not null default '',
  ho text not null default '',
  memo text not null default '',
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists area_notes_created_at_idx on public.area_notes (created_at desc);

alter table public.area_notes enable row level security;
