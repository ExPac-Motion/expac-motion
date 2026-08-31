-- EXPAC Rate Desk — new mode options. Run in the Supabase SQL editor after 0004.
-- Air Freight (AIR) · Courier Express (CX) · Sea Freight (FCL) · Sea Freight (LCL) · Road Freight (RDX)

-- Map existing rows from the old values.
update public.quotes set mode = case mode
  when 'Air'     then 'Air Freight (AIR)'
  when 'Sea FCL' then 'Sea Freight (FCL)'
  when 'Sea LCL' then 'Sea Freight (LCL)'
  when 'Road'    then 'Road Freight (RDX)'
  else mode
end
where mode in ('Air', 'Sea FCL', 'Sea LCL', 'Road');

update public.jobs set mode = case mode
  when 'Air'     then 'Air Freight (AIR)'
  when 'Sea FCL' then 'Sea Freight (FCL)'
  when 'Sea LCL' then 'Sea Freight (LCL)'
  when 'Road'    then 'Road Freight (RDX)'
  else mode
end
where mode in ('Air', 'Sea FCL', 'Sea LCL', 'Road');

-- Swap the CHECK constraints.
alter table public.quotes drop constraint if exists quotes_mode_check;
alter table public.quotes add constraint quotes_mode_check check (mode in (
  'Air Freight (AIR)',
  'Courier Express (CX)',
  'Sea Freight (FCL)',
  'Sea Freight (LCL)',
  'Road Freight (RDX)'
));

alter table public.jobs drop constraint if exists jobs_mode_check;
alter table public.jobs add constraint jobs_mode_check check (mode in (
  'Air Freight (AIR)',
  'Courier Express (CX)',
  'Sea Freight (FCL)',
  'Sea Freight (LCL)',
  'Road Freight (RDX)'
));

alter table public.quotes alter column mode set default 'Air Freight (AIR)';
alter table public.jobs   alter column mode set default 'Air Freight (AIR)';
