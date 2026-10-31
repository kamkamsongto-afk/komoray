-- The personal dictionary: how each user wants words written that speech-to-text gets wrong for
-- them (names, brands, Thai words). Learned whenever they fix words in the script, applied to
-- their next videos. Belongs to the account (not to a payment plan) and only to that user:
-- never shared, never used to train anything.
create table if not exists public.word_fixes (
	user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
	heard text not null, -- as the script showed it, normalized: lower case, no punctuation at the ends
	fixed text not null, -- what the user typed
	uses integer not null default 1, -- how many times they made this fix
	updated_at timestamptz not null default now(),
	primary key (user_id, heard)
);

-- Row Level Security: every signed-in user only ever sees and changes their own words.
alter table public.word_fixes enable row level security;

drop policy if exists "own word fixes: read" on public.word_fixes;
create policy "own word fixes: read" on public.word_fixes for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "own word fixes: add" on public.word_fixes;
create policy "own word fixes: add" on public.word_fixes for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "own word fixes: change" on public.word_fixes;
create policy "own word fixes: change" on public.word_fixes for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own word fixes: delete" on public.word_fixes;
create policy "own word fixes: delete" on public.word_fixes for delete to authenticated using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.word_fixes to authenticated;
revoke all on public.word_fixes from anon;
