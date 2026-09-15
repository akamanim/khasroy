create or replace function public.finish_web_studio_followup(p_owner_key text, p_operation_key text, p_success boolean, p_error text default null)
returns table(operation_key text, state text, attempts integer, completed_at timestamptz, last_error text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner_hash text;
begin
  if p_owner_key is null or length(p_owner_key) < 16 then raise exception 'invalid_owner_key'; end if;
  if p_operation_key is null or length(p_operation_key) < 16 then raise exception 'invalid_operation_key'; end if;
  v_owner_hash := encode(digest(p_owner_key, 'sha256'), 'hex');

  return query
  update public.web_studio_followup_queue q
  set state = case when p_success then 'completed' else 'failed' end,
      completed_at = case when p_success then now() else null end,
      last_error = case when p_success then null else left(coalesce(nullif(trim(p_error), ''), 'worker_failed'), 1000) end,
      updated_at = now()
  where q.owner_hash = v_owner_hash
    and q.operation_key = p_operation_key
    and q.state = 'claimed'
  returning q.operation_key, q.state, q.attempts, q.completed_at, q.last_error;
end;
$$;

create or replace function public.requeue_web_studio_followups(p_owner_key text, p_max_attempts integer default 3, p_stale_minutes integer default 15, p_limit integer default 25)
returns table(operation_key text, state text, attempts integer, last_error text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner_hash text;
begin
  if p_owner_key is null or length(p_owner_key) < 16 then raise exception 'invalid_owner_key'; end if;
  if p_max_attempts is null or p_max_attempts < 1 or p_max_attempts > 10 then raise exception 'invalid_max_attempts'; end if;
  if p_stale_minutes is null or p_stale_minutes < 1 or p_stale_minutes > 1440 then raise exception 'invalid_stale_minutes'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'invalid_requeue_limit'; end if;
  v_owner_hash := encode(digest(p_owner_key, 'sha256'), 'hex');

  return query
  with candidates as (
    select q.operation_key
    from public.web_studio_followup_queue q
    where q.owner_hash = v_owner_hash
      and ((q.state = 'failed' and q.attempts < p_max_attempts)
        or (q.state = 'claimed' and q.attempts < p_max_attempts and q.claimed_at < now() - make_interval(mins => p_stale_minutes)))
    order by q.updated_at asc
    for update skip locked
    limit p_limit
  )
  update public.web_studio_followup_queue q
  set state = 'approved',
      approved_at = now(),
      claimed_at = null,
      completed_at = null,
      last_error = case when q.state = 'claimed' then 'stale_claim_requeued' else q.last_error end,
      updated_at = now()
  from candidates c
  where q.operation_key = c.operation_key
  returning q.operation_key, q.state, q.attempts, q.last_error;
end;
$$;

revoke all on function public.finish_web_studio_followup(text,text,boolean,text) from public;
grant execute on function public.finish_web_studio_followup(text,text,boolean,text) to anon, authenticated;
revoke all on function public.requeue_web_studio_followups(text,integer,integer,integer) from public;
grant execute on function public.requeue_web_studio_followups(text,integer,integer,integer) to anon, authenticated;
