alter table public.web_studio_followup_queue
  add column if not exists approved_at timestamptz;

create or replace function public.approve_web_studio_followups(
  p_owner_key text,
  p_operation_keys text[],
  p_approve boolean default true
)
returns table(operation_key text, state text, approved_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner_hash text;
begin
  if p_owner_key is null or length(p_owner_key) < 16 then
    raise exception 'invalid_owner_key';
  end if;
  if p_operation_keys is null or cardinality(p_operation_keys) < 1 or cardinality(p_operation_keys) > 100 then
    raise exception 'invalid_approval_batch';
  end if;
  if exists (
    select 1 from unnest(p_operation_keys) k
    where k is null or length(k) <> 64
  ) then
    raise exception 'invalid_operation_key';
  end if;

  v_owner_hash := encode(digest(p_owner_key, 'sha256'), 'hex');

  return query
  update public.web_studio_followup_queue q
  set state = case when p_approve then 'approved' else 'awaiting_approval' end,
      approved_at = case when p_approve then now() else null end,
      claimed_at = null,
      completed_at = null,
      last_error = null,
      updated_at = now()
  where q.owner_hash = v_owner_hash
    and q.operation_key = any(p_operation_keys)
    and q.state in ('awaiting_approval', 'approved')
  returning q.operation_key, q.state, q.approved_at;
end;
$$;

revoke all on function public.approve_web_studio_followups(text,text[],boolean) from public;
grant execute on function public.approve_web_studio_followups(text,text[],boolean) to anon, authenticated;
