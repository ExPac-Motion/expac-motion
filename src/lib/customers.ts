// Customer record (migration 0142): the full customer form behind Customers ›
// <customer>, General, Contacts, Other Details, Bank Detail, Documents,
// Permits, Products & SKUs, Consignees & Shippers, Associated Leads,
// Margins & Charges, plus the customer's own shippers and portal logins.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { Client, Contact } from "./types";

function unwrap<T>({ data, error }: { data: T | null; error: unknown }): T {
  if (error) {
    const message =
      typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : "Request failed";
    throw new Error(message);
  }
  return data as T;
}

/** Every customer-record field beyond the basic contact-book ones. */
export interface CustomerFields {
  client_code?: string | null;
  fax?: string | null;
  customer_segment?: string | null;
  network_group?: string | null;
  is_also_agent?: boolean;
  linked_agent_id?: string | null;
  customer_support_id?: string | null;
  quote_note?: string | null;
  bill_to_name?: string | null;
  parent_client_id?: string | null;
  contact_salutation?: string | null;
  contact_first_name?: string | null;
  contact_last_name?: string | null;
  contact_role?: string | null;
  contact_mobile?: string | null;
  mailing_list?: boolean;
  /** Warehouse stage emails (received / checked / preparing / shipped), 0149. */
  wms_notify?: boolean;
  additional_emails?: string | null;
  registration_no?: string | null;
  industry?: string | null;
  physical_address?: string | null;
  postal_address?: string | null;
  city?: string | null;
  country?: string | null;
  payment_terms?: string | null;
  credit_limit?: number | null;
  billing_currency?: string | null;
  bank_name?: string | null;
  bank_branch?: string | null;
  bank_branch_code?: string | null;
  bank_account_name?: string | null;
  bank_account_no?: string | null;
  bank_account_type?: string | null;
  bank_swift?: string | null;
  margin_override_pct?: number | null;
  charges_note?: string | null;
  rate_tier?: string | null;
  /** Last time the customer edited its details on the portal (0145). */
  portal_updated_at?: string | null;
}
export type CustomerRecord = Client & CustomerFields;

export interface ClientContactRow {
  id: string;
  client_id: string;
  salutation: string | null;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  created_at: string;
}
export interface Consignee {
  id: string;
  client_id: string;
  company: string;
  contact: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
}
export type Shipper = Contact & { client_id?: string | null };
export interface ClientFile {
  id: string;
  client_id: string;
  kind: "document" | "permit";
  name: string;
  doc_type: string | null;
  number: string | null;
  issued_on: string | null;
  expires_on: string | null;
  notes: string | null;
  storage_path: string | null;
  size_bytes: number | null;
  visible_to_client: boolean;
  created_at: string;
}

export const SALUTATIONS = ["Mr", "Mrs", "Ms", "Miss", "Dr", "Prof", "Adv"];
export const CUSTOMER_SEGMENTS = ["Importer", "Exporter", "Importer & Exporter", "Retail / E-commerce", "Manufacturer", "Freight forwarder", "Government / NGO", "Private individual"];
export const NETWORK_GROUPS = ["Direct", "Agent network", "WCA", "Referral", "Partner"];
export const CUSTOMER_ROLES = ["Owner / Director", "Buyer / Procurement", "Logistics", "Finance / Accounts", "Operations", "Other"];
export const DOCUMENT_KINDS = ["Company registration", "VAT certificate", "Customs client code (SARS)", "Credit application", "Trading terms signed", "ID / Passport", "Bank confirmation", "Other"];
export const PERMIT_KINDS = ["Import permit (ITAC)", "Export permit", "SABS / NRCS certificate", "Phytosanitary", "Veterinary", "Dangerous goods", "Letter of authority", "Other"];

const BUCKET = "shipment-documents";

