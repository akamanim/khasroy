-- Follow-up workers mutate approval/claim/repair state and must never be callable
-- directly with browser roles. Keep execution on the trusted backend only.

revoke execute on function public.enqueue_web_studio_followups(text,jsonb) from anon, authenticated;
revoke execute on function public.approve_web_studio_followups(text,text[],boolean) from anon, authenticated;
revoke execute on function public.claim_web_studio_followups(text,integer) from anon, authenticated;
revoke execute on function public.finish_web_studio_followup(text,text,boolean,text) from anon, authenticated;
revoke execute on function public.requeue_web_studio_followups(text,integer,integer,integer) from anon, authenticated;

grant execute on function public.enqueue_web_studio_followups(text,jsonb) to service_role;
grant execute on function public.approve_web_studio_followups(text,text[],boolean) to service_role;
grant execute on function public.claim_web_studio_followups(text,integer) to service_role;
grant execute on function public.finish_web_studio_followup(text,text,boolean,text) to service_role;
grant execute on function public.requeue_web_studio_followups(text,integer,integer,integer) to service_role;
