import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as db from "./db";
import type {
  Client,
  Contact,
  ImportDutyDraft,
  Job,
  JobPatch,
  Milestone,
  OpsTaskPatch,
  QuoteDraft,
  Supplier,
} from "./types";
import { fetchTracking, trackableRef, trackingRowFrom } from "./tracking";
import { buildShipmentEmail } from "./mailTemplates";
import { sendMail } from "./mail";

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
/** Saving / deleting an agent may add or drop a mirror clearing-agent row. */
function invalidateAgentPair(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["agents"] });
  qc.invalidateQueries({ queryKey: ["clearing_agents"] });
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
    onSuccess: () => invalidateAgentPair(qc),
  });
}
export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: db.deleteAgent,
    onSuccess: () => invalidateAgentPair(qc),
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
    onSuccess: () => invalidateAgentPair(qc),
  });
}
export function useDeleteClearingAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: db.deleteClearingAgent,
    onSuccess: () => invalidateAgentPair(qc),
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

/* ---------- Import VAT / Duty Output ---------- */
export function useImportVatDuty(quoteId: string | undefined) {
  return useQuery({
    queryKey: ["import_vat_duty", quoteId],
    queryFn: () => db.getImportVatDuty(quoteId as string),
    enabled: Boolean(quoteId),
  });
}
export function useSaveImportVatDuty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: ImportDutyDraft) => db.saveImportVatDuty(draft),
    onSuccess: (_id, draft) =>
      qc.invalidateQueries({ queryKey: ["import_vat_duty", draft.quote_id] }),
  });
}
export function useAddCustomsLineToQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      quoteId: string;
      code: "CU-02" | "CU-03";
      amount: number;
    }) => db.addCustomsLineToQuote(input.quoteId, input.code, input.amount),
    onSuccess: (_v, input) => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["quotes", input.quoteId] });
    },
  });
}

/* ---------- Ops Control Tower: Tasks & Notes ---------- */
export function useOpsTasks() {
  return useQuery({ queryKey: ["ops_tasks"], queryFn: db.listOpsTasks });
}
export function useSaveOpsTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; values: OpsTaskPatch & { title?: string } }) =>
      input.id
        ? db.updateOpsTask(input.id, input.values)
        : db.createOpsTask(
            input.values as OpsTaskPatch & { title: string },
          ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ops_tasks"] }),
  });
}
export function useDeleteOpsTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: db.deleteOpsTask,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ops_tasks"] }),
  });
}

/* ---------- Ops Control Tower: Live Tracking ---------- */
export function useJobTracking() {
  return useQuery({ queryKey: ["job_tracking"], queryFn: db.listJobTracking });
}
export function useRefreshTracking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { job: Job; shipsgoId: string | null }) => {
      const ref = trackableRef(input.job);
      if (!ref) throw new Error("This shipment has no AWB / MBL / container number.");
      const normalised = await fetchTracking(ref, input.shipsgoId);
      return db.upsertJobTracking(
        trackingRowFrom(input.job.id, ref, normalised),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job_tracking"] }),
  });
}

/* ---------- Shipment Comms ---------- */
export function useMessages(jobId: string | undefined) {
  return useQuery({
    queryKey: ["messages", jobId],
    queryFn: () => db.listMessages(jobId as string),
    enabled: Boolean(jobId),
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      job: Job;
      remarks: string;
      to: string[];
      cc: string[];
    }) => {
      const { job, remarks, to, cc } = input;
      const mail = buildShipmentEmail(job, undefined, remarks);
      try {
        const { id } = await sendMail({
          jobId: job.id,
          to,
          cc,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        });
        return db.createMessage({
          job_id: job.id,
          kind: "email",
          direction: "out",
          to_emails: to,
          cc_emails: cc,
          subject: mail.subject,
          body: mail.text,
          remarks,
          status: "sent",
          provider_id: id,
          sent_at: new Date().toISOString(),
        });
      } catch (e) {
        // Still record the attempt so the thread shows it failed.
        await db.createMessage({
          job_id: job.id,
          kind: "email",
          direction: "out",
          to_emails: to,
          cc_emails: cc,
          subject: mail.subject,
          body: mail.text,
          remarks,
          status: "failed",
          error: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    },
    onSuccess: (_m, input) =>
      qc.invalidateQueries({ queryKey: ["messages", input.job.id] }),
    onError: (_e, input) =>
      qc.invalidateQueries({ queryKey: ["messages", input.job.id] }),
  });
}

export function useAddNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { jobId: string; body: string }) =>
      db.createMessage({
        job_id: input.jobId,
        kind: "note",
        direction: "out",
        body: input.body,
        status: "sent",
      }),
    onSuccess: (_m, input) =>
      qc.invalidateQueries({ queryKey: ["messages", input.jobId] }),
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
