// Import Pre-Alert (Document Vault): what goes to the clearing agent about a
// shipment in transit to them, and their clearing instruction. Rendered by
// ShipmentDocPrintPage after Shipment Information + Packing List, in the
// same letterhead / green-bar style as every other document.

import { formatDate, portCode } from "../../lib/format";
import { LOCODES } from "../../lib/locodes";
import type { Department, Job } from "../../lib/types";

const DEPARTMENT_LABEL: Record<Department, string> = {
  management: "Management",
  support: "Support",
  sales: "Sales",
  accounts: "Accounts",
  bdr: "BDR Division",
};

export interface PreAlertData {
  job: Job;
  importer?: { vat_no?: string | null; import_code?: string | null } | null;
  clearingAgent?: string | null;
  packages: number;
  massKg: number;
  signatory?: { full_name: string | null; department?: Department | null } | null;
}

/** "ZADUR" -> "Durban": the customs office is the port of discharge's place. */
function officeOf(destination: string | null | undefined): string {
  const code = portCode(destination);
  if (!code || code === "—") return "—";
  const name = LOCODES.find((l) => l.code === code)?.city;
  return name ? `${name} (${code})` : code;
}

function n2(v: number): string {
  return v.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PreAlertDetails({ job, importer, packages, massKg }: PreAlertData) {
  const rows: [string, string][] = [
    ["Importer Customs Code", importer?.import_code?.trim() || "—"],
    ["Importer VAT No", importer?.vat_no?.trim() || "—"],
    ["Rebate Registration Ref", "—"],
    ["Destination Code", portCode(job.destination) || "—"],
    ["Number of Packages", packages ? String(packages) : "—"],
    ["Mass (Kg)", massKg ? n2(massKg) : "—"],
    ["Master Manifest Date", "—"],
    ["Customs Office of Clearance", officeOf(job.destination)],
  ];
  return (
    <>
      <div className="qs-bar">Clearing Details</div>
      <div className="qs-info" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        {rows.map(([k, v]) => (
          <div key={k}>
            <div className="k">{k}</div>
            <div className="v">{v}</div>
          </div>
        ))}
      </div>
    </>
  );
}

export function PreAlertInstructions({ job, clearingAgent, signatory }: PreAlertData) {
  const name = (signatory?.full_name ?? "").trim();
  const [first, ...rest] = name.split(/\s+/);
  const surname = rest.join(" ");
  const capacity = signatory?.department ? DEPARTMENT_LABEL[signatory.department] : "";
  const today = formatDate(new Date().toISOString());

  return (
    <>
      <div className="qs-bar">Import Pre-Alert Instruction</div>
      <p className="pa-declare">
        I, <b>{name || "______________________"}</b>, request Clearing Agent{" "}
        <b>{clearingAgent || "______________________"}</b> to clear and deliver these goods (shipment{" "}
        <b>{job.reference}</b>) under the abovementioned conditions. I further declare that no other clearing
        instruction has been given to any other person or clearing agent to effect clearance on my behalf. The
        signature below certifies that the signatory is an employee duly authorised to issue this clearing
        instruction on behalf of the importer / exporter.
      </p>
      <div className="qs-sig">
        <div className="qs-sig-field">
          <label>First Name</label>
          <div className="pa-sigv">{first || ""}</div>
          <div className="line" />
        </div>
        <div className="qs-sig-field">
          <label>Date</label>
          <div className="pa-sigv">{today}</div>
          <div className="line" />
        </div>
        <div className="qs-sig-field">
          <label>Surname</label>
          <div className="pa-sigv">{surname}</div>
          <div className="line" />
        </div>
        <div className="qs-sig-field">
          <label>Signature</label>
          <div className="pa-sigv" />
          <div className="line" />
        </div>
        <div className="qs-sig-field">
          <label>Capacity</label>
          <div className="pa-sigv">{capacity}</div>
          <div className="line" />
        </div>
      </div>
    </>
  );
}
