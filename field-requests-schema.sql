create table if not exists public.field_requests (
  id text primary key,
  requester_user_id uuid not null,
  address text not null default '',
  road text not null default '',
  jibun text not null default '',
  floor text not null default '',
  ho text not null default '',
  public_area text not null default '',
  cleaning_type text not null default '',
  space_type text not null default '',
  area_pyeong numeric,
  reward_text text not null default '',
  preferred_date text not null default '',
  description text not null default '',
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.field_request_applications (
  id text primary key,
  request_id text not null references public.field_requests(id) on delete cascade,
  applicant_user_id uuid not null,
  applicant_email text not null default '',
  message text not null default '',
  status text not null default 'pending',
  report_status text,
  report_text text not null default '',
  estimate_amount text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, applicant_user_id)
);

alter table public.field_request_applications add column if not exists report_status text;
alter table public.field_request_applications add column if not exists report_text text not null default '';
alter table public.field_request_applications add column if not exists estimate_amount text not null default '';
alter table public.field_request_applications add column if not exists completed_at timestamptz;
alter table public.field_request_applications add column if not exists applicant_email text not null default '';

create index if not exists field_requests_status_created_at_idx on public.field_requests (status, created_at desc);
create index if not exists field_requests_requester_idx on public.field_requests (requester_user_id, updated_at desc);
create index if not exists field_request_applications_request_idx on public.field_request_applications (request_id, created_at asc);
create index if not exists field_request_applications_applicant_idx on public.field_request_applications (applicant_user_id, updated_at desc);

alter table public.field_requests enable row level security;
alter table public.field_request_applications enable row level security;
