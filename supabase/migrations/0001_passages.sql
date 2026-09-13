-- Morse Club: passages served to the trainer.
-- Run once in the Supabase SQL editor. Rows are seeded through the dashboard.

create table public.passages (
  id               bigint generated always as identity primary key,
  title            text not null,
  author           text,                                  -- null for oral tradition
  culture          text not null,                         -- shown on the bubble, e.g. 'GHANA'
  era              text,                                  -- e.g. 'c. 500 BCE'
  blurb            text,                                  -- one line of context, shown in results
  source_url       text,
  license_note     text not null default 'public domain',
  text_original    text not null,                         -- for display and attribution honesty
  text_morse_safe  text not null,                         -- normalized: what we actually grade against
  char_count       int not null,
  tier             int not null check (tier between 1 and 5),
  difficulty_score numeric(5,2) not null default 0,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- The app always asks for one tier's active passages.
create index passages_tier_active_idx on public.passages (tier) where active;

-- Read-only to the public: active passages only. No insert, update or delete
-- policies, so writes are limited to the dashboard / service role.
alter table public.passages enable row level security;

create policy "Active passages are readable by everyone"
  on public.passages
  for select
  to anon, authenticated
  using (active);

-- Projects created after 30 May 2026 don't grant table access to the API roles
-- by default, so PostgREST needs these explicitly.
grant usage on schema public to anon, authenticated;
grant select on public.passages to anon, authenticated;


-- ---------------------------------------------------------------------------
-- Placeholder: scores. Not created yet — design policies and abuse limits first.
-- ---------------------------------------------------------------------------
-- create table public.scores (
--   id            bigint generated always as identity primary key,
--   passage_id    bigint not null references public.passages (id),
--   display_name  text not null check (char_length(display_name) between 1 and 18),
--   accuracy      int not null check (accuracy between 0 and 100),
--   wpm           numeric(5,1) not null check (wpm >= 0),
--   input_mode    text not null check (input_mode in ('key', 'pad')),
--   created_at    timestamptz not null default now()
-- );
--
-- create index scores_passage_created_idx on public.scores (passage_id, created_at desc);
--
-- alter table public.scores enable row level security;
-- grant select, insert on public.scores to anon, authenticated;
