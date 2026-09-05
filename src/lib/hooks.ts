import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as db from "./db";
import type {
  Client,
  CompanySettingsPatch,
  Contact,
  ImportDutyDraft,
  Job,
  JobInsert,
  JobPatch,
  Milestone,
  OpsTaskPatch,
  ProfilePatch,
  QuoteDraft,
  RateSheetPatch,
  LeadPatch,
  LeadStatusPatch,
  OpportunityPatch,
  MailTemplatePatch,
  FollowUpRulePatch,
  WebFormPatch,
  ShipmentDocument,
  Supplier,
} from "./types";
import { fetchTracking, trackableRef, trackingRowFrom } from "./tracking";
import { buildShipmentEmail } from "./mailTemplates";
import { resolveMergeFields, htmlToText } from "./mailMerge";
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

/* ---------- Customer Portal ---------- */
export function useMyProfile() {
  return useQuery({ queryKey: ["my_profile"], queryFn: db.getMyProfile });
}
export function useCreateClientInvite() {
  return useMutation({ mutationFn: (clientId: string) => db.createClientInvite(clientId) });
}
export function useInvite(token: string | undefined) {
  return useQuery({
    queryKey: ["invite", token],
    queryFn: () => db.getInvite(token as string),
    enabled: Boolean(token),
    retry: false,
  });
}
export function useMyQuotes() {
  return useQuery({ queryKey: ["my_quotes"], queryFn: db.listMyQuotes });
}
export function useMyQuoteLines(quoteId: string | undefined) {
  return useQuery({
    queryKey: ["my_quote_lines", quoteId],
    queryFn: () => db.listMyQuoteLines(quoteId as string),
    enabled: Boolean(quoteId),
  });
}
export function useMyJobs() {
  return useQuery({ queryKey: ["my_jobs"], queryFn: db.listMyJobs });
}
export function useMyMessages(jobId: string | undefined) {
  return useQuery({
    queryKey: ["my_messages", jobId],
    queryFn: () => db.listMyMessages(jobId as string),
    enabled: Boolean(jobId),
  });
}
export function useSendMyMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { jobId: string; body: string }) =>
      db.sendMyMessage(input.jobId, input.body),
    onSuccess: (_v, input) =>
      qc.invalidateQueries({ queryKey: ["my_messages", input.jobId] }),
  });
}
export function useMyDocuments(jobId: string | undefined) {
  return useQuery({
    queryKey: ["my_documents", jobId],
    queryFn: () => db.listMyDocuments(jobId as string),
    enabled: Boolean(jobId),
  });
}

/* ---------- Rates & Tariff Sheet ---------- */
export function useRateSheet() {
  return useQuery({ queryKey: ["rate_sheet"], queryFn: db.listRateSheet });
}
export function useSaveRateSheetItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; patch: RateSheetPatch }) =>
      db.saveRateSheetItem(input.id, input.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rate_sheet"] }),
  });
}
export function useDeleteRateSheetItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: db.deleteRateSheetItem,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rate_sheet"] }),
  });
}

/* ---------- Sales CRM: Leads ---------- */
export function useLeadStatuses() {
  return useQuery({ queryKey: ["lead_statuses"], queryFn: db.listLeadStatuses });
}
export function useSaveLeadStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; patch: LeadStatusPatch }) =>
      db.saveLeadStatus(input.id, input.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lead_statuses"] }),
  });
}
export function useDeleteLeadStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: db.deleteLeadStatus,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lead_statuses"] }),
  });
}
export function useLeads() {
  return useQuery({ queryKey: ["leads"], queryFn: db.listLeads });
}
export function useSaveLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; patch: LeadPatch }) =>
      db.saveLead(input.id, input.patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
  });
}
export function useDeleteLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: db.deleteLead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}
export function useCreateLeadsBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: db.createLeadsBulk,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

