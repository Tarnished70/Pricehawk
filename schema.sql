-- ================================================
-- PriceHawk — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ================================================

-- Products table
create table if not exists products (
  id            uuid default gen_random_uuid() primary key,
  session_id    text not null,
  name          text not null,
  url           text not null,
  platform      text not null check (platform in ('amazon', 'flipkart')),
  category      text default 'Electronics',
  current_price  numeric(12, 2),
  original_price numeric(12, 2),
  target_price   numeric(12, 2),
  alert_enabled  boolean default false,
  alert_triggered boolean default false,
  favorite       boolean default false,
  notes          text default '',
  tags           text[] default '{}',
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- Price history table (one entry per product per day)
create table if not exists price_history (
  id          uuid default gen_random_uuid() primary key,
  product_id  uuid references products(id) on delete cascade,
  price       numeric(12, 2) not null,
  recorded_at date default current_date,
  created_at  timestamptz default now(),
  unique(product_id, recorded_at)
);

-- Performance indexes
create index if not exists idx_products_session    on products(session_id);
create index if not exists idx_products_platform   on products(platform);
create index if not exists idx_price_history_prod  on price_history(product_id, recorded_at desc);

-- Row Level Security (keeps data open since we control via session_id in code)
alter table products      enable row level security;
alter table price_history enable row level security;

create policy "Open access products"      on products      for all using (true) with check (true);
create policy "Open access price_history" on price_history for all using (true) with check (true);
