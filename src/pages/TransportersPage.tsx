import ContactsPage from "./ContactsPage";
import {
  useDeleteTransporter,
  useSaveTransporter,
  useTransporters,
} from "../lib/hooks";

export default function TransportersPage() {
  return (
    <ContactsPage
      kind="transporter"
      query={useTransporters()}
      save={useSaveTransporter()}
      remove={useDeleteTransporter()}
    />
  );
}