/* ---------- Sales CRM: Opportunities ---------- */
export function useOpportunities() {
  return useQuery({ queryKey: ["opportunities"], queryFn: db.listOpportunities });
}
export function useCreateOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: OpportunityPatch) => db.createOpportunity(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["opportunities"] }),
  });
}
export function useUpdateOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; patch: OpportunityPatch }) =>
      db.updateOpportunity(input.id, input.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["opportunities"] }),
  });
}
export function useDeleteOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: db.deleteOpportunity,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["opportunities"] }),
  });
}

/* ---------- Sales CRM: Mail Templates ---------- */
export function useMailTemplates() {
  return useQuery({ queryKey: ["mail_templates"], queryFn: db.listMailTemplates });
}
export function useSaveMailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; patch: MailTemplatePatch }) =>
      db.saveMailTemplate(input.id, input.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mail_templates"] }),
  });
}
export function useDeleteMailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: db.deleteMailTemplate,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mail_templates"] }),
  });
}
export function useUploadMailAsset() {
  return useMutation({ mutationFn: db.uploadMailAsset });
}

/* ---------- Sales CRM: Mail Campaigns ---------- */
export function useMailCampaigns() {
  return useQuery({ queryKey: ["mail_campaigns"], queryFn: db.listMailCampaigns });
}
export function useMailCampaignRecipients(campaignId: string | undefined) {
  return useQuery({
    queryKey: ["mail_campaign_recipients", campaignId],
    queryFn: () => db.listMailCampaignRecipients(campaignId as string),
    enabled: !!campaignId,
  });
}
export function useAllCampaignRecipients() {
  return useQuery({
    queryKey: ["mail_campaign_recipients", "all"],
    queryFn: db.listAllCampaignRecipients,
  });
}
export function useDeleteMailCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: db.deleteMailCampaign,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mail_campaigns"] }),
  });
}

/* ---------- Sales CRM: Follow-up workflows ---------- */
export function useFollowUpRules() {
  return useQuery({ queryKey: ["follow_up_rules"], queryFn: db.listFollowUpRules });
}
export function useSaveFollowUpRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; patch: FollowUpRulePatch }) =>
      db.saveFollowUpRule(input.id, input.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["follow_up_rules"] }),
  });
}
export function useDeleteFollowUpRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: db.deleteFollowUpRule,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["follow_up_rules"] }),
  });
}
export function useFollowUpLog() {
  return useQuery({ queryKey: ["follow_up_log"], queryFn: db.listFollowUpLog });
}
export function useRunDueFollowUps() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: db.runDueFollowUps,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["follow_up_log"] }),
  });
}

/* ---------- Sales CRM: Web contact forms ---------- */
export function useWebForms() {
  return useQuery({ queryKey: ["web_forms"], queryFn: db.listWebForms });
}
export function useSaveWebForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; patch: WebFormPatch }) =>
      db.saveWebForm(input.id, input.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["web_forms"] }),
  });
}
export function useDeleteWebForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: db.deleteWebForm,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["web_forms"] }),
  });
}
export function useWebFormSubmissions(formId: string | undefined) {
  return useQuery({
    queryKey: ["web_form_submissions", formId],
    queryFn: () => db.listWebFormSubmissions(formId as string),
    enabled: !!formId,
  });
}

interface SendCampaignInput {
  templateId: string | null;
  name: string;
  subject: string;
  body: string;
  recipients: Array<{ leadId: string; email: string; name: string; company: string }>;
  onProgress?: (sent: number, total: number) => void;
}

/** Creates the campaign + recipient rows, then sends one email per
 *  recipient (small concurrency window) through the same Resend proxy
 *  Shipment Comms uses. Runs entirely from the browser -- the tab must
 *  stay open until it finishes; there's no server-side queue yet. */
