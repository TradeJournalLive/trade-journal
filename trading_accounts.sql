create table if not exists public.trading_accounts (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  base_capital numeric not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create or replace function public.set_trading_accounts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trading_accounts_set_updated_at on public.trading_accounts;
create trigger trading_accounts_set_updated_at
before update on public.trading_accounts
for each row
execute function public.set_trading_accounts_updated_at();

alter table public.trading_accounts enable row level security;

drop policy if exists trading_accounts_select_own on public.trading_accounts;
create policy trading_accounts_select_own
on public.trading_accounts
for select
using (auth.uid() = user_id);

drop policy if exists trading_accounts_insert_own on public.trading_accounts;
create policy trading_accounts_insert_own
on public.trading_accounts
for insert
with check (auth.uid() = user_id);

drop policy if exists trading_accounts_update_own on public.trading_accounts;
create policy trading_accounts_update_own
on public.trading_accounts
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists trading_accounts_delete_own on public.trading_accounts;
create policy trading_accounts_delete_own
on public.trading_accounts
for delete
using (auth.uid() = user_id);

alter table public.trades add column if not exists account_id text;

create index if not exists trades_user_id_account_id_idx
on public.trades (user_id, account_id);

create index if not exists trading_accounts_user_id_idx
on public.trading_accounts (user_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'trades_account_id_fkey'
  ) then
    alter table public.trades
      add constraint trades_account_id_fkey
      foreign key (account_id)
      references public.trading_accounts(id)
      on delete set null;
  end if;
end
$$;
