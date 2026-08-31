import ContactsPage from "./ContactsPage";
import { useClients, useDeleteClient, useSaveClient } from "../lib/hooks";

export default function ClientsPage() {
  return (
    <ContactsPage
      kind="client"
      query={useClients()}
      save={useSaveClient()}
      remove={useDeleteClient()}
    />
  );
}
