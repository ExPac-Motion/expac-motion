import ContactsPage from "./ContactsPage";
import { useAgents, useDeleteAgent, useSaveAgent } from "../lib/hooks";

export default function AgentsPage() {
  return (
    <ContactsPage
      kind="agent"
      query={useAgents()}
      save={useSaveAgent()}
      remove={useDeleteAgent()}
    />
  );
}
