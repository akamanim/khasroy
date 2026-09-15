create or replace function public.claim_web_studio_followups(p_owner_key text, p_limit integer default 10)
returns table(operation_key text, lead_id text, project_slug text, action text, channel text, target_status text, attempts integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner_hash text;
begin
  if p_owner_key is null or length(p_owner_key) < 16 then raise exception 'invalid_owner_key'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 25 then raise exception 'invalid_claim_limit'; end if;
  v_owner_hash := encode(digest(p_owner_key, 'sha256'), 'hex');

  return query
  with candidates as (
    select q.operation_key
    from public.web_studio_followup_queue q
    where q.owner_hash = v_owner_hash
      and q.state = 'approved'
    order by q.created_at asc
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.web_studio_followup_queue q
    set state = 'claimed',
        attempts = q.attempts + 1,
        claimed_at = now(),
        last_error = null,
        updated_at = now()
    from candidates c
    where q.operation_key = c.operation_key
    returning q.operation_key, q.lead_id, q.project_slug, q.action, q.channel, q.target_status, q.attempts
  )
  select c.operation_key, c.lead_id, c.project_slug, c.action, c.channel, c.target_status, c.attempts
  from claimed c;
end;
$$;
revoke all on function public.claim_web_studio_followups(text,integer) from public;
grant execute on function public.claim_web_studio_followups(text,integer) to anon, authenticated;
