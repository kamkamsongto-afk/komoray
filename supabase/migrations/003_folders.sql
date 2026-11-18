-- Folders in My projects (coach, 18 Nov): each person makes their own, and a video sits in one folder or none.
-- Deleting a folder never deletes its videos: they go back to "All videos" (on delete set null).
create table if not exists public.folders (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
	name text not null check (char_length(btrim(name)) between 1 and 60),
	created_at timestamptz not null default now()
);

create index if not exists folders_user on public.folders (user_id, created_at);

alter table public.folders enable row level security;

drop policy if exists "own folders: read" on public.folders;
create policy "own folders: read" on public.folders for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "own folders: add" on public.folders;
create policy "own folders: add" on public.folders for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "own folders: rename" on public.folders;
create policy "own folders: rename" on public.folders for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own folders: delete" on public.folders;
create policy "own folders: delete" on public.folders for delete to authenticated using (user_id = (select auth.uid()));

grant select, insert, delete on public.folders to authenticated;
grant update (name) on public.folders to authenticated;
revoke all on public.folders from anon;

-- Which folder a video is in. Only this column of projects may be changed, and only into one of your own folders.
alter table public.projects add column if not exists folder_id uuid references public.folders (id) on delete set null;
create index if not exists projects_folder on public.projects (folder_id);

drop policy if exists "own projects: move" on public.projects;
create policy "own projects: move" on public.projects for update to authenticated
	using (user_id = (select auth.uid()))
	with check (
		user_id = (select auth.uid())
		and (folder_id is null or exists (select 1 from public.folders f where f.id = folder_id and f.user_id = (select auth.uid())))
	);

grant update (folder_id) on public.projects to authenticated;

-- A new project may also only start in one of your own folders (agent review, 18 Nov: insert is granted on every
-- column, so without this a direct insert could point folder_id at someone else's folder). Same rule as 001 otherwise.
drop policy if exists "own projects: add" on public.projects;
create policy "own projects: add" on public.projects for insert to authenticated
	with check (
		user_id = (select auth.uid())
		and (folder_id is null or exists (select 1 from public.folders f where f.id = folder_id and f.user_id = (select auth.uid())))
	);
