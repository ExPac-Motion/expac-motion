import ContactsPage from "./ContactsPage";
import {
  useDeleteSupplier,
  useSaveSupplier,
  useSuppliers,
  useUpdateContactsBulk,
} from "../lib/hooks";

export default function SuppliersPage() {
  return (
    <ContactsPage
      kind="supplier"
      query={useSuppliers()}
      save={useSaveSupplier()}
      remove={useDeleteSupplier()}
      bulkUpdate={useUpdateContactsBulk("supplier")}
    />
  );
}
