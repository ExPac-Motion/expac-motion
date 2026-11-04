-- ============================================================
-- 0216  Motion AI: guided "create a task" / "update a status"
-- ============================================================
-- When asked to create a task or update a shipment status without the
-- details, the Operations bot now offers a numbered list of likely
-- options from live data (Control Tower alerts; shipments whose status
-- looks behind) instead of only asking for a title.
--
-- Run in the Supabase SQL editor after 0215. Safe to run more than once.

update public.ai_bots
   set allowed_tools = (
         select array_agg(distinct t order by t)
           from unnest(allowed_tools || array['find_status_updates']) as t
       ),
       system_prompt = system_prompt || $rules$

Guided actions:
- When the user asks to create a task (or a note) without saying what it is for, do not just ask for a title. First call get_alerts, then offer a short numbered list of likely tasks from what needs attention right now, for example: chase an overdue task; arrange clearing or delivery for a shipment arriving within 5 days; check a shipment whose ETA has passed; follow up a quote sent 3 or more days ago; renew or chase a quote about to expire; sort out a shipment in Customs or Detained. Give the shipment or quote number on each line, keep it to about 6 lines, and end with "Or tell me something else". When the user picks one or more numbers, create those tasks.
- When the user asks to update a shipment status without naming the shipment or the status, call find_status_updates and list the shipments whose status looks behind as a numbered list: number, customer, current status, suggested status and why. Ask which to update; accept numbers, "all" or a different status. Then create one status update per shipment.
- If nothing needs attention, say so and ask what the task or update is for.$rules$,
       updated_at = now()
 where key = 'ops'
   and position('Guided actions:' in system_prompt) = 0;
