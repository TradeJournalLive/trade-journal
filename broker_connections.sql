create table if not exists public.broker_accounts (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  broker_name text not null,
  label text not null,
  api_key text,
  client_id text,
  access_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.broker_import_batches (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  broker_account_id text not null references public.broker_accounts(id) on delete cascade,
  broker_name text not null,
  started_at timestamptz not null default now(),
  imported_count integer not null default 0,
  notes text
);

create table if not exists public.broker_imported_trades (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  broker_account_id text not null references public.broker_accounts(id) on delete cascade,
  batch_id text references public.broker_import_batches(id) on delete set null,
  broker_name text not null,
  external_ref text not null,
  broker_trade_id text,
  broker_order_id text,
  symbol text not null,
  side text not null,
  quantity numeric not null default 0,
  entry_price numeric not null default 0,
  exit_price numeric not null default 0,
  executed_at timestamptz not null,
  raw_payload jsonb not null default '{}'::jsonb,
  imported_to_trade_id text,
  created_at timestamptz not null default now(),
  unique (user_id, broker_name, external_ref)
);

create or replace function public.set_broker_accounts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists broker_accounts_set_updated_at on public.broker_accounts;
create trigger broker_accounts_set_updated_at
before update on public.broker_accounts
for each row
execute function public.set_broker_accounts_updated_at();

alter table public.broker_accounts enable row level security;
alter table public.broker_import_batches enable row level security;
alter table public.broker_imported_trades enable row level security;

drop policy if exists broker_accounts_select_own on public.broker_accounts;
create policy broker_accounts_select_own on public.broker_accounts for select using (auth.uid() = user_id);
drop policy if exists broker_accounts_insert_own on public.broker_accounts;
create policy broker_accounts_insert_own on public.broker_accounts for insert with check (auth.uid() = user_id);
drop policy if exists broker_accounts_update_own on public.broker_accounts;
create policy broker_accounts_update_own on public.broker_accounts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists broker_accounts_delete_own on public.broker_accounts;
create policy broker_accounts_delete_own on public.broker_accounts for delete using (auth.uid() = user_id);

drop policy if exists broker_import_batches_select_own on public.broker_import_batches;
create policy broker_import_batches_select_own on public.broker_import_batches for select using (auth.uid() = user_id);
drop policy if exists broker_import_batches_insert_own on public.broker_import_batches;
create policy broker_import_batches_insert_own on public.broker_import_batches for insert with check (auth.uid() = user_id);
drop policy if exists broker_import_batches_update_own on public.broker_import_batches;
create policy broker_import_batches_update_own on public.broker_import_batches for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists broker_import_batches_delete_own on public.broker_import_batches;
create policy broker_import_batches_delete_own on public.broker_import_batches for delete using (auth.uid() = user_id);

drop policy if exists broker_imported_trades_select_own on public.broker_imported_trades;
create policy broker_imported_trades_select_own on public.broker_imported_trades for select using (auth.uid() = user_id);
drop policy if exists broker_imported_trades_insert_own on public.broker_imported_trades;
create policy broker_imported_trades_insert_own on public.broker_imported_trades for insert with check (auth.uid() = user_id);
drop policy if exists broker_imported_trades_update_own on public.broker_imported_trades;
create policy broker_imported_trades_update_own on public.broker_imported_trades for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists broker_imported_trades_delete_own on public.broker_imported_trades;
create policy broker_imported_trades_delete_own on public.broker_imported_trades for delete using (auth.uid() = user_id);

create index if not exists broker_accounts_user_id_idx on public.broker_accounts (user_id);
create index if not exists broker_import_batches_user_id_idx on public.broker_import_batches (user_id, started_at desc);
create index if not exists broker_imported_trades_user_id_idx on public.broker_imported_trades (user_id, broker_name, external_ref);
