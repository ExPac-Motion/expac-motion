import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as db from "./db";
import type {
  Client,
  Contact,
  JobPatch,
  Milestone,
  QuoteDraft,
  Supplier,
} from "./types";

/* ---------- Clients ---------- */
export function useClients() {
  return useQuery({ queryKey: ["clients"], queryFn: db.listClients });
}
export function useSaveClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id?: string;
      values: Omit<Client, "id" | "created_at">;
    }) =>
      input.id
        ? db.updateClient(input.id, input.values)
        : db.createClient(input.values),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clients"] }),
  });
}
export function useDeleteClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: db.deleteClient,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["quotes"] });
    },
  });
}

/* ---------- Suppliers ---------- */
export function useSuppliers() {
  return useQuery({ queryKey: ["suppliers"], queryFn: db.listSuppliers });
}
export function useSaveSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id?: string;
      values: Omit<Supplier, "id" | "created_at">;
    }) =>
      input.id
        ? db.updateSupplier(input.id, input.values)
        : db.createSupplier(input.values),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suppliers"] }),
  });
}
export function useDeleteSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: db.deleteSupplier,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      qc.invalidateQueries({ queryKey: ["quotes"] });
    },
  });
}

/* ---------- Agents ---------- */
export function useAgents() {
  return useQuery({ queryKey: ["agents"], queryFn: db.listAgents });
}
export function useSaveAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id?: string;
      values: Omit<Contact, "id" | "created_at">;
    }) =>
      input.id
        ? db.updateAgent(input.id, input.values)
        : db.createAgent(input.values),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}
export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: db.deleteAgent,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

/* ---------- Transporters ---------- */
export function useTransporters() {
  return useQuery({
    queryKey: ["transporters"],
    queryFn: db.listTransporters,
  });
}
export function useSaveTransporter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id?: string;
      values: Omit<Contact, "id" | "created_at">;
    }) =>
      input.id
        ? db.updateTransporter(input.id, input.values)
        : db.createTransporter(input.values),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["transporters"] }),
  });
}
export function useDeleteTransporter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: db.deleteTransporter,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["transporters"] }),
  });
}

/* ---------- Clearing agents ---------- */
export function useClearingAgents() {
  return useQuery({
    queryKey: ["clearing_agents"],
    queryFn: db.listClearingAgents,
  });
}
export function useSaveClearingAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id?: string;
      values: Omit<Contact, "id" | "created_at">;
    }) =>
      input.id
        ? db.updateClearingAgent(input.id, input.values)
        : db.createClearingAgent(input.values),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clearing_agents"] }),
  });
}
export function useDeleteClearingAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: db.deleteClearingAgent,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clearing_agents"] }),
  });
}

/* ---------- Quotes ---------- */
export function useQuotes() {
  return useQuery({ queryKey: ["quotes"], queryFn: db.listQuotes });
}
export function useQuote(id: string | undefined) {
  return useQuery({
    queryKey: ["quotes", id],
    queryFn: () => db.getQuote(id as string),
    enabled: Boolean(id),
  });
}
export function useSaveQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: QuoteDraft) => db.saveQuote(draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quotes"] }),
  });
}
export function useDeleteQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: db.deleteQuote,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}
export function useAcceptQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: db.acceptQuote,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

/* ---------- Jobs ---------- */
export function useJobs() {
  return useQuery({ queryKey: ["jobs"], queryFn: db.listJobs });
}
export function useUpdateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; patch: JobPatch }) =>
      db.updateJob(input.id, input.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}
export function useSetJobMilestone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { jobId: string; milestone: Milestone; note?: string }) =>
      db.setJobMilestone(input.jobId, input.milestone, input.note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}