export function useSendCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SendCampaignInput) => {
      const { templateId, name, subject, body, recipients, onProgress } = input;
      const campaign = await db.createMailCampaign({
        template_id: templateId,
        name,
        subject,
        body,
        status: "sending",
        recipient_filter: {},
      });
      const rows = await db.createMailCampaignRecipients(
        recipients.map((r) => ({
          campaign_id: campaign.id,
          lead_id: r.leadId,
          email: r.email,
        })),
      );

      let sentCount = 0;
      let failedCount = 0;
      const CONCURRENCY = 5;
      let cursor = 0;
      async function worker() {
        while (cursor < rows.length) {
          const i = cursor++;
          const row = rows[i];
          const recipient = recipients.find((r) => r.leadId === row.lead_id);
          const unsubscribeUrl = `${window.location.origin}/unsubscribe?r=${row.id}`;
          const mergeCtx = {
            name: recipient?.name || "",
            company: recipient?.company || "",
            unsubscribeUrl,
          };
          const html = resolveMergeFields(body, mergeCtx);
          const finalSubject = resolveMergeFields(subject, mergeCtx);
          try {
            const { id } = await sendMail({
              to: [row.email],
              subject: finalSubject,
              html,
              text: htmlToText(html),
            });
            await db.updateMailCampaignRecipient(row.id, {
              status: "sent",
              provider_id: id,
              sent_at: new Date().toISOString(),
            });
          } catch (e) {
            failedCount++;
            await db.updateMailCampaignRecipient(row.id, {
              status: "failed",
              error: e instanceof Error ? e.message : "Send failed",
            });
          }
          sentCount++;
          onProgress?.(sentCount, rows.length);
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker),
      );

      // "failed" only when NOTHING went out -- a partial failure still
      // means real mail was sent, so the campaign counts as sent overall
      // (the per-recipient breakdown in the detail view shows the rest).
      await db.updateMailCampaign(campaign.id, {
        status: failedCount === rows.length ? "failed" : "sent",
        sent_at: new Date().toISOString(),
      });
      return campaign;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mail_campaigns"] }),
  });
}

/* ---------- CRM ---------- */
export function useMessagesForJobs(jobIds: string[]) {
  return useQuery({
    queryKey: ["messages", "byJobs", jobIds],
    queryFn: () => db.listMessagesForJobs(jobIds),
    enabled: jobIds.length > 0,
  });
}
export function useShipmentDocumentsForJobs(jobIds: string[]) {
  return useQuery({
    queryKey: ["shipment_documents", "byJobs", jobIds],
    queryFn: () => db.listShipmentDocumentsForJobs(jobIds),
    enabled: jobIds.length > 0,
  });
}

/* ---------- Settings ---------- */
export function useCompanySettings() {
  return useQuery({
    queryKey: ["company_settings"],
    queryFn: db.getCompanySettings,
  });
}
export function useUpdateCompanySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: CompanySettingsPatch) => db.updateCompanySettings(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["company_settings"] }),
  });
}
export function useProfiles() {
  return useQuery({ queryKey: ["profiles"], queryFn: db.listProfiles });
}
export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; patch: ProfilePatch }) =>
      db.updateProfile(input.id, input.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profiles"] }),
  });
}

/* ---------- Document Vault ---------- */
export function useShipmentDocuments(jobId: string | undefined) {
  return useQuery({
    queryKey: ["shipment_documents", jobId],
    queryFn: () => db.listShipmentDocuments(jobId as string),
    enabled: Boolean(jobId),
  });
}
export function useUploadShipmentDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { jobId: string; file: File }) =>
      db.uploadShipmentDocument(input.jobId, input.file),
    onSuccess: (_d, input) =>
      qc.invalidateQueries({ queryKey: ["shipment_documents", input.jobId] }),
  });
}
export function useDeleteShipmentDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (doc: ShipmentDocument) => db.deleteShipmentDocument(doc),
    onSuccess: (_v, doc) =>
      qc.invalidateQueries({ queryKey: ["shipment_documents", doc.job_id] }),
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
export function useDeleteJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: db.deleteJob,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}
export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: JobInsert) => db.createJob(values),
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
