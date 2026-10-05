-- 0138: WMS in the Customer Portal (Warehouse tab) + sea consolidations
-- (LCL groupage, FCL consolidation) next to air. A customer login reads only
-- its own warehouse data; nothing here lets it write. Builds on 0137.

-- Releases: also those holding the customer's goods on a shared release
-- (an air consolidation release has no single customer).
drop policy if exists "portal own releases" on public.wms_releases;
create policy "portal own releases" on public.wms_releases for select to authenticated
  using (
    public.my_client_id() is not null
    and (
      client_id = public.my_client_id()
      or exists (
        select 1 from public.wms_release_lines l
        join public.wms_receipts r on r.id = l.receipt_id
        where l.release_id = wms_releases.id and r.client_id = public.my_client_id()
      )
    )
  );

-- Release lines: only the lines for the customer's own receipts.
drop policy if exists "portal own release lines" on public.wms_release_lines;
create policy "portal own release lines" on public.wms_release_lines for select to authenticated
  using (exists (
    select 1 from public.wms_receipts r
    where r.id = receipt_id and r.client_id is not null and r.client_id = public.my_client_id()
  ));

-- Storage statements (billing runs) for the customer.
drop policy if exists "portal own billing" on public.wms_billing_runs;
create policy "portal own billing" on public.wms_billing_runs for select to authenticated
  using (client_id is not null and client_id = public.my_client_id());

-- Warehouses / bays the customer's goods are in (names on screen and documents).
drop policy if exists "portal used warehouses" on public.wms_warehouses;
create policy "portal used warehouses" on public.wms_warehouses for select to authenticated
  using (exists (
    select 1 from public.wms_receipts r
    where r.warehouse_id = wms_warehouses.id and r.client_id is not null and r.client_id = public.my_client_id()
  ));
drop policy if exists "portal used locations" on public.wms_locations;
create policy "portal used locations" on public.wms_locations for select to authenticated
  using (exists (
    select 1 from public.wms_receipts r
    where r.warehouse_id = wms_locations.warehouse_id and r.client_id is not null and r.client_id = public.my_client_id()
  ));

-- ---------- Sea consolidations: LCL groupage + FCL consolidation ----------
-- wms_consols.mode: 'air' (MAWB / HAWB / manifest), 'lcl' (LCL groupage —
-- several houses in a shared container) or 'fcl' (FCL consolidation — several
-- customers' goods stuffed into the container(s) ExPac books). Sea prints
-- House Bills of Lading, a cargo manifest and a load plan.
alter table public.wms_consols drop constraint if exists wms_consols_mode_check;
update public.wms_consols set mode = 'lcl' where mode = 'sea';
alter table public.wms_consols add constraint wms_consols_mode_check check (mode in ('air', 'lcl', 'fcl'));

alter table public.wms_consols
  add column if not exists vessel text,
  add column if not exists voyage_no text,
  add column if not exists place_of_receipt text,
  add column if not exists port_of_loading text,
  add column if not exists port_of_discharge text,
  add column if not exists place_of_delivery text,
  add column if not exists etd date,
  add column if not exists eta date,
  add column if not exists co_loader text,
  add column if not exists containers jsonb not null default '[]'::jsonb; -- [{container_no, type, seal_no}]

alter table public.wms_consol_houses
  add column if not exists marks text,
  add column if not exists package_type text,
  add column if not exists container_no text;

-- Release a consolidation (any mode): everything still on hand on its houses' receipts.
create or replace function public.wms_release_consol(p_consol uuid)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  c public.wms_consols%rowtype;
  lines jsonb;
  rid uuid;
  master_label text;
begin
  if not public.can_use_wms() then
    raise exception 'No warehouse access';
  end if;
  select * into c from public.wms_consols where id = p_consol;
  if not found then
    raise exception 'Consolidation not found';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'receipt_id', s.receipt_id, 'location_id', s.location_id, 'pieces', s.on_hand)), '[]'::jsonb)
    into lines
  from (
    select m.receipt_id, m.location_id, sum(m.qty)::int as on_hand
    from public.wms_stock_moves m
    where m.receipt_id in (
      select unnest(h.receipt_ids) from public.wms_consol_houses h where h.consol_id = p_consol
    )
    group by m.receipt_id, m.location_id
    having sum(m.qty) > 0
  ) s;
  if jsonb_array_length(lines) = 0 then
    raise exception 'None of this consolidation''s receipts have stock on hand.';
  end if;
  master_label := case c.mode when 'air' then 'MAWB' else 'MBL' end;
  rid := public.wms_create_release(jsonb_build_object(
    'warehouse_id', c.warehouse_id, 'job_id', c.job_id, 'consol_id', c.id,
    'outbound_ref', coalesce(c.master_no, (c.containers -> 0 ->> 'container_no')),
    'notes', case c.mode when 'air' then 'Air consolidation ' when 'lcl' then 'LCL groupage ' else 'FCL consolidation ' end
      || c.consol_no || coalesce(' — ' || master_label || ' ' || c.master_no, '')
  ), lines);
  update public.wms_consols set status = 'departed' where id = p_consol;
  return rid;
end;
$$;
grant execute on function public.wms_release_consol(uuid) to authenticated;
