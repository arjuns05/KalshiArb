create table if not exists scans (
  id bigserial primary key,
  best_title text,
  best_edge numeric,
  kalshi_count integer not null default 0,
  polymarket_count integer not null default 0,
  match_count integer not null default 0,
  created_at timestamptz not null default now()
);
