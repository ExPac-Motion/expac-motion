-- 0220: Motion WMS hubs. A warehouse is split into commodity hubs
-- (e.g. General Cargo Hub), each hub into zones (e.g. DDP Zone), each
-- zone into bays / areas: China Warehouse > General Cargo Hub > DDP Zone > B03.
-- Like zones, a hub is a name on its bays (edited in Settings > Motion WMS).
alter table public.wms_locations add column if not exists hub text;