export const customersDb = {
  async get(id: string): Promise<CustomerRecord> {
    return unwrap(await supabase.from("clients").select("*").eq("id", id).single());
  },
  async update(id: string, patch: Partial<CustomerRecord>) {
    unwrap(await supabase.from("clients").update(patch).eq("id", id));
  },
  async create(values: Partial<CustomerRecord>): Promise<string> {
    const row = unwrap(await supabase.from("clients").insert(values).select("id").single()) as { id: string };
    return row.id;
  },
  async contacts(clientId: string): Promise<ClientContactRow[]> {
    return unwrap(await supabase.from("client_contacts").select("*").eq("client_id", clientId).order("created_at"));
  },
  async saveContact(id: string | undefined, v: Partial<ClientContactRow>) {
    if (id) unwrap(await supabase.from("client_contacts").update(v).eq("id", id));
    else unwrap(await supabase.from("client_contacts").insert(v));
  },
  async deleteContact(id: string) {
    unwrap(await supabase.from("client_contacts").delete().eq("id", id));
  },
  async shippers(clientId: string): Promise<Shipper[]> {
    return unwrap(await supabase.from("suppliers").select("*").eq("client_id", clientId).order("company"));
  },
  async saveShipper(id: string | undefined, v: Partial<Shipper>) {
    if (id) unwrap(await supabase.from("suppliers").update(v).eq("id", id));
    else unwrap(await supabase.from("suppliers").insert(v));
  },
  async deleteShipper(id: string) {
    unwrap(await supabase.from("suppliers").delete().eq("id", id));
  },
  async consignees(clientId: string): Promise<Consignee[]> {
    return unwrap(await supabase.from("client_consignees").select("*").eq("client_id", clientId).order("company"));
  },
  async saveConsignee(id: string | undefined, v: Partial<Consignee>) {
    if (id) unwrap(await supabase.from("client_consignees").update(v).eq("id", id));
    else unwrap(await supabase.from("client_consignees").insert(v));
  },
  async deleteConsignee(id: string) {
    unwrap(await supabase.from("client_consignees").delete().eq("id", id));
  },
  async files(clientId: string): Promise<ClientFile[]> {
    return unwrap(await supabase.from("client_files").select("*").eq("client_id", clientId).order("created_at", { ascending: false }));
  },
  async saveFile(id: string | undefined, v: Partial<ClientFile>, file?: File | null) {
    let patch = { ...v };
    if (file) {
      const path = `customers/${v.client_id}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
      unwrap(await supabase.storage.from(BUCKET).upload(path, file, { upsert: false }));
      patch = { ...patch, storage_path: path, size_bytes: file.size, name: v.name || file.name };
    }
    if (id) unwrap(await supabase.from("client_files").update(patch).eq("id", id));
    else unwrap(await supabase.from("client_files").insert(patch));
  },
  async deleteFile(f: ClientFile) {
    if (f.storage_path) await supabase.storage.from(BUCKET).remove([f.storage_path]);
    unwrap(await supabase.from("client_files").delete().eq("id", f.id));
  },
  async fileUrl(path: string): Promise<string> {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
    if (error || !data) throw error ?? new Error("Could not open the file");
    return data.signedUrl;
  },
  /** /api/customer-login (admin): create or reset a contact's portal login. */
  async portalLogin(v: { clientId: string; email: string; fullName?: string; password?: string; greeting?: string }): Promise<{ email: string; password: string; created: boolean }> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const res = await fetch("/api/customer-login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify(v),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; email?: string; password?: string; created?: boolean };
    if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
    return body as { email: string; password: string; created: boolean };
  },
};

export const useCustomer = (id: string | undefined) =>
  useQuery({ queryKey: ["customer", id], queryFn: () => customersDb.get(id as string), enabled: !!id });
export const useCustomerContacts = (id: string | undefined) =>
  useQuery({ queryKey: ["customer", id, "contacts"], queryFn: () => customersDb.contacts(id as string), enabled: !!id });
export const useCustomerShippers = (id: string | undefined) =>
  useQuery({ queryKey: ["customer", id, "shippers"], queryFn: () => customersDb.shippers(id as string), enabled: !!id });
export const useCustomerConsignees = (id: string | undefined) =>
  useQuery({ queryKey: ["customer", id, "consignees"], queryFn: () => customersDb.consignees(id as string), enabled: !!id });
export const useCustomerFiles = (id: string | undefined) =>
  useQuery({ queryKey: ["customer", id, "files"], queryFn: () => customersDb.files(id as string), enabled: !!id });

/** Any customer-record write: refresh the record, its lists, and the customer / shipper books. */
export function useCustomerMutation<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["customer"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      qc.invalidateQueries({ queryKey: ["client_contacts"] });
      qc.invalidateQueries({ queryKey: ["portal_users"] });
    },
  });
}

/** "Mr Gilbert" style name from salutation + surname (portal greeting default). */
export function formalName(c: Pick<CustomerFields, "contact_salutation" | "contact_first_name" | "contact_last_name">): string {
  return [c.contact_salutation, c.contact_last_name || c.contact_first_name].filter(Boolean).join(" ");
}
