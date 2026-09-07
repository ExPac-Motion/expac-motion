import ContactsPage from "./ContactsPage";
import {
  useClients,
  useDeleteClient,
  useSaveClient,
  useUpdateContactsBulk,
} from "../lib/hooks";

export default function ClientsPage() {
  return (
    <ContactsPage
      kind="client"
      query={useClients()}
      save={useSaveClient()}
      remove={useDeleteClient()}
      bulkUpdate={useUpdateContactsBulk("client")}
    />
  );
}
