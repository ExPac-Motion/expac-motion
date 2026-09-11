import { useSearchParams } from "react-router-dom";
import ContactsPage from "./ContactsPage";
import PortalAccessPage from "./clients/PortalAccessPage";
import {
  useClients,
  useDeleteClient,
  useSaveClient,
  useUpdateContactsBulk,
} from "../lib/hooks";

/** Customers — sub-nav lives in the shared top-nav (Layout.tsx), driven by ?tab=. */
export default function ClientsPage() {
  const [params] = useSearchParams();
  const tab = params.get("tab");

  // Called unconditionally (Rules of Hooks) even on the Portal Access tab,
  // where their results just go unused.
  const query = useClients();
  const save = useSaveClient();
  const remove = useDeleteClient();
  const bulkUpdate = useUpdateContactsBulk("client");

  if (tab === "portal-access") return <PortalAccessPage />;

  return (
    <ContactsPage
      kind="client"
      query={query}
      save={save}
      remove={remove}
      bulkUpdate={bulkUpdate}
    />
  );
}
