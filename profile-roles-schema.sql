-- Store member type and provider approval state.
alter table public.user_profiles add column if not exists member_role text not null default 'customer';
alter table public.user_profiles add column if not exists provider_status text not null default 'none';
alter table public.user_profiles add column if not exists provider_requested_at timestamptz;
alter table public.user_profiles add column if not exists provider_approved_at timestamptz;

update public.user_profiles
set member_role = 'customer'
where member_role is null or member_role = '';

update public.user_profiles
set provider_status = case
  when member_role = 'provider' and (provider_status is null or provider_status = '' or provider_status = 'none') then 'pending'
  when member_role <> 'provider' then 'none'
  else provider_status
end;

alter table public.user_profiles drop constraint if exists user_profiles_member_role_check;
alter table public.user_profiles add constraint user_profiles_member_role_check
  check (member_role in ('customer', 'provider'));

alter table public.user_profiles drop constraint if exists user_profiles_provider_status_check;
alter table public.user_profiles add constraint user_profiles_provider_status_check
  check (provider_status in ('none', 'pending', 'approved', 'rejected'));

create index if not exists user_profiles_member_role_idx on public.user_profiles (member_role, provider_status);
