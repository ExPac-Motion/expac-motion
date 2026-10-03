import ContactsPage from "./ContactsPage";
import {
  useDeleteDestinationAgent,
  useDestinationAgents,
  useSaveDestinationAgent,
  useUpdateContactsBulk,
} from "../lib/hooks";

/** Destination handling agents (0124) — destination handling charges. */
export default function DestinationAgentsPage() {
  return (
    <ContactsPage
      kind="destination_agent"
      query={useDestinationAgents()}
      save={useSaveDestinationAgent()}
      remove={useDeleteDestinationAgent()}
      bulkUpdate={useUpdateContactsBulk("destination_agent")}
    />
  );
}
