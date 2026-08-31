import ContactsPage from "./ContactsPage";
import { useDeleteSupplier, useSaveSupplier, useSuppliers } from "../lib/hooks";

export default function SuppliersPage() {
  return (
    <ContactsPage
      kind="supplier"
      query={useSuppliers()}
      save={useSaveSupplier()}
      remove={useDeleteSupplier()}
    />
  );
}
