-- ============================================================
-- 0066  Remap existing Shipment Status values to the new universal list
-- ============================================================
-- The app's Shipment Status dropdown (jobs.shipment_status, free text --
-- see 0007) is switching from a per-mode-ish list to one universal set
-- used across sea/air/road: Created, Booked, Collected, Received, Loaded,
-- Departed, In Transit, Arrived, Unloaded, Customs, Detained, Released,
-- On-Delivery, Delivered.
--
-- Existing jobs still hold the old free-text values, which would show up
-- as an unrecognised/blank option in the new dropdown. Remap them onto
-- their closest new-list equivalent. Anything already matching the new
-- list (Booked, Collected, Departed, In Transit, Delivered) is untouched.
--
-- Run in the Supabase SQL editor after 0065. Self-contained & idempotent.

update public.jobs
set shipment_status = case shipment_status
  when 'Loaded for Flight'      then 'Loaded'
  when 'Vessel Booked'          then 'Booked'
  when 'Vessel Arrived'         then 'Arrived'
  when 'Vessel Working'         then 'Unloaded'
  when 'Container Unlanded'     then 'Unloaded'
  when 'Arrived at Destination' then 'Arrived'
  when 'Customs Cleared'        then 'Released'
  when 'Customs Detained'       then 'Detained'
  when 'Collected from Port'    then 'On-Delivery'
  when 'Out on Delivery'        then 'On-Delivery'
  else shipment_status
end
where shipment_status in (
  'Loaded for Flight', 'Vessel Booked', 'Vessel Arrived', 'Vessel Working',
  'Container Unlanded', 'Arrived at Destination', 'Customs Cleared',
  'Customs Detained', 'Collected from Port', 'Out on Delivery'
);
