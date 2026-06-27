create table if not exists public.estimate_inquiries (
  id text primary key,
  name text not null,
  phone text not null,
  address text,
  estimate_url text,
  source text,
  user_agent text,
  referrer text,
  status text not null default 'new',
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.estimate_inquiries enable row level security;

drop policy if exists "service role can manage estimate inquiries" on public.estimate_inquiries;
create policy "service role can manage estimate inquiries"
on public.estimate_inquiries
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create index if not exists estimate_inquiries_created_at_idx
on public.estimate_inquiries (created_at desc);

grant usage on schema public to service_role;
grant select, insert, update, delete on public.estimate_inquiries to service_role;
