-- 0146: house style, no em dashes in text the app shows (user SOP,
-- 2026-10-06). Same functions as before, only the wording changes:
-- error messages and release notes use a comma instead.

create or replace function public.wms_receipt_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and (new.pieces is distinct from old.pieces or new.location_id is distinct from old.location_id)
     and exists (select 1 from public.wms_stock_moves where receipt_id = new.id and kind <> 'receipt') then
    raise exception 'Stock on % has already moved or been released, pieces and bay can''t change now (use a movement or cycle count).', new.receipt_no;
  end if;
  delete from public.wms_stock_moves where receipt_id = new.id and kind = 'receipt';
  if new.pieces > 0 then
    insert into public.wms_stock_moves (receipt_id, location_id, qty, kind, ref_id, at)
    values (new.id, new.location_id, new.pieces, 'receipt', new.id, new.received_at);
  end if;
  return new;
end;
$$;

create or replace function public.wms_movement_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  avail int;
begin
  if tg_op = 'DELETE' then
    -- Undoing a move: the pieces must still be in the bay they went to.
    -- (Skipped when the whole receipt is being deleted.)
    if exists (select 1 from public.wms_receipts where id = old.receipt_id)
       and public.wms_on_hand(old.receipt_id, old.to_location_id) < old.pieces then
      raise exception 'Those pieces have moved on or left since, undo the later movement / release first.';
    end if;
    delete from public.wms_stock_moves where ref_id = old.id and kind = 'move';
    return old;
  end if;
  if new.from_location_id is not distinct from new.to_location_id then
    raise exception 'Pick a different bay to move to.';
  end if;
  avail := public.wms_on_hand(new.receipt_id, new.from_location_id);
  if new.pieces > avail then
    raise exception 'Only % piece(s) of this receipt are in that bay.', avail;
  end if;
  insert into public.wms_stock_moves (receipt_id, location_id, qty, kind, ref_id, at) values
    (new.receipt_id, new.from_location_id, -new.pieces, 'move', new.id, new.moved_at),
    (new.receipt_id, new.to_location_id, new.pieces, 'move', new.id, new.moved_at);
  return new;
end;
$$;

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
      || c.consol_no || coalesce(', ' || master_label || ' ' || c.master_no, '')
  ), lines);
  update public.wms_consols set status = 'departed' where id = p_consol;
  return rid;
end;
$$;

create or replace function public.portal_quote_decision(p_quote uuid, p_accept boolean, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  q public.quotes%rowtype;
begin
  select * into q from public.quotes where id = p_quote;
  if not found or q.client_id is null or q.client_id is distinct from public.my_client_id() then
    raise exception 'Quotation not found';
  end if;
  if q.status <> 'sent' then
    raise exception 'This quotation can''t be % now', case when p_accept then 'accepted' else 'declined' end;
  end if;
  if q.valid_until is not null and q.valid_until < current_date and p_accept then
    raise exception 'This quotation expired on %, ask ExPac for an updated one', to_char(q.valid_until, 'DD/MM/YYYY');
  end if;
  update public.quotes set
    portal_decision = case when p_accept then 'accepted' else 'declined' end,
    portal_decided_at = now(),
    portal_decline_reason = case when p_accept then null else nullif(p_reason, '') end,
    -- Accepted = won: the trg_quote_won trigger creates the shipment.
    status = case when p_accept then 'accepted' else 'lost' end
  where id = p_quote;
end;
$$;
