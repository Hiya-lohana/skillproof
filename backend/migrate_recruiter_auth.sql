create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete cascade,
  name text not null,
  email text not null unique,
  college text not null default '',
  course text not null default '',
  bio text not null default '',
  company text not null default '',
  designation text not null default '',
  role text not null default 'student'
    check (role in ('student', 'admin', 'recruiter')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.profiles (id, name, email, college, course, bio, role, created_at, updated_at)
select id, name, email, college, course, bio, role, created_at, updated_at
from public.users
on conflict (id) do nothing;

create table if not exists public.legacy_user_credentials (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  email text not null,
  password_hash text not null
);

insert into public.legacy_user_credentials (user_id, email, password_hash)
select id, email, password from public.users
on conflict (user_id) do nothing;

update public.users set password = '' where password <> '';

alter table public.items drop constraint if exists items_user_id_fkey;
alter table public.items
  add constraint items_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

create table if not exists public.shortlists (
  recruiter_id uuid not null constraint shortlists_recruiter_id_fkey references public.profiles (id) on delete cascade,
  student_id uuid not null constraint shortlists_student_id_fkey references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (recruiter_id, student_id),
  check (recruiter_id <> student_id)
);

create index if not exists items_user_id_idx on public.items (user_id);
create index if not exists items_status_idx on public.items (status);
create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists shortlists_student_id_idx on public.shortlists (student_id);

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.profiles where auth_user_id = auth.uid() limit 1
$$;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where auth_user_id = auth.uid() limit 1
$$;

revoke all on function public.current_profile_id() from public;
revoke all on function public.current_profile_role() from public;
grant execute on function public.current_profile_id() to authenticated;
grant execute on function public.current_profile_role() to authenticated;

alter table public.profiles enable row level security;
alter table public.items enable row level security;
alter table public.shortlists enable row level security;
alter table public.legacy_user_credentials enable row level security;
alter table public.users enable row level security;

grant select on public.profiles to authenticated;
grant update (name, email, college, course, bio, company, designation, updated_at) on public.profiles to authenticated;
grant select, insert, update, delete on public.items to authenticated;
grant select, insert, delete on public.shortlists to authenticated;
grant all on public.profiles, public.items, public.shortlists, public.legacy_user_credentials to service_role;
revoke all on public.legacy_user_credentials from anon, authenticated;
revoke all on public.users from anon, authenticated;

drop policy if exists "Profiles visible to owner and recruiters" on public.profiles;
drop policy if exists "Students update their own profile" on public.profiles;
drop policy if exists "Owners and recruiters read passports" on public.items;
drop policy if exists "Students add their own items" on public.items;
drop policy if exists "Admins update submissions" on public.items;
drop policy if exists "Students delete unverified items" on public.items;
drop policy if exists "Recruiters read their shortlists" on public.shortlists;
drop policy if exists "Recruiters shortlist students" on public.shortlists;
drop policy if exists "Recruiters remove their shortlist entries" on public.shortlists;

create policy "Profiles visible to owner and recruiters"
  on public.profiles for select to authenticated
  using (
    auth_user_id = auth.uid()
    or (role = 'student' and public.current_profile_role() in ('recruiter', 'admin'))
  );
create policy "Students update their own profile"
  on public.profiles for update to authenticated
  using (auth_user_id = auth.uid() and role = 'student')
  with check (auth_user_id = auth.uid() and role = 'student');

create policy "Owners and recruiters read passports"
  on public.items for select to authenticated
  using (
    user_id = public.current_profile_id()
    or (status = 'verified' and public.current_profile_role() = 'recruiter')
    or public.current_profile_role() = 'admin'
  );
create policy "Students add their own items"
  on public.items for insert to authenticated
  with check (
    user_id = public.current_profile_id()
    and public.current_profile_role() = 'student'
  );
create policy "Admins update submissions"
  on public.items for update to authenticated
  using (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');
create policy "Students delete unverified items"
  on public.items for delete to authenticated
  using (
    user_id = public.current_profile_id()
    and public.current_profile_role() = 'student'
    and status <> 'verified'
  );

create policy "Recruiters read their shortlists"
  on public.shortlists for select to authenticated
  using (recruiter_id = public.current_profile_id() and public.current_profile_role() = 'recruiter');
create policy "Recruiters shortlist students"
  on public.shortlists for insert to authenticated
  with check (
    recruiter_id = public.current_profile_id()
    and public.current_profile_role() = 'recruiter'
    and exists (select 1 from public.profiles p where p.id = student_id and p.role = 'student')
  );
create policy "Recruiters remove their shortlist entries"
  on public.shortlists for delete to authenticated
  using (recruiter_id = public.current_profile_id() and public.current_profile_role() = 'recruiter');
