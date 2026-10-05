-- 0139: consolidation houses from active shipments. Every air / sea shipment
-- travels on a house transport document (HAWB / HBL) — issued by ExPac or by
-- the origin agent — either on its own or with others under one master
-- (MAWB / MBL). A house can now point at its shipment (job); the house number
-- and the master number are written back to the shipment's quotation (only
-- where blank) so the shipment documents, tracking and portal show them.

alter table public.wms_consol_houses
  add column if not exists job_id uuid references public.jobs (id) on delete set null,
  add column if not exists issued_by text not null default 'expac' check (issued_by in ('expac', 'agent'));
create index if not exists wms_consol_houses_job on public.wms_consol_houses (job_id);

-- Fill the shipment's master / house numbers (blanks only — never overwrite
-- what an operator typed on the quote).
create or replace function public.wms_sync_house_job(p_house uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  h public.wms_consol_houses%rowtype;
  c public.wms_consols%rowtype;
  qid uuid;
begin
  select * into h from public.wms_consol_houses where id = p_house;
  if not found or h.job_id is null then
    return;
  end if;
  select * into c from public.wms_consols where id = h.consol_id;
  select quote_id into qid from public.jobs where id = h.job_id;
  if qid is not null then
    if c.mode = 'air' then
      update public.quotes set
        mawb_no = coalesce(nullif(mawb_no, ''), c.master_no),
        hawb_no = coalesce(nullif(hawb_no, ''), h.house_no),
        flight_no = coalesce(nullif(flight_no, ''), c.flight_no),
        flight_date = coalesce(flight_date, c.flight_date)
      where id = qid;
    else
      update public.quotes set
        mbl_no = coalesce(nullif(mbl_no, ''), c.master_no),
        hbl_no = coalesce(nullif(hbl_no, ''), h.house_no),
        voyage_no = coalesce(nullif(voyage_no, ''), c.voyage_no)
      where id = qid;
    end if;
  end if;
  update public.jobs set
    container_no = case when c.mode = 'air' then container_no
                        else coalesce(nullif(container_no, ''), h.container_no) end,
    vessel_name = case when c.mode = 'air' then vessel_name
                       else coalesce(nullif(vessel_name, ''), c.vessel) end,
    etd = coalesce(etd, case when c.mode = 'air' then c.flight_date else c.etd end),
    eta = coalesce(eta, c.eta)
  where id = h.job_id;
end;
$$;

create or replace function public.wms_house_job_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.wms_sync_house_job(new.id);
  return new;
end;
$$;
drop trigger if exists trg_wms_house_job on public.wms_consol_houses;
create trigger trg_wms_house_job
  after insert or update of job_id, house_no, container_no on public.wms_consol_houses
  for each row when (new.job_id is not null)
  execute function public.wms_house_job_trg();

-- Master details added later (MAWB / MBL number, flight, vessel) follow to every house's shipment.
create or replace function public.wms_consol_jobs_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  hid uuid;
begin
  for hid in select id from public.wms_consol_houses where consol_id = new.id and job_id is not null loop
    perform public.wms_sync_house_job(hid);
  end loop;
  return new;
end;
$$;
drop trigger if exists trg_wms_consol_jobs on public.wms_consols;
create trigger trg_wms_consol_jobs
  after update of master_no, flight_no, flight_date, vessel, voyage_no, etd, eta on public.wms_consols
  for each row execute function public.wms_consol_jobs_trg();
