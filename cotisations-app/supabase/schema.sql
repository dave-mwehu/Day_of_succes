create extension if not exists pgcrypto;

create table if not exists public.members (
  id text primary key,
  name text not null,
  manual_debt_base numeric not null default 0,
  debt_adjustment numeric not null default 0,
  debt_adjusted_at timestamptz,
  computed_debt numeric not null default 0,
  computed_late_weeks integer not null default 0,
  computed_expected numeric not null default 0,
  computed_total numeric not null default 0,
  stats_updated_at timestamptz
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text not null,
  role text not null check (role in ('admin', 'member')),
  member_id text references public.members(id) on delete set null,
  firebase_uid text unique
);

create table if not exists public.settings (
  id text primary key default 'main',
  start_date date,
  weekly_amount numeric not null default 10000
);

create table if not exists public.weekly_cycles (
  id text primary key,
  index integer not null,
  label text,
  start_date date,
  end_date date,
  status text not null default 'open',
  weekly_amount numeric not null default 10000,
  created_at timestamptz default now()
);

create table if not exists public.member_cycles (
  id text primary key,
  member_id text not null references public.members(id) on delete cascade,
  cycle_id text not null references public.weekly_cycles(id) on delete cascade,
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'waived')),
  amount_paid numeric not null default 0,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz default now(),
  constraint member_cycles_member_cycle_unique unique (member_id, cycle_id)
);

create table if not exists public.deposits (
  id uuid primary key default gen_random_uuid(),
  firebase_id text unique,
  member_id text not null references public.members(id) on delete cascade,
  amount numeric not null check (amount > 0),
  date date not null,
  cycle_id text,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id) on delete set null,
  firebase_created_by text
);

create table if not exists public.debt_adjustments (
  id uuid primary key default gen_random_uuid(),
  firebase_id text unique,
  member_id text references public.members(id) on delete set null,
  member_name text,
  delta numeric not null default 0,
  target_debt numeric,
  auto_debt numeric,
  reason text,
  author uuid references auth.users(id) on delete set null,
  firebase_author text,
  created_at timestamptz default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  firebase_id text unique,
  uid uuid references auth.users(id) on delete cascade,
  firebase_uid text,
  member_id text references public.members(id) on delete cascade,
  member_name text,
  debt numeric,
  weekly_amount numeric,
  message text not null,
  read boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists public.public_stats (
  id text primary key default 'main',
  total numeric not null default 0,
  expected numeric not null default 0,
  debt numeric not null default 0,
  members_count integer not null default 0,
  late_members integer not null default 0,
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.settings (id, weekly_amount)
values ('main', 10000)
on conflict (id) do nothing;

alter table public.members enable row level security;
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.weekly_cycles enable row level security;
alter table public.member_cycles enable row level security;
alter table public.deposits enable row level security;
alter table public.debt_adjustments enable row level security;
alter table public.notifications enable row level security;
alter table public.public_stats enable row level security;

create or replace function public.current_profile()
returns public.profiles
language sql
security definer
set search_path = public
stable
as $$
  select * from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.current_member_id()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select member_id from public.profiles where id = auth.uid();
$$;

create or replace function public.get_group_total()
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(amount), 0) from public.deposits;
$$;

grant execute on function public.get_group_total() to authenticated;

drop policy if exists "profiles read own or admin" on public.profiles;
create policy "profiles read own or admin" on public.profiles
for select using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles admin write" on public.profiles;
create policy "profiles admin write" on public.profiles
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "members read scoped" on public.members;
create policy "members read scoped" on public.members
for select using (public.is_admin() or id = public.current_member_id());

drop policy if exists "members admin write" on public.members;
create policy "members admin write" on public.members
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "settings read signed in" on public.settings;
create policy "settings read signed in" on public.settings
for select using (auth.uid() is not null);

drop policy if exists "settings admin write" on public.settings;
create policy "settings admin write" on public.settings
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "weekly cycles read signed in" on public.weekly_cycles;
create policy "weekly cycles read signed in" on public.weekly_cycles
for select using (auth.uid() is not null);

drop policy if exists "weekly cycles admin write" on public.weekly_cycles;
create policy "weekly cycles admin write" on public.weekly_cycles
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "member cycles read scoped" on public.member_cycles;
create policy "member cycles read scoped" on public.member_cycles
for select using (public.is_admin() or member_id = public.current_member_id());

drop policy if exists "member cycles admin write" on public.member_cycles;
create policy "member cycles admin write" on public.member_cycles
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "deposits read scoped" on public.deposits;
create policy "deposits read scoped" on public.deposits
for select using (public.is_admin() or member_id = public.current_member_id());

drop policy if exists "deposits admin write" on public.deposits;
create policy "deposits admin write" on public.deposits
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "debt adjustments admin only" on public.debt_adjustments;
create policy "debt adjustments admin only" on public.debt_adjustments
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "notifications read scoped" on public.notifications;
create policy "notifications read scoped" on public.notifications
for select using (public.is_admin() or uid = auth.uid() or member_id = public.current_member_id());

drop policy if exists "notifications admin write" on public.notifications;
create policy "notifications admin write" on public.notifications
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "public stats read signed in" on public.public_stats;
create policy "public stats read signed in" on public.public_stats
for select using (auth.uid() is not null);

drop policy if exists "public stats admin write" on public.public_stats;
create policy "public stats admin write" on public.public_stats
for all using (public.is_admin()) with check (public.is_admin());
