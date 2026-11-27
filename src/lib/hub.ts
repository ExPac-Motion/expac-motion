/**
 * Information Hub (0252): guides, manuals and marketing content on the
 * customer and partner portals. RLS returns only what the login may see;
 * staff manage the items in CRM › Media › Information Hub.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type HubAudience = "partners" | "customers" | "both";
export type HubKind = "file" | "image" | "link";

export interface HubItem {
  id: string;
  title: string;
  description: string | null;
  tag: string;
  kind: HubKind;
  file_url: string;
  cover_url: string | null;
  meta: string | null;
  audience: HubAudience;
  published: boolean;
  sort: number;
  created_at: string;
}

export const HUB_TAGS = ["How-to guide", "Manual", "Presentation", "Marketing", "Brochure", "Announcement"];
export const AUDIENCE_LABEL: Record<HubAudience, string> = {
  partners: "Partners",
  customers: "Customers",
  both: "Customers & partners",
};

const BUCKET = "hub";

function fail(error: unknown): never {
  const e = error as { message?: string };
  throw new Error(e?.message || "Something went wrong");
}

async function listHub(): Promise<HubItem[]> {
  const { data, error } = await supabase
    .from("hub_items")
    .select("*")
    .order("sort", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) fail(error);
  return (data ?? []) as HubItem[];
}

/** What this login may see (RLS decides: customers, partners or staff = all). */
export function useHubItems() {
  return useQuery({ queryKey: ["hub_items"], queryFn: listHub, retry: false });
}

/** Uploads a file to the public hub bucket and returns its URL. */
export async function uploadHubFile(file: File): Promise<string> {
  const safe = file.name.replace(/[^\w.() -]+/g, "_");
  const path = `${Date.now()}-${safe}`;
  const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
  if (up.error) fail(up.error);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export type HubDraft = Omit<HubItem, "id" | "created_at">;

export function useSaveHubItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: Partial<HubDraft> }) => {
      const q = id ? supabase.from("hub_items").update(values).eq("id", id) : supabase.from("hub_items").insert(values);
      const { error } = await q;
      if (error) fail(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hub_items"] }),
  });
}

export function useDeleteHubItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("hub_items").delete().eq("id", id);
      if (error) fail(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hub_items"] }),
  });
}
