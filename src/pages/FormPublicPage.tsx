import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { getPublicWebForm, submitWebForm, uploadWebFormImage } from "../lib/db";
import type { PublicWebForm } from "../lib/types";
import QuoteRequestPublicForm from "./QuoteRequestPublicForm";

/** Public, unauthenticated hosted contact form (also used inside an
 *  <iframe> embed via ?embed=1). A submission creates a Lead + a team
 *  alert -- see submit_web_form() in 0037_web_forms.sql. */
const FORM_FAVICON = "https://cdn.expac.co.za/mail-assets/media/d2dbb470-55b1-483c-92ff-0cba3a2756b5.png";

export default function FormPublicPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const embed = params.get("embed") === "1";

  const [form, setForm] = useState<PublicWebForm | null | "missing">(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [uploadErr, setUploadErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const anyUploading = Object.values(uploading).some(Boolean);

  useEffect(() => {
    getPublicWebForm(id)
      .then((f) => setForm(f ?? "missing"))
      .catch(() => setForm("missing"));
  }, [id]);

  // Embedded on a website: tell the host page our height so the iframe
  // grows with the form (packing lines, the thank-you message). The embed
  // snippet on the Forms page listens for this.
  useEffect(() => {
    if (!embed || window.parent === window) return;
    const post = () =>
      window.parent.postMessage(
        { type: "expac-form-height", id, height: Math.ceil(document.documentElement.scrollHeight) },
        "*",
      );
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    post();
    return () => ro.disconnect();
  }, [embed, id]);

  // The ExPac tab icon on the hosted forms (contact / lane quote request
  // pages, chosen 2026-10-14). This is a single-page-app, so there's no
  // separate index.html per route to set this statically; swap the shared
  // <link rel="icon"> on mount and put the app's own favicon back on
  // unmount, so leaving the form page (client-side, no reload) restores it.
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;
    const original = link.href;
    const originalType = link.type;
    link.href = FORM_FAVICON;
    link.type = "image/png";
    return () => {
      link.href = original;
      link.type = originalType;
    };
  }, []);

  const utm = useMemo(() => {
    const out: Record<string, string> = {};
    params.forEach((v, k) => {
      if (k.startsWith("utm_") || k === "gclid" || k === "ref") out[k] = v;
    });
    return out;
  }, [params]);

  async function onImageChange(fieldId: string, file: File | undefined) {
    if (!file) return;
    setUploadErr((v) => ({ ...v, [fieldId]: "" }));
    setUploading((v) => ({ ...v, [fieldId]: true }));
    try {
      const url = await uploadWebFormImage(file);
      setValues((v) => ({ ...v, [fieldId]: url }));
      setFileNames((v) => ({ ...v, [fieldId]: file.name }));
    } catch {
      setUploadErr((v) => ({ ...v, [fieldId]: "Could not upload that image. Please try again." }));
    } finally {
      setUploading((v) => ({ ...v, [fieldId]: false }));
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form === null || form === "missing") return;
    if (anyUploading) {
      setErr("Please wait for the image to finish uploading.");
      return;
    }
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

  // 0174: a quote request form shows the Quote Builder style inputs.
  if (form.kind === "quote_request") {
    return (
      <div className={wrapClass}>
        <QuoteRequestPublicForm form={form} utm={utm} onDone={() => setDone(true)} />
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
            ) : f.type === "image" ? (
              <>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => onImageChange(f.id, e.target.files?.[0])}
                />
                {uploading[f.id] && <p className="wf-upload-status">Uploading…</p>}
                {!uploading[f.id] && fileNames[f.id] && (
                  <p className="wf-upload-status">✓ {fileNames[f.id]}</p>
                )}
                {uploadErr[f.id] && <p className="wf-err">{uploadErr[f.id]}</p>}
              </>
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
        <button className="btn wf-submit" type="submit" disabled={busy || anyUploading}>
          {busy ? "Submitting…" : form.submit_label}
        </button>
      </form>
    </div>
  );
}
