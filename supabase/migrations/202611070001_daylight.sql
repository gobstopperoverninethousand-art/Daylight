-- Additive migration: does not modify existing application tables.
create table if not exists public.daylight_workspaces (
 user_id uuid primary key references auth.users(id) on delete cascade,
 document jsonb not null,
 revision bigint not null default 1,
 updated_at timestamptz not null default now(),
 constraint daylight_schema check (document->>'schemaVersion' = '1')
);
alter table public.daylight_workspaces enable row level security;
drop policy if exists daylight_own_workspace on public.daylight_workspaces;
create policy daylight_own_workspace on public.daylight_workspaces for select to authenticated using (auth.uid() = user_id);
revoke all on public.daylight_workspaces from anon, authenticated;
grant select on public.daylight_workspaces to authenticated;
-- Atomic compare-and-swap prevents stale tabs overwriting newer documents.
create or replace function public.daylight_save_workspace(document jsonb, expected_revision bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare new_revision bigint;
begin
 if auth.uid() is null then raise exception 'not_authenticated'; end if;
 if document->>'schemaVersion' is distinct from '1' or octet_length(document::text)>5000000 then raise exception 'invalid_document'; end if;
 if expected_revision = 0 then
  insert into public.daylight_workspaces(user_id,document,revision) values(auth.uid(),document,1)
  on conflict do nothing returning revision into new_revision;
 else
  update public.daylight_workspaces w set document=daylight_save_workspace.document, revision=w.revision+1, updated_at=now()
  where w.user_id=auth.uid() and w.revision=expected_revision returning revision into new_revision;
 end if;
 if new_revision is null then raise exception 'revision_conflict'; end if;
 return new_revision;
end; $$;
revoke all on function public.daylight_save_workspace(jsonb,bigint) from public,anon;
grant execute on function public.daylight_save_workspace(jsonb,bigint) to authenticated;
create table if not exists public.daylight_google_accounts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 encrypted_tokens text not null,
 updated_at timestamptz not null default now()
);
alter table public.daylight_google_accounts enable row level security;
revoke all on public.daylight_google_accounts from anon,authenticated;
-- No client policies: only the server service-role client may read encrypted credentials.
create table if not exists public.daylight_api_limits (
 user_id uuid not null references auth.users(id) on delete cascade,
 bucket text not null,
 window_start timestamptz not null default now(),
 requests integer not null default 1,
 primary key(user_id,bucket)
);
alter table public.daylight_api_limits enable row level security;
revoke all on public.daylight_api_limits from anon,authenticated;
create or replace function public.daylight_rate_limit(owner_id uuid,bucket_name text,max_requests integer,window_seconds integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 insert into public.daylight_api_limits as l(user_id,bucket) values(owner_id,bucket_name)
 on conflict(user_id,bucket) do update set
 requests=case when l.window_start < now()-make_interval(secs=>window_seconds) then 1 else l.requests+1 end,
 window_start=case when l.window_start < now()-make_interval(secs=>window_seconds) then now() else l.window_start end
 returning requests into n;
 return n<=max_requests;
end; $$;
revoke all on function public.daylight_rate_limit(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.daylight_rate_limit(uuid,text,integer,integer) to service_role;

-- Explicit server privileges; do not depend on project-specific default privileges.
grant select on public.daylight_workspaces to service_role;
grant all on public.daylight_google_accounts to service_role;
grant all on public.daylight_api_limits to service_role;
