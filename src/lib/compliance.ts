/**
 * Partner Compliance & Document Vault (0255): the NDA, Agency Agreement,
 * Terms & Conditions and Credit Application partners accept in the portal
 * by click-to-accept. Staff edit and publish versions in Settings ›
 * Compliance; each publish asks every partner to accept again.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { PartnerKind } from "./types";

export type ComplianceKind = "nda" | "agency_agreement" | "terms" | "credit_application";

export const COMPLIANCE_KINDS: ComplianceKind[] = ["nda", "agency_agreement", "terms", "credit_application"];

export const COMPLIANCE_LABEL: Record<ComplianceKind, string> = {
  nda: "Non-Disclosure Agreement",
  agency_agreement: "Agency Agreement",
  terms: "Terms & Conditions",
  credit_application: "Credit Application",
};

export const ALL_PARTNER_KINDS: PartnerKind[] = ["agent", "transporter", "clearing_agent", "destination_agent"];

export interface ComplianceDocument {
  id: string;
  kind: ComplianceKind;
  version: number;
  title: string;
  summary: string | null;
  body: string;
  required_for: PartnerKind[];
  blocks_portal: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export type CreditStatus = "n/a" | "pending" | "approved" | "declined";

export interface MyAcceptance {
  id: string;
  document_id: string;
  version: number;
  /** Accepted the version that is current now. */
  current: boolean;
  signer_name: string;
  signer_title: string | null;
  signature: string;
  accepted_at: string;
  form_data: Record<string, string>;
  review_status: CreditStatus;
  credit_limit: number | null;
  credit_currency: string | null;
  payment_terms: string | null;
  review_note: string | null;
  reviewed_at: string | null;
}

export interface PartnerComplianceDoc {
  id: string;
  kind: ComplianceKind;
  version: number;
  title: string;
  summary: string | null;
  body: string;
  blocks_portal: boolean;
  published_at: string;
  acceptance: MyAcceptance | null;
}

export interface PartnerCompliance {
  /** Every document that blocks the portal is accepted. */
  ok: boolean;
  documents: PartnerComplianceDoc[];
}

/** Still to sign: never accepted, or a newer version was published. */
export const needsSigning = (d: PartnerComplianceDoc) => !d.acceptance?.current;

/** The credit application's fields (stored as form_data). */
export const CREDIT_FIELDS: { key: string; label: string; group: string; required?: boolean; wide?: boolean }[] = [
  { key: "registered_name", label: "Registered company name", group: "Company", required: true, wide: true },
  { key: "registration_no", label: "Company registration no.", group: "Company", required: true },
  { key: "vat_no", label: "VAT / tax no.", group: "Company" },
  { key: "years_trading", label: "Years trading", group: "Company" },
  { key: "physical_address", label: "Physical address", group: "Company", required: true, wide: true },
  { key: "accounts_contact", label: "Accounts contact name", group: "Accounts", required: true },
  { key: "accounts_email", label: "Accounts email", group: "Accounts", required: true },
  { key: "accounts_phone", label: "Accounts phone", group: "Accounts" },
  { key: "credit_amount", label: "Credit limit requested", group: "Credit", required: true },
  { key: "credit_currency", label: "Currency", group: "Credit", required: true },
  { key: "monthly_volume", label: "Expected monthly spend", group: "Credit" },
  { key: "bank_name", label: "Bank", group: "Bank", required: true },
  { key: "bank_branch", label: "Branch / SWIFT", group: "Bank" },
  { key: "bank_account_holder", label: "Account holder", group: "Bank" },
  { key: "bank_account_no", label: "Account number", group: "Bank" },
  { key: "ref1_company", label: "Trade reference 1: company", group: "Trade references", required: true },
  { key: "ref1_contact", label: "Contact & phone / email", group: "Trade references", required: true },
  { key: "ref2_company", label: "Trade reference 2: company", group: "Trade references" },
  { key: "ref2_contact", label: "Contact & phone / email", group: "Trade references" },
];

function fail(error: unknown): never {
  const e = error as { message?: string };
  throw new Error(e?.message || "Something went wrong");
}

/* ---------------- Partner ---------------- */

export function usePartnerCompliance(enabled = true) {
  return useQuery({
    queryKey: ["partner_compliance"],
    enabled,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("partner_compliance");
      if (error) fail(error);
      return data as PartnerCompliance;
    },
  });
}

export function useAcceptCompliance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { documentId: string; name: string; title: string; signature: string; form?: Record<string, string> }) => {
      const { error } = await supabase.rpc("partner_accept_compliance", {
        p_document: v.documentId,
        p_name: v.name,
        p_title: v.title,
        p_signature: v.signature,
        p_form: v.form ?? {},
      });
      if (error) fail(error);
    },
    onSuccess: () => {
      // The NDA unlocks shipments: refresh everything the portal shows.
      qc.invalidateQueries();
    },
  });
}

/* ---------------- Staff ---------------- */

export function useComplianceDocuments() {
  return useQuery({
    queryKey: ["compliance_documents"],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compliance_documents")
        .select("*")
        .order("kind")
        .order("version", { ascending: false });
      if (error) fail(error);
      return (data ?? []) as ComplianceDocument[];
    },
  });
}

