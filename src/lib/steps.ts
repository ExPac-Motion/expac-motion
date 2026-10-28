// Shipment timeline steps per mode and their customer-facing names (0196).
// Plain functions, no Supabase or React, so templates can use them too.

/** The steps for a mode, in order: same lists as job_timeline_template (0196). */
export function timelineSteps(mode: string | null | undefined): string[] {
  const m = mode ?? "";
  if (m.startsWith("Sea Freight (FCL)"))
    return ["Created", "Booked", "Vessel Booked", "Collected", "Loaded", "Departed", "In Transit", "Arrived", "Unloaded", "Customs", "Detained", "Released", "On-Delivery", "Delivered"];
  if (m.startsWith("Sea"))
    return ["Created", "Booked", "Vessel Booked", "Collected", "Received", "Loaded", "Departed", "In Transit", "Arrived", "Unloaded", "Customs", "Detained", "Released", "On-Delivery", "Delivered"];
  if (m.startsWith("Road"))
    return ["Created", "Booked", "Collected", "Departed", "In Transit", "Arrived", "Customs", "Detained", "Released", "On-Delivery", "Delivered"];
  return ["Created", "Booked", "Flight Booked", "Collected", "Received", "Departed", "In Transit", "Arrived", "Customs", "Detained", "Released", "On-Delivery", "Delivered"];
}

/** A step's name for this mode (the stored value stays the status). */
export function stepLabel(step: string, mode: string | null | undefined): string {
  const m = mode ?? "";
  const sea = m.startsWith("Sea");
  const road = m.startsWith("Road");
  switch (step) {
    case "Received":
      return sea ? "Received at CFS" : m.startsWith("Courier") ? "Received at hub" : "Received at airline";
    case "Loaded":
      return sea ? "Loaded on vessel" : "Loaded";
    case "Departed":
      return sea ? "Vessel departed" : road ? "Truck departed" : "Flight departed";
    case "Arrived":
      return road ? "Arrived at border" : sea ? "Arrived at port" : "Arrived at airport";
    case "Unloaded":
      return "Discharged";
    case "Customs":
      return "Customs clearance";
    case "Released":
      return "Released by customs";
    case "On-Delivery":
      return "Out for delivery";
    default:
      return step;
  }
}

/** Every step of every mode, in timeline order (filters across modes). */
export const ALL_STEPS = [
  "Created", "Booked", "Vessel Booked", "Flight Booked", "Collected", "Received", "Loaded", "Departed", "In Transit", "Arrived",
  "Unloaded", "Customs", "Detained", "Released", "On-Delivery", "Delivered",
];

/** A step's name when the mode isn't known (e.g. the All Shipments filter). */
export function stepLabelAny(step: string): string {
  switch (step) {
    case "Unloaded":
      return "Discharged";
    case "Customs":
      return "Customs clearance";
    case "Released":
      return "Released by customs";
    case "On-Delivery":
      return "Out for delivery";
    default:
      return step;
  }
}

/** A Shipment Status for display: the step's friendly name for this mode,
 *  any other value as it is. */
export function statusLabel(status: string | null | undefined, mode: string | null | undefined): string {
  return status ? stepLabel(status, mode) : "";
}
