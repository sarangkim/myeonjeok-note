create table if not exists public.field_request_messages (
  id text primary key,
  request_id text not null references public.field_requests(id) on delete cascade,
  application_id text not null references public.field_request_applications(id) on delete cascade,
  sender_user_id uuid not null,
  body text not null default '',
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create index if not exists field_request_messages_application_created_idx
  on public.field_request_messages (application_id, created_at asc);
create index if not exists field_request_messages_request_created_idx
  on public.field_request_messages (request_id, created_at asc);
create index if not exists field_request_messages_sender_idx
  on public.field_request_messages (sender_user_id, created_at desc);

alter table public.field_request_messages enable row level security;
