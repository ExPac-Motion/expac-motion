import ContactsPage from "./ContactsPage";
import {
  useClearingAgents,
  useDeleteClearingAgent,
  useSaveClearingAgent,
  useUpdateContactsBulk,
} from "../lib/hooks";

export default function ClearingAgentsPage() {
  return (
    <ContactsPage
      kind="clearing_agent"
      query={useClearingAgents()}
      save={useSaveClearingAgent()}
      remove={useDeleteClearingAgent()}
      bulkUpdate={useUpdateContactsBulk("clearing_agent")}
    />
  );
}
