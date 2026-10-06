-- 0147: full warehouse journey in the Customer Portal. For every one of the
-- customer's warehouse receipts: where it is (warehouse, zone / bay) and its
-- stage: Received -> Checked -> Being prepared for shipping (on a
-- consolidation that hasn't left) -> Shipped (released, with the shipment
-- number it moved on).

-- "Checked" step on a receipt (WMS > Warehouse Receipt > Mark as checked).
alter table public.wms_receipts
  add column if not exists checked_at timestamptz,
  add column if not exists checked_by uuid references public.profiles (id) on delete set null;

-- wms_receipts_v selects r.*, which Postgres expands when the view is made:
-- re-create it so checked_at / checked_by come through.
drop view if exists public.wms_receipts_v;
create view public.wms_receipts_v with (security_invoker = true) as
select r.*,
  coalesce(s.on_hand, 0) as on_hand,
  case when r.pieces > 0 then round(r.gross_kg * coalesce(s.on_hand, 0) / r.pieces, 2) else 0 end as on_hand_kg,
  case when r.pieces > 0 then round(r.volume_cbm * coalesce(s.on_hand, 0) / r.pieces, 3) else 0 end as on_hand_cbm,
  s.last_out_at,
  case
    when r.pieces = 0 then 'in_store'
    when coalesce(s.on_hand, 0) <= 0 then 'released'
    when coalesce(s.on_hand, 0) < r.pieces then 'part_released'
    else 'in_store'
  end as status
from public.wms_receipts r
left join lateral (
  select sum(m.qty)::int as on_hand,
         max(m.at) filter (where m.kind = 'release') as last_out_at
  from public.wms_stock_moves m where m.receipt_id = r.id
) s on true;
grant select on public.wms_receipts_v to authenticated;

-- One row per receipt of the calling customer, with the consolidation it is
-- on (if any), the latest release and the shipment numbers involved.
create or replace view public.client_wms_tracker
with (security_barrier = true) as
select
  r.id as receipt_id,
  r.checked_at,
  c.consol_no,
  c.mode as consol_mode,
  c.status as consol_status,
  c.master_no,
  h.house_no,
  coalesce(c.flight_no, nullif(concat_ws(' / ', c.vessel, c.voyage_no), '')) as transport,
  coalesce(c.etd, c.flight_date) as etd,
  c.eta,
  coalesce(hj.reference, cj.reference, rlj.reference, rj.reference) as shipment_ref,
  coalesce(hj.id, cj.id, rlj.id, rj.id) as shipment_id,
  rl.release_no,
  rl.released_at,
  rl.outbound_ref
from public.wms_receipts r
left join lateral (
  select hh.* from public.wms_consol_houses hh
  join public.wms_consols cc on cc.id = hh.consol_id
  where r.id = any (hh.receipt_ids)
  order by cc.created_at desc
  limit 1
) h on true
left join public.wms_consols c on c.id = h.consol_id
left join public.jobs hj on hj.id = h.job_id
left join public.jobs cj on cj.id = c.job_id
left join lateral (
  select rr.* from public.wms_releases rr
  join public.wms_release_lines ll on ll.release_id = rr.id
  where ll.receipt_id = r.id
  order by rr.released_at desc
  limit 1
) rl on true
left join public.jobs rlj on rlj.id = rl.job_id
left join public.jobs rj on rj.id = r.job_id
where r.client_id is not null and r.client_id = public.my_client_id();
grant select on public.client_wms_tracker to authenticated;

-- ---------- Receipt images (photos of the goods received) ----------
-- Files in the private shipment-documents bucket under wms/<receipt id>/;
-- staff manage them, the receipt's customer can view them in the portal.
create table if not exists public.wms_receipt_images (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.wms_receipts (id) on delete cascade,
  storage_path text not null,
  name text,
  size_bytes bigint,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists wms_receipt_images_receipt on public.wms_receipt_images (receipt_id);
alter table public.wms_receipt_images enable row level security;
drop policy if exists "wms users" on public.wms_receipt_images;
create policy "wms users" on public.wms_receipt_images for all to authenticated
  using (public.can_use_wms()) with check (public.can_use_wms());
drop policy if exists "portal own receipt images" on public.wms_receipt_images;
create policy "portal own receipt images" on public.wms_receipt_images for select to authenticated
  using (exists (
    select 1 from public.wms_receipts r
    where r.id = receipt_id and r.client_id is not null and r.client_id = public.my_client_id()
  ));

drop policy if exists "clients view own receipt images" on storage.objects;
create policy "clients view own receipt images" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'shipment-documents'
    and exists (
      select 1 from public.wms_receipt_images i
      join public.wms_receipts r on r.id = i.receipt_id
      where i.storage_path = storage.objects.name
        and r.client_id is not null
        and r.client_id = public.my_client_id()
    )
  );
