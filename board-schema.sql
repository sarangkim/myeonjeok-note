create table if not exists public.board_posts (
  id text primary key,
  author_user_id uuid not null,
  title text not null default '',
  body text not null default '',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.board_comments (
  id text primary key,
  post_id text not null references public.board_posts(id) on delete cascade,
  author_user_id uuid not null,
  body text not null default '',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists board_posts_status_updated_idx on public.board_posts (status, updated_at desc);
create index if not exists board_posts_author_idx on public.board_posts (author_user_id, updated_at desc);
create index if not exists board_comments_post_created_idx on public.board_comments (post_id, created_at asc);
create index if not exists board_comments_author_idx on public.board_comments (author_user_id, updated_at desc);

alter table public.board_posts enable row level security;
alter table public.board_comments enable row level security;
