import ContactsPage from "./ContactsPage";
import {
  useClearingAgents,
  useDeleteClearingAgent,
  useSaveClearingAgent,
} from "../lib/hooks";

export default function ClearingAgentsPage() {
  return (
    <ContactsPage
      kind="clearing_agent"
      query={useClearingAgents()}
      save={useSaveClearingAgent()}
      remove={useDeleteClearingAgent()}
    />
  );
}
