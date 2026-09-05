import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { getPublicWebForm, submitWebForm } from "../lib/db";
import type { PublicWebForm } from "../lib/types";

/** Public, unauthenticated hosted contact form (also used inside an
 *  <iframe> embed via ?embed=1). A submission creates a Lead + a team
 *  alert -- see submit_web_form() in 0037_web_forms.sql. */
export default function FormPublicPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const embed = params.get("embed") === "1";

  const [form, setForm] = useState<PublicWebForm | null | "missing">(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    getPublicWebForm(id)
      .then((f) => setForm(f ?? "missing"))
      .catch(() => setForm("missing"));
  }, [id]);

  const utm = useMemo(() => {
    const out: Record<string, string> = {};
    params.forEach((v, k) => {
      if (k.startsWith("utm_") || k === "gclid" || k === "ref") out[k] = v;
    });
    return out;
  }, [params]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form === null || form === "missing") return;
    for (const f of form.fields) {
      if (f.required && !(values[f.id] ?? "").trim()) {
        setErr(`"${f.label}" is required`);
        return;
      }
    }
    setErr("");
    setBusy(true);
    try {
      const res = await submitWebForm(id, values, form.track_url_params ? utm : {});
      if (res.ok) setDone(true);
      else setErr(res.error || "Something went wrong");
    } catch {
      setErr("Could not submit right now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const wrapClass = embed ? "wf-page wf-embed" : "wf-page";

  if (form === null) {
    return (
      <div className={wrapClass}>
        <div className="wf-card">Loading…</div>
      </div>
    );
  }
  if (form === "missing") {
    return (
      <div className={wrapClass}>
        <div className="wf-card">
          <h1>Form not found</h1>
          <p className="sub">This form is no longer available.</p>
        </div>
      </div>
    );
  }
  if (done) {
    return (
      <div className={wrapClass}>
        <div className="wf-card wf-thanks">
          <h1>{form.thankyou_title}</h1>
          <p>{form.thankyou_body}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={wrapClass}>
      <form className="wf-card" onSubmit={onSubmit}>
        <h1>{form.heading}</h1>
        {form.subtitle && <p className="sub">{form.subtitle}</p>}

        {form.fields.map((f) => (
          <div className="field" key={f.id}>
            <label>
              {f.label}
              {f.required && <span className="wf-req"> *</span>}
            </label>
            {f.type === "textarea" ? (
              <textarea
                rows={4}
                placeholder={f.placeholder ?? ""}
                value={values[f.id] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.id]: e.target.value }))
                }
              />
            ) : f.type === "dropdown" ? (
              <select
                value={values[f.id] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.id]: e.target.value }))
                }
              >
                <option value="">Choose an option</option>
                {(f.choices ?? []).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={f.type === "email" ? "email" : f.type === "phone" ? "tel" : "text"}
                placeholder={f.placeholder ?? ""}
                value={values[f.id] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.id]: e.target.value }))
                }
              />
            )}
          </div>
        ))}

        {err && <div className="wf-err">{err}</div>}
        <button className="btn wf-submit" type="submit" disabled={busy}>
          {busy ? "Submitting…" : form.submit_label}
        </button>
      </form>
    </div>
  );
}
