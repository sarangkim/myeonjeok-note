-- Add provider penalty tracking.
alter table public.user_profiles add column if not exists provider_penalty_count integer not null default 0;
alter table public.user_profiles add column if not exists provider_suspended_at timestamptz;

update public.user_profiles
set provider_penalty_count = 0
where provider_penalty_count is null;

alter table public.user_profiles drop constraint if exists user_profiles_provider_penalty_count_check;
alter table public.user_profiles add constraint user_profiles_provider_penalty_count_check
  check (provider_penalty_count >= 0);

alter table public.user_profiles drop constraint if exists user_profiles_provider_status_check;
alter table public.user_profiles add constraint user_profiles_provider_status_check
  check (provider_status in ('none', 'pending', 'approved', 'rejected', 'suspended'));

create index if not exists user_profiles_provider_penalty_idx
  on public.user_profiles (member_role, provider_status, provider_penalty_count);
