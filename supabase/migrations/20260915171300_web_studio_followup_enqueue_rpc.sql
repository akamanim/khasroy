create table if not exists public.web_studio_followup_queue (
  operation_key text primary key,
  owner_hash text,
  lead_id text not null,
  project_slug text not null,
  action text not null check (action in ('prepare_contact', 'prepare_followup')),
  channel text not null default 'phone' check (channel = 'phone'),
  target_status text,
  state text not null default 'awaiting_approval' check (state in ('awaiting_approval', 'approved', 'claimed', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.web_studio_followup_queue add column if not exists owner_hash text;
create index if not exists web_studio_followup_queue_owner_hash_idx on public.web_studio_followup_queue(owner_hash);
create index if not exists web_studio_followup_queue_project_state_idx on public.web_studio_followup_queue(project_slug, state, created_at);

alter table public.web_studio_followup_queue enable row level security;

create or replace function public.enqueue_web_studio_followups(p_owner_key text, p_items jsonb)
returns table(operation_key text, inserted boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner_hash text;
  v_item jsonb;
  v_key text;
  v_inserted boolean;
begin
  if p_owner_key is null or length(p_owner_key) < 16 then raise exception 'invalid_owner_key'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then raise exception 'invalid_followup_batch'; end if;
  v_owner_hash := encode(digest(p_owner_key, 'sha256'), 'hex');
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_key := nullif(v_item->>'operationKey','');
    if v_key is null or length(v_key) <> 64 then raise exception 'invalid_operation_key'; end if;
    if not exists (select 1 from public.khasroy_web_projects p where p.owner_hash=v_owner_hash and p.project_slug=v_item->>'projectSlug') then raise exception 'project_not_owned'; end if;
    insert into public.web_studio_followup_queue(operation_key, owner_hash, lead_id, project_slug, action, channel, target_status, state, attempts, updated_at)
    values(v_key, v_owner_hash, v_item->>'leadId', v_item->>'projectSlug', v_item->>'action', coalesce(nullif(v_item->>'channel',''),'phone'), nullif(v_item->>'targetStatus',''), 'awaiting_approval', 0, now())
    on conflict (operation_key) do nothing;
    get diagnostics v_inserted = row_count;
    operation_key := v_key;
    inserted := v_inserted;
    return next;
  end loop;
end;
$$;
revoke all on function public.enqueue_web_studio_followups(text,jsonb) from public;
grant execute on function public.enqueue_web_studio_followups(text,jsonb) to anon, authenticated;
