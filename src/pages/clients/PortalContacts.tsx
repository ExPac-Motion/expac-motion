import { useState, type FormEvent } from "react";
import { useToast } from "../../components/Toast";
import { CUSTOMER_ROLES, SALUTATIONS, customersDb, useCustomerContacts, useCustomerMutation, type CustomerRecord } from "../../lib/customers";
import PortalAccessBox from "./PortalAccessBox";

/**
 * General › under the primary contact's "Enable Customer Portal Access":
 * more people at the same customer who can sign in to the portal. Each one is
 * a row in the customer's Contacts (client_contacts) with its own portal login
 * (same /api/customer-login as the primary contact, linked to this customer).
 */
export default function PortalContacts({ client, primaryEmail, isAdmin }: { client: CustomerRecord; primaryEmail: string; isAdmin: boolean }) {
  const { toast, error } = useToast();
  const q = useCustomerContacts(client.id);
  const save = useCustomerMutation((v: Parameters<typeof customersDb.saveContact>[1]) => customersDb.saveContact(undefined, v));
  const [adding, setAdding] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const primary = primaryEmail.trim().toLowerCase();
  const all = q.data ?? [];
  const withEmail = all.filter((c) => c.email && c.email.trim().toLowerCase() !== primary);
  const noEmail = all.filter((c) => !c.email);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const g = (k: string) => String(fd.get(k) ?? "").trim() || null;
    const name = g("name");
    const email = g("email");
    if (!name) return error("Enter the contact's name");
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return error("Enter the contact's email address");
    const low = email.toLowerCase();
    if (low === primary || all.some((c) => (c.email ?? "").trim().toLowerCase() === low)) return error("That email is already a contact on this customer");
    save.mutate(
      { client_id: client.id, salutation: g("salutation"), name, email, role: g("role") },
      {
        onSuccess: () => {
          toast(`${name} added, now create their login`);
          setJustAdded(low);
          setAdding(false);
        },
        onError: (er) => error(er.message),
      },
    );
  }

  if (!isAdmin && withEmail.length === 0) return null;

  return (
    <div className="cr-portal-contacts">
      <div className="cr-portal-contacts-head">
        <b>Other contacts with portal access</b>
        {isAdmin && !adding && (
          <button type="button" className="btn outline btn-sm" onClick={() => setAdding(true)}>
            + Add contact
          </button>
        )}
      </div>
      <p className="hint" style={{ margin: "0 0 6px" }}>
        Each contact gets their own login to this customer's portal. They also show on the Contacts tab.
      </p>

      {withEmail.map((c) => (
        <PortalAccessBox
          key={c.id}
          compact={{ label: `${[c.salutation, c.name].filter(Boolean).join(" ")} · ${c.email}${c.role ? ` · ${c.role}` : ""}` }}
          startEnabled={justAdded === (c.email ?? "").trim().toLowerCase()}
          client={client}
          email={c.email ?? ""}
          name={c.name}
          salutation={c.salutation ?? ""}
          lastName={c.name.split(" ").slice(-1)[0] ?? ""}
          isAdmin={isAdmin}
        />
      ))}

      {withEmail.length === 0 && !adding && !q.isLoading && <p className="hint" style={{ margin: 0 }}>No other contacts yet.</p>}

      {noEmail.length > 0 && (
        <p className="hint" style={{ margin: "6px 0 0" }}>
          {noEmail.map((c) => c.name).join(", ")} {noEmail.length === 1 ? "has" : "have"} no email. Add one on the Contacts tab to give portal access.
        </p>
      )}

      {adding && (
        <form className="cr-portal-add" onSubmit={submit}>
          <label className="cr-field">
            <span>Salutation</span>
            <select name="salutation" defaultValue="">
              <option value="">—</option>
              {SALUTATIONS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="cr-field">
            <span>Name *</span>
            <input name="name" autoFocus />
          </label>
          <label className="cr-field">
            <span>Email *</span>
            <input name="email" type="email" />
          </label>
          <label className="cr-field">
            <span>Customer Role</span>
            <input name="role" list="cr-portal-roles" />
            <datalist id="cr-portal-roles">
              {CUSTOMER_ROLES.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </label>
          <div className="cr-portal-add-foot">
            <button type="button" className="btn outline btn-sm" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="btn btn-sm" disabled={save.isPending}>
              {save.isPending ? "Adding…" : "Add contact"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