export function useSaveComplianceDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      v: Partial<ComplianceDocument> & { id?: string; kind: ComplianceKind; version: number; title: string },
    ) => {
      const row = {
        kind: v.kind,
        version: v.version,
        title: v.title,
        summary: v.summary ?? null,
        body: v.body ?? "",
        required_for: v.required_for ?? ALL_PARTNER_KINDS,
        blocks_portal: v.blocks_portal ?? false,
        ...(v.published_at !== undefined ? { published_at: v.published_at } : {}),
      };
      const { error } = v.id
        ? await supabase.from("compliance_documents").update(row).eq("id", v.id)
        : await supabase.from("compliance_documents").insert(row);
      if (error) fail(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["compliance_documents"] }),
  });
}

export function usePublishComplianceDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("compliance_documents")
        .update({ published_at: new Date().toISOString() })
        .eq("id", id);
      if (error) fail(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["compliance_documents"] }),
  });
}

export function useDeleteComplianceDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("compliance_documents").delete().eq("id", id).is("published_at", null);
      if (error) fail(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["compliance_documents"] }),
  });
}

export interface StaffAcceptance {
  id: string;
  document_id: string;
  kind: ComplianceKind;
  version: number;
  title: string;
  signer_name: string;
  signer_title: string | null;
  signature: string;
  ip: string | null;
  user_agent: string | null;
  accepted_at: string;
  accepted_by_email: string | null;
  form_data: Record<string, string>;
  review_status: CreditStatus;
  credit_limit: number | null;
  credit_currency: string | null;
  payment_terms: string | null;
  review_note: string | null;
  reviewed_at: string | null;
}

export interface StaffPartnerCompliance {
  current: { id: string; kind: ComplianceKind; version: number; title: string; blocks_portal: boolean; accepted: boolean }[];
  acceptances: StaffAcceptance[];
}

export function useStaffPartnerCompliance(kind: PartnerKind, partnerId: string) {
  return useQuery({
    queryKey: ["staff_partner_compliance", kind, partnerId],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("staff_partner_compliance", { p_kind: kind, p_partner: partnerId });
      if (error) fail(error);
      return data as StaffPartnerCompliance;
    },
  });
}

export function useCreditDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; approve: boolean; limit?: number; currency?: string; terms?: string; note?: string }) => {
      const { error } = await supabase.rpc("staff_credit_decision", {
        p_id: v.id,
        p_approve: v.approve,
        p_limit: v.limit ?? null,
        p_currency: v.currency ?? null,
        p_terms: v.terms ?? null,
        p_note: v.note ?? null,
      });
      if (error) fail(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff_partner_compliance"] }),
  });
}

/* ---------------- Signed copy ---------------- */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/** The document body as HTML: "## " lines are headings, blank lines split paragraphs. */
export function legalHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((block) => {
      const t = block.trim();
      if (!t) return "";
      if (t.startsWith("## ")) return `<h2>${esc(t.slice(3))}</h2>`;
      return `<p>${esc(t).replace(/\n/g, "<br/>")}</p>`;
    })
    .join("");
}

/** Opens a printable signed copy (the partner saves it as PDF from the print dialog). */
export function printSignedCopy(
  doc: { title: string; version: number; body: string },
  a: { signer_name: string; signer_title: string | null; signature: string; accepted_at: string; form_data?: Record<string, string> },
  company: string,
) {
  const w = window.open("", "_blank");
  if (!w) return;
  const form = a.form_data && Object.keys(a.form_data).length
    ? `<h2>Application details</h2><table>${CREDIT_FIELDS.filter((f) => a.form_data?.[f.key])
        .map((f) => `<tr><th>${esc(f.label)}</th><td>${esc(a.form_data?.[f.key] ?? "")}</td></tr>`)
        .join("")}</table>`
    : "";
  w.document.write(`<!doctype html><html><head><title>${esc(doc.title)} - ${esc(company)}</title>
<style>body{font:14px/1.55 system-ui,sans-serif;color:#1d2433;max-width:760px;margin:32px auto;padding:0 24px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:20px 0 6px}.meta{color:#667;margin-bottom:20px}
.sig{margin-top:32px;border:1px solid #ccd;border-radius:8px;padding:16px}.sig b{display:inline-block;min-width:140px}
.sig .s{font:italic 22px Georgia,serif}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:4px 8px;border-bottom:1px solid #eee}
img{height:40px}</style></head><body>
<img src="${location.origin}/ExPac-Final_Maybe-300x106.png" alt="ExPac"/>
<h1>${esc(doc.title)}</h1><div class="meta">Version ${doc.version}</div>
${legalHtml(doc.body)}${form}
<div class="sig"><div><b>Company</b>${esc(company)}</div><div><b>Accepted by</b>${esc(a.signer_name)}${a.signer_title ? ", " + esc(a.signer_title) : ""}</div>
<div><b>Date</b>${esc(new Date(a.accepted_at).toLocaleString())}</div><div><b>Signature</b><span class="s">${esc(a.signature)}</span></div>
<div style="color:#667;margin-top:8px">Accepted electronically in the ExPac Partner Portal.</div></div>
<script>window.onload=function(){window.print()}</script></body></html>`);
  w.document.close();
}
