import { useState } from "react";
import { Link } from "react-router-dom";

export interface Tip {
  text: string;
  /** Where "Show me" goes. */
  to?: string;
}

/** What the portal offers, one a day (pending items for the customer come first). */
const FEATURE_TIPS: Tip[] = [
  { text: "Request a quote in under a minute with Request Quote. Add your packing list for the most accurate price.", to: "/portal/quotes/new" },
  { text: "Not quite right? Open a quotation and click Request a revision, ask for a better price, another route or different dates.", to: "/portal/quotes" },
  { text: "Open any quotation and click Quotation document for the full PDF, ready to print or save.", to: "/portal/quotes" },
  { text: "Follow every shipment on Shipments: status, vessel or flight, ETD, ETA and PDD, all in one board.", to: "/portal/shipments" },
  { text: "Message the ExPac team on a shipment with the chat icon on Shipments, the whole conversation stays with the shipment.", to: "/portal/shipments" },
  { text: "Need something done on a shipment? Use the task icon on Shipments and the ExPac team picks it up straight away.", to: "/portal/shipments" },
  { text: "Sending goods to our warehouse? Pre-advise them so we're ready to receive, and follow them from receipt to shipment.", to: "/portal/warehouse?view=preadvice" },
  { text: "Need goods out of the warehouse? Request a release for collection or delivery, with the date you need it.", to: "/portal/warehouse?view=requests" },
  { text: "Ship from stock: tick goods on the Warehouse Overview and request a quote to ship them, the cargo is filled in for you.", to: "/portal/warehouse" },
  { text: "Labelling, repacking, palletising or photos? Request a warehouse service on the goods you choose.", to: "/portal/warehouse?view=services" },
  { text: "See what your goods cost in storage so far this month on the Warehouse Overview, and every statement under Storage statements.", to: "/portal/warehouse?view=statements" },
  { text: "Keep private notes or share tasks with ExPac on Tasks & Notes, linked to a shipment or quotation.", to: "/portal/tasks" },
  { text: "Download your shipments, quotations, warehouse receipts and deliveries as CSV from Reports.", to: "/portal/reports" },
  { text: "Every delivered shipment has its signed proof of delivery, download it from Shipments.", to: "/portal/shipments" },
  { text: "Check our rates any time with Search Rates on your Tariff Sheet.", to: "/portal/rates" },
  { text: "Keep your company details up to date, and change your password: click your company name at the top right." },
  { text: "Search for any shipment by its number, AWB, B/L or container number with the search bar at the top." },
  { text: "Want more room? Unpin the sidebar with the pin next to the logo, it opens when you point at it." },
];

function dayIndex(): number {
  const d = new Date();
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/** Dashboard › Tip of the Day: a new tip each day; the arrow shows the next one. */
export default function PortalTip({ pending }: { pending: Tip[] }) {
  // Pending items lead the list, so the day's tip is often "what's waiting for you".
  const tips = [...pending, ...FEATURE_TIPS];
  const [offset, setOffset] = useState(0);
  const start = dayIndex() % (pending.length > 0 ? pending.length : tips.length);
  const tip = tips[(start + offset) % tips.length];
  const isPending = (start + offset) % tips.length < pending.length;
  return (
    <div className={`pt-tip${isPending ? " pending" : ""}`}>
      <div className="pt-tip-head">
        <span aria-hidden>{isPending ? "🔔" : "🎓"}</span>
        <b>{isPending ? "Waiting for you" : "Tip of the Day"}</b>
        <button type="button" className="pt-tip-next" onClick={() => setOffset((o) => o + 1)} title="Next tip" aria-label="Next tip">
          ›
        </button>
      </div>
      <p>
        {tip.text}
        {tip.to && (
          <>
            {" "}
            <Link to={tip.to}>Show me</Link>
          </>
        )}
      </p>
    </div>
  );
}
