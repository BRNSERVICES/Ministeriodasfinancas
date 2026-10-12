-- Ministério das Finanças: esquema do banco (Supabase / Postgres)
-- Rode no SQL Editor do projeto certo (ou aplique como migração).

-- ========== Tabelas ==========
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  kind text not null default 'conta' check (kind in ('conta','dinheiro','cartao','poupanca')),
  initial_balance numeric(14,2) not null default 0,
  closing_day int check (closing_day between 1 and 31),
  due_day int check (due_day between 1 and 31),
  pay_account_id uuid references public.accounts(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  type text not null check (type in ('in','out')),
  color text not null default '#8A8F94',
  created_at timestamptz not null default now()
);

create table public.recurrence_rules (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('in','out')),
  description text not null,
  amount numeric(14,2) not null,
  category_id uuid references public.categories(id) on delete set null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  frequency text not null check (frequency in ('monthly','weekly','yearly')),
  start_date date not null,
  end_date date,
  generated_count int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('in','out','tr')),
  description text not null,
  amount numeric(14,2) not null,
  date date not null,
  category_id uuid references public.categories(id) on delete set null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  account_to_id uuid references public.accounts(id) on delete set null,
  paid boolean not null default false,
  series_id uuid,
  rule_id uuid references public.recurrence_rules(id) on delete set null,
  paid_invoice date,
  created_at timestamptz not null default now()
);
-- impede duplicar o lançamento gerado por uma recorrência na mesma data (o app trata o erro 23505)
create unique index transactions_rule_date_uniq on public.transactions (rule_id, date) where rule_id is not null;

create table public.budgets (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  amount numeric(14,2) not null,
  primary key (profile_id, category_id)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  target_amount numeric(14,2) not null,
  target_date date,
  created_at timestamptz not null default now()
);

create table public.goal_deposits (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  amount numeric(14,2) not null,
  date date not null,
  note text,
  created_at timestamptz not null default now()
);

-- ========== Índices ==========
create index on public.profiles (owner_id);
create index on public.accounts (profile_id);
create index on public.categories (profile_id);
create index on public.recurrence_rules (profile_id);
create index on public.transactions (profile_id, date);
create index on public.transactions (account_id);
create index on public.transactions (category_id);
create index on public.budgets (category_id);
create index on public.goals (profile_id);
create index on public.goal_deposits (profile_id);
create index on public.goal_deposits (goal_id);

-- ========== Regras de acesso (RLS): cada pessoa só vê o que é dela ==========
create or replace function public.owns_profile(pid uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = pid and p.owner_id = (select auth.uid()));
$$;
revoke execute on function public.owns_profile(uuid) from public, anon;
grant execute on function public.owns_profile(uuid) to authenticated;

alter table public.profiles enable row level security;
create policy "profiles do dono" on public.profiles
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['accounts','categories','recurrence_rules','transactions','budgets','goals','goal_deposits']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "dono do perfil" on public.%I for all to authenticated using (public.owns_profile(profile_id)) with check (public.owns_profile(profile_id))',
      t);
  end loop;
end $$;

-- ========== Perfil novo já nasce com categorias e carteira padrão ==========
create or replace function public.seed_new_profile()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.categories (profile_id, name, type, color) values
    (new.id,'Moradia','out','#3F6C8C'),(new.id,'Mercado','out','#5E9C76'),
    (new.id,'Transporte','out','#C58B2B'),(new.id,'Restaurantes','out','#C0584A'),
    (new.id,'Saúde','out','#8A5FA8'),(new.id,'Lazer','out','#D27A9E'),
    (new.id,'Educação','out','#4A8F9E'),(new.id,'Assinaturas','out','#7E7F9A'),
    (new.id,'Outros','out','#8A8F94'),
    (new.id,'Salário','in','#12795A'),(new.id,'Freelance','in','#3E9B8A'),
    (new.id,'Rendimentos','in','#6BA368'),(new.id,'Outras receitas','in','#8A9A5B');
  insert into public.accounts (profile_id, name, kind, initial_balance)
    values (new.id, 'Carteira', 'dinheiro', 0);
  return new;
end $$;
revoke execute on function public.seed_new_profile() from public, anon, authenticated;

create trigger profiles_seed
  after insert on public.profiles
  for each row execute function public.seed_new_profile();
