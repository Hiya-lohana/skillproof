create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete cascade,
  name text not null,
  email text not null unique,
  college text not null default '',
  course text not null default '',
  bio text not null default '',
  visible_to_recruiters boolean not null default true,
  company text not null default '',
  designation text not null default '',
  role text not null default 'student'
    check (role in ('student', 'admin', 'recruiter')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.legacy_user_credentials (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  email text not null,
  password_hash text not null
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null constraint items_user_id_fkey references public.profiles (id) on delete cascade,
  type text not null check (type in ('skill', 'project', 'certificate', 'achievement')),
  title text not null,
  description text not null default '',
  details text not null default '',
  link text not null default '',
  technologies text[] not null default '{}',
  github_url text not null default '',
  demo_url text not null default '',
  evidence_paths text[] not null default '{}',
  visible_to_recruiters boolean not null default true,
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'rejected', 'self_declared', 'evidence_submitted')),
  admin_remark text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shortlists (
  recruiter_id uuid not null constraint shortlists_recruiter_id_fkey references public.profiles (id) on delete cascade,
  student_id uuid not null constraint shortlists_student_id_fkey references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (recruiter_id, student_id),
  check (recruiter_id <> student_id)
);

create index items_user_id_idx on public.items (user_id);
create index items_status_idx on public.items (status);
create index profiles_role_idx on public.profiles (role);
create index shortlists_student_id_idx on public.shortlists (student_id);
create index items_visible_projects_idx on public.items (user_id, status)
  where type = 'project' and visible_to_recruiters;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-evidence',
  'project-evidence',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

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

grant select on public.profiles to authenticated;
grant update (name, email, college, course, bio, visible_to_recruiters, company, designation, updated_at) on public.profiles to authenticated;
grant select, delete on public.items to authenticated;
revoke insert, update on public.items from authenticated;
grant insert (user_id, type, title, description, details, link, technologies, github_url, demo_url, visible_to_recruiters) on public.items to authenticated;
grant update (title, description, details, link, technologies, github_url, demo_url, visible_to_recruiters, updated_at) on public.items to authenticated;
grant select, insert, delete on public.shortlists to authenticated;
grant all on public.profiles, public.items, public.shortlists, public.legacy_user_credentials to service_role;
revoke all on public.legacy_user_credentials from anon, authenticated;

create policy "Profiles visible to owner and recruiters"
  on public.profiles for select to authenticated
  using (
    auth_user_id = auth.uid()
    or (
      role = 'student'
      and visible_to_recruiters
      and public.current_profile_role() in ('recruiter', 'admin')
    )
  );
create policy "Students update their own profile"
  on public.profiles for update to authenticated
  using (auth_user_id = auth.uid() and role = 'student')
  with check (auth_user_id = auth.uid() and role = 'student');

create policy "Owners and recruiters read passports"
  on public.items for select to authenticated
  using (
    user_id = public.current_profile_id()
    or (
      public.current_profile_role() = 'recruiter'
      and status = 'verified'
      and (type <> 'project' or visible_to_recruiters)
      and exists (
        select 1 from public.profiles p
        where p.id = user_id and p.visible_to_recruiters
      )
    )
    or public.current_profile_role() = 'admin'
  );
create policy "Students add their own items"
  on public.items for insert to authenticated
  with check (
    user_id = public.current_profile_id()
    and public.current_profile_role() = 'student'
  );
create policy "Students update their own projects"
  on public.items for update to authenticated
  using (user_id = public.current_profile_id() and public.current_profile_role() = 'student' and type = 'project')
  with check (user_id = public.current_profile_id() and public.current_profile_role() = 'student' and type = 'project');
create policy "Students delete their own items"
  on public.items for delete to authenticated
  using (
    user_id = public.current_profile_id()
    and public.current_profile_role() = 'student'
    and (type = 'project' or status <> 'verified')
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

create or replace function public.set_project_status_from_evidence()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.type = 'project' and auth.role() <> 'service_role' then
    if tg_op = 'UPDATE'
      and old.status = 'verified'
      and row(new.title, new.description, new.details, new.technologies, new.github_url, new.demo_url, new.evidence_paths)
          is not distinct from
          row(old.title, old.description, old.details, old.technologies, old.github_url, old.demo_url, old.evidence_paths) then
      new.status := 'verified';
    else
      new.status := case
        when cardinality(coalesce(new.evidence_paths, '{}'::text[])) > 0 then 'evidence_submitted'
        else 'self_declared'
      end;
    end if;
  end if;
  return new;
end;
$$;

create trigger set_project_status
  before insert or update on public.items
  for each row execute function public.set_project_status_from_evidence();

drop policy if exists "Project evidence visible to owners and recruiters" on storage.objects;
drop policy if exists "Students upload project evidence" on storage.objects;
drop policy if exists "Students delete project evidence" on storage.objects;

create policy "Project evidence visible to owners and recruiters"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-evidence'
    and (
      (storage.foldername(name))[1] = public.current_profile_id()::text
      or (
        public.current_profile_role() = 'recruiter'
        and exists (
          select 1
          from public.items i
          join public.profiles p on p.id = i.user_id
          where i.id::text = (storage.foldername(name))[2]
            and p.id::text = (storage.foldername(name))[1]
            and p.visible_to_recruiters
            and i.type = 'project'
            and i.status = 'verified'
            and i.visible_to_recruiters
        )
      )
    )
  );
create policy "Students upload project evidence"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-evidence'
    and (storage.foldername(name))[1] = public.current_profile_id()::text
    and public.current_profile_role() = 'student'
    and exists (
      select 1 from public.items i
      where i.id::text = (storage.foldername(name))[2]
        and i.user_id = public.current_profile_id()
        and i.type = 'project'
    )
  );
create policy "Students delete project evidence"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'project-evidence'
    and (storage.foldername(name))[1] = public.current_profile_id()::text
    and public.current_profile_role() = 'student'
  );
