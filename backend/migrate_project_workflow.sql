alter table public.profiles
  add column if not exists visible_to_recruiters boolean not null default true;

alter table public.items
  add column if not exists technologies text[] not null default '{}',
  add column if not exists github_url text not null default '',
  add column if not exists demo_url text not null default '',
  add column if not exists evidence_paths text[] not null default '{}',
  add column if not exists visible_to_recruiters boolean not null default true;

alter table public.items drop constraint if exists items_status_check;
alter table public.items
  add constraint items_status_check
  check (status in ('pending', 'verified', 'rejected', 'self_declared', 'evidence_submitted'));

update public.items
set status = 'self_declared'
where type = 'project' and status in ('pending', 'rejected');

create index if not exists items_visible_projects_idx on public.items (user_id, status)
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

grant select on public.profiles to authenticated;
grant update (name, email, college, course, bio, visible_to_recruiters, company, designation, updated_at) on public.profiles to authenticated;
grant select, delete on public.items to authenticated;
revoke insert, update on public.items from authenticated;
grant insert (user_id, type, title, description, details, link, technologies, github_url, demo_url, visible_to_recruiters) on public.items to authenticated;
grant update (title, description, details, link, technologies, github_url, demo_url, visible_to_recruiters, updated_at) on public.items to authenticated;
grant all on public.items to service_role;

drop policy if exists "Profiles visible to owner and recruiters" on public.profiles;
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

drop policy if exists "Owners and recruiters read passports" on public.items;
drop policy if exists "Admins update submissions" on public.items;
drop policy if exists "Students delete unverified items" on public.items;
drop policy if exists "Students update their own projects" on public.items;
drop policy if exists "Students delete their own items" on public.items;

create policy "Owners and recruiters read passports"
  on public.items for select to authenticated
  using (
    user_id = public.current_profile_id()
    or (
      public.current_profile_role() = 'recruiter'
      and exists (
        select 1 from public.profiles p
        where p.id = user_id and p.visible_to_recruiters
      )
      and (
        (type = 'project' and visible_to_recruiters)
        or (type <> 'project' and status = 'verified')
      )
    )
    or public.current_profile_role() = 'admin'
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

drop trigger if exists set_project_status on public.items;
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
