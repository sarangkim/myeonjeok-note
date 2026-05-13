create table if not exists public.user_profiles (
  user_id uuid primary key,
  email text not null default '',
  display_name text not null default '',
  company_name text not null default '',
  phone text not null default '',
  service_area text not null default '',
  bio text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles add column if not exists email text not null default '';
alter table public.user_profiles add column if not exists display_name text not null default '';
alter table public.user_profiles add column if not exists company_name text not null default '';
alter table public.user_profiles add column if not exists phone text not null default '';
alter table public.user_profiles add column if not exists service_area text not null default '';
alter table public.user_profiles add column if not exists bio text not null default '';
alter table public.user_profiles add column if not exists created_at timestamptz not null default now();
alter table public.user_profiles add column if not exists updated_at timestamptz not null default now();

create index if not exists user_profiles_email_idx on public.user_profiles (email);

alter table public.user_profiles enable row level security;
