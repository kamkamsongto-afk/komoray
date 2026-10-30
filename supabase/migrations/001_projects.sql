-- One row per uploaded video. id = the folder id in R2 (uploads/<id>/...).
create table if not exists public.projects (
	id uuid primary key,
	user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
	video_key text not null unique,
	filename text not null,
	size bigint not null default 0,
	created_at timestamptz not null default now()
);

create index if not exists projects_user_created on public.projects (user_id, created_at desc);

-- Row Level Security: every signed-in user only ever sees and changes their own projects.
alter table public.projects enable row level security;

drop policy if exists "own projects: read" on public.projects;
create policy "own projects: read" on public.projects for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "own projects: add" on public.projects;
create policy "own projects: add" on public.projects for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "own projects: delete" on public.projects;
create policy "own projects: delete" on public.projects for delete to authenticated using (user_id = (select auth.uid()));

grant select, insert, delete on public.projects to authenticated;
revoke all on public.projects from anon;
