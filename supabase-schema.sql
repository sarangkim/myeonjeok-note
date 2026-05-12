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
  has_password boolean not null default false,
  password_hash text,
  password_salt text,
  owner_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.area_notes add column if not exists has_password boolean not null default false;
alter table public.area_notes add column if not exists password_hash text;
alter table public.area_notes add column if not exists password_salt text;
alter table public.area_notes add column if not exists owner_user_id uuid;

create index if not exists area_notes_created_at_idx on public.area_notes (created_at desc);
create index if not exists area_notes_owner_user_id_idx on public.area_notes (owner_user_id, updated_at desc);

alter table public.area_notes enable row level security;
