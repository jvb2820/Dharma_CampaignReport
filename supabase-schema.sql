create table if not exists public.respond_io_conversations (
  report_date date primary key,
  timezone text not null default 'America/New_York',
  meta numeric,
  total_resp_meta integer,
  new_respond_meta integer,
  total_resp_tiktok integer,
  new_tiktok integer,
  average numeric,
  meta_and_tiktok integer generated always as (
    coalesce(total_resp_meta, 0) + coalesce(total_resp_tiktok, 0)
  ) stored,
  new_meta_and_tiktok integer generated always as (
    coalesce(new_respond_meta, 0) + coalesce(new_tiktok, 0)
  ) stored,
  excluded_tiktok_channel jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meta_budget_reports (
  report_date date primary key,
  timezone text not null default 'America/New_York',
  fetched_at timestamptz not null default now(),
  account_name text not null,
  account_id text not null,
  currency text not null default 'USD',
  meta_total_spending numeric,
  meta_leads_total integer,
  tiktok_total_spending numeric,
  tiktok_leads_total integer,
  average_respond_leads numeric,
  meta_cpr numeric,
  tiktok_cpr numeric,
  respond_cpr numeric,
  campaigns jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_respond_io_conversations_updated_at on public.respond_io_conversations;
create trigger set_respond_io_conversations_updated_at
before update on public.respond_io_conversations
for each row
execute function public.set_updated_at();

drop trigger if exists set_meta_budget_reports_updated_at on public.meta_budget_reports;
create trigger set_meta_budget_reports_updated_at
before update on public.meta_budget_reports
for each row
execute function public.set_updated_at();

alter table public.respond_io_conversations enable row level security;
alter table public.meta_budget_reports enable row level security;

drop policy if exists "Allow anon read respond io conversations" on public.respond_io_conversations;
create policy "Allow anon read respond io conversations"
on public.respond_io_conversations
for select
to anon
using (true);

drop policy if exists "Allow anon write respond io conversations" on public.respond_io_conversations;
create policy "Allow anon write respond io conversations"
on public.respond_io_conversations
for insert
to anon
with check (true);

drop policy if exists "Allow anon update respond io conversations" on public.respond_io_conversations;
create policy "Allow anon update respond io conversations"
on public.respond_io_conversations
for update
to anon
using (true)
with check (true);

drop policy if exists "Allow anon read meta budget reports" on public.meta_budget_reports;
create policy "Allow anon read meta budget reports"
on public.meta_budget_reports
for select
to anon
using (true);

drop policy if exists "Allow anon write meta budget reports" on public.meta_budget_reports;
create policy "Allow anon write meta budget reports"
on public.meta_budget_reports
for insert
to anon
with check (true);

drop policy if exists "Allow anon update meta budget reports" on public.meta_budget_reports;
create policy "Allow anon update meta budget reports"
on public.meta_budget_reports
for update
to anon
using (true)
with check (true);
