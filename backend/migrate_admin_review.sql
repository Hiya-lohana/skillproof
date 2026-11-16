alter table public.profiles
  add column if not exists visible_to_recruiters boolean not null default true;

alter table public.items
  add column if not exists visible_to_recruiters boolean not null default true;

drop policy if exists "Owners and recruiters read passports" on public.items;
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

drop policy if exists "Project evidence visible to owners and recruiters" on storage.objects;
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
