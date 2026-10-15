// Rebuilds the expac.co.za trade-lane landing pages from the originals
// downloaded from the hosting file manager (website/lane-pages/original/
// <slug>/index.html) into website/lane-pages/updated/<slug>/index.html:
//
//   - the old hand-built quote form (posting submit_web_form) is replaced by
//     the ExPac Motion website quote request, embedded for that lane's form
//     (packing list, sender / receiver, insurance, Tip of the Day, portal
//     access tick box; each request lands as a New Lead quote)
//   - a new "ExPac Motion" section on what the platform gives customers,
//     plus the route network linking the five lane pages
//   - nav, hero, process and Why ExPac copy updated for Motion
//
// Every change is an exact text replacement that must match once, so a page
// that has drifted from the template fails loudly instead of half-updating.
//
// Usage:  node website/lane-pages/build.mjs [outDir]
// (outDir defaults to website/lane-pages/updated)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, "original");
const OUT = path.resolve(process.argv[2] || path.join(here, "updated"));
const MOTION = "https://expac-motion.co.za";

/** Folder name on the server -> its Motion form (Sales CRM › Forms). */
const LANES = {
  "china-south-africa-freight": { name: "China", form: "6923e026-60b5-409e-b078-b5da78382775" },
  "europe-south-africa-freight": { name: "Europe", form: "18888f41-9461-4b62-ad32-36a36584b695" },
  "india-south-africa-freight": { name: "India", form: "1d26e45d-653f-43b1-84b9-447a3181c03c" },
  "united-kingdom-south-africa-freight": { name: "United Kingdom", form: "3ac8f409-f5cd-419f-b624-3c654aea76aa" },
  "usa-south-africa-freight": { name: "United States", form: "e5d55fb2-c042-4182-a638-100412d70a40" },
};

function replaceOnce(html, find, replacement, what) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`${what}: expected 1 match, found ${n}`);
  return html.replace(find, () => replacement);
}
function replaceRegexOnce(html, re, replacement, what) {
  const m = html.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"));
  if (!m || m.length !== 1) throw new Error(`${what}: expected 1 match, found ${m ? m.length : 0}`);
  // String replacement on purpose: $1 / $2 put the captured parts back.
  return html.replace(re, replacement);
}

const CSS = `
    /* ---- ExPac Motion section ---- */
    .motion { background: #151819; color: var(--white); overflow: hidden; }
    .motion .eyebrow { color: var(--green); }
    .motion .lead { color: #b9bfb9; }
    .motion-head { display: grid; grid-template-columns: 1.1fr .9fr; gap: 48px; align-items: end; margin-bottom: 48px; }
    .motion-head h2 span { color: var(--green); }
    .motion-ctas { display: flex; flex-wrap: wrap; gap: 12px; justify-content: flex-end; }
    .motion-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .motion-card { position: relative; border: 1px solid rgba(255,255,255,.12); border-radius: 22px; padding: 28px; background: rgba(255,255,255,.035); transition: border-color .2s ease, background .2s ease; }
    .motion-card:hover { border-color: rgba(140,188,67,.55); background: rgba(140,188,67,.07); }
    .motion-icon { width: 46px; height: 46px; display: grid; place-items: center; margin-bottom: 22px; border-radius: 14px; background: rgba(140,188,67,.14); color: var(--green); }
    .motion-card h3 { margin-bottom: 10px; font-size: 1.45rem; }
    .motion-card p { margin: 0; color: #b6bcb6; font-size: .93rem; }
    .motion-note { margin: 22px 0 0; color: #8f968f; font-size: .8rem; }
    .network { margin-top: 56px; padding-top: 36px; border-top: 1px solid rgba(255,255,255,.12); display: grid; grid-template-columns: .8fr 1.2fr; gap: 32px; align-items: center; }
    .network h3 { margin: 0; font-size: 1.9rem; }
    .network p { margin: 8px 0 0; color: #b6bcb6; font-size: .93rem; }
    .lane-links { display: flex; flex-wrap: wrap; gap: 10px; margin: 0; padding: 0; list-style: none; }
    .lane-links a, .lane-links span { display: inline-flex; align-items: center; gap: 8px; border: 1px solid rgba(255,255,255,.18); border-radius: 100px; padding: 10px 16px; color: #e6e8e5; font-family: var(--display); font-weight: 800; letter-spacing: .03em; text-decoration: none; }
    .lane-links a:hover { border-color: var(--green); color: var(--green); }
    .lane-links span { border-color: var(--green); background: rgba(140,188,67,.12); color: var(--green); }

    /* ---- Quote request (ExPac Motion form, embedded) ---- */
    .quote-section .quote-grid { grid-template-columns: 1fr auto; gap: 40px; align-items: end; margin-bottom: 30px; }
    .quote-section .contact-stack { margin: 0; }
    .quote-section .promise { max-width: 760px; margin: 18px 0 0; }
    .quote-embed { width: min(1060px, calc(100% - 20px)); margin-inline: auto; }
    .quote-embed iframe { display: block; width: 100%; height: 1500px; border: 0; background: transparent; }
    .quote-fallback { margin: 10px 0 0; color: var(--muted); font-size: .8rem; text-align: center; }
    .quote-fallback a { color: var(--green-dark); font-weight: 800; }

    @media (max-width: 980px) {
      .motion-head, .network { grid-template-columns: 1fr; }
      .motion-ctas { justify-content: flex-start; }
      .motion-grid { grid-template-columns: repeat(2, 1fr); }
      .quote-section .quote-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 760px) {
      .motion-grid { grid-template-columns: 1fr; }
      .quote-embed { width: 100%; }
    }
`;

function motionSection(slug) {
  const lanes = Object.entries(LANES)
    .map(([s, l]) =>
      s === slug
        ? `<li><span>${l.name} ⇄ South Africa</span></li>`
        : `<li><a href="https://expac.co.za/${s}/">${l.name} ⇄ South Africa</a></li>`,
    )
    .join("");
  return `
    <section class="section motion" id="motion">
      <div class="wrap">
        <div class="motion-head">
          <div>
            <p class="eyebrow">ExPac Motion</p>
            <h2>Your shipments, live.<span> Your quotes, online.</span></h2>
            <p class="lead">ExPac Motion is our own logistics platform. Every ExPac customer gets a portal login to follow cargo, approve quotes and talk to the team, on one screen, from any device.</p>
          </div>
          <div class="motion-ctas">
            <a class="button" href="#quote">Request portal access <span class="button-arrow">↗</span></a>
            <a class="button button-outline" href="${MOTION}/track">Track a shipment</a>
          </div>
        </div>

        <div class="motion-grid">
          <article class="motion-card"><span class="motion-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg></span><h3>Live route tracking</h3><p>Every shipment on a live map: each flight or vessel leg, the latest confirmed update and the ETA, refreshed automatically from carrier data.</p></article>
          <article class="motion-card"><span class="motion-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg></span><h3>Quotes in minutes</h3><p>Request a quote with your packing list, accept it online or ask for a revision in one click, and download the quotation PDF any time.</p></article>
          <article class="motion-card"><span class="motion-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span><h3>One conversation per shipment</h3><p>Message the ExPac team and raise tasks on each shipment. The whole history stays with that shipment, not lost in an inbox.</p></article>
          <article class="motion-card"><span class="motion-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg></span><h3>Documents &amp; proof of delivery</h3><p>Upload your commercial invoice and packing list, download shipping documents, invoices and the signed proof of delivery.</p></article>
          <article class="motion-card"><span class="motion-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21V8l9-5 9 5v13"/><path d="M7 21v-8h10v8M7 17h10"/></svg></span><h3>Warehouse visibility</h3><p>Using our warehouse? Pre-advise inbound goods, request releases for collection or delivery, and see your storage costs as they build.</p></article>
          <article class="motion-card"><span class="motion-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 16v-4M12 16V8M17 16v-7"/></svg></span><h3>Reports on demand</h3><p>Download your shipments, quotations, warehouse receipts and deliveries whenever you need them, ready for your own records.</p></article>
        </div>
        <p class="motion-note">Portal access comes with your ExPac account. Tick “I’d like access to the ExPac Motion portal” on the quote request below and we’ll send your login.</p>

        <div class="network">
          <div>
            <h3>One network, five trade lanes.</h3>
            <p>Air freight (direct and consolidated), FCL and LCL sea freight, courier and road, with customs clearance and delivery across South Africa, all managed in ExPac Motion.</p>
          </div>
          <ul class="lane-links" aria-label="ExPac trade lanes">${lanes}</ul>
        </div>
      </div>
    </section>
`;
}

function quoteEmbed(form) {
  const id = `expac-form-${form}`;
  return `
      <div class="quote-embed">
        <iframe id="${id}" title="ExPac quote request" loading="lazy"></iframe>
        <p class="quote-fallback">Form not loading? <a href="${MOTION}/forms/${form}" target="_blank" rel="noopener">Open the quote request in a new tab</a> or email <a href="mailto:support@expac.co.za">support@expac.co.za</a>.</p>
      </div>`;
}

function embedScript(form) {
  const id = `expac-form-${form}`;
  return `
    // ---- Quote request: the ExPac Motion form (Sales CRM › Forms), embedded.
    // It posts its height so the frame grows with the packing list, and gets
    // this page's ?utm_ parameters for campaign tracking. Each request lands
    // in Motion as a New Lead quote with its packing list.
    (function () {
      var frame = document.getElementById('${id}');
      var q = location.search.slice(1);
      frame.src = '${MOTION}/forms/${form}?embed=1' + (q ? '&' + q : '');
      window.addEventListener('message', function (e) {
        var d = e.data;
        if (e.origin === '${MOTION}' && d && d.type === 'expac-form-height' && d.id === '${form}') {
          frame.style.height = d.height + 'px';
        }
      });
    })();
`;
}

function build(slug, lane) {
  let h = fs.readFileSync(path.join(SRC, slug, "index.html"), "utf8");

  // Styles for the new sections, before the page's own media queries close.
  h = replaceOnce(h, "\n  </style>", CSS + "  </style>", "styles");

  // Meta: mention live tracking.
  h = replaceRegexOnce(
    h,
    /(<meta name="description" content="[^"]*?)\.?"/,
    `$1, with live online tracking on ExPac Motion."`,
    "meta description",
  );

  // Nav: ExPac Motion link before the quote button.
  h = replaceOnce(
    h,
    `<a href="#why-expac">Why ExPac</a>`,
    `<a href="#why-expac">Why ExPac</a>\n        <a href="#motion">ExPac Motion</a>`,
    "nav",
  );

  // Hero: one tracking link everywhere, and live tracking in the trust row.
  h = h.replace(`href="${MOTION}/track/"`, `href="${MOTION}/track"`);
  h = replaceOnce(h, `<li>Door-to-door options</li>`, `<li>Door-to-door options</li>\n            <li>Live online tracking</li>`, "trust row");

  // How it moves / Why ExPac: Motion in the copy.
  h = replaceRegexOnce(
    h,
    /(<h3>Move &amp; Update<\/h3><p>)[^<]*(<\/p>)/,
    `$1We manage the international leg while your shipment updates live in ExPac Motion: every flight or vessel leg on the map, the latest confirmed milestone and a team that tells you what comes next.$2`,
    "process step 03",
  );
  h = replaceRegexOnce(
    h,
    /(<strong>End-to-end visibility<\/strong><span>)[^<]*(<\/span>)/,
    `$1Your own ExPac Motion portal: live tracking, quotes, documents and chat with the team, from booking to proof of delivery.$2`,
    "benefit visibility",
  );

  // The ExPac Motion section goes just before the quote request.
  h = replaceOnce(h, `    <section class="section quote-section" id="quote">`, motionSection(slug) + `\n    <section class="section quote-section" id="quote">`, "motion section");

  // Quote request: the old form out, the Motion form in, full width.
  h = replaceRegexOnce(h, /\n\s*<form class="quote-form" id="quote-form">[\s\S]*?<\/form>/, "", "old form");
  h = replaceRegexOnce(
    h,
    /<p class="promise">[^<]*<\/p>/,
    `<p class="promise">Add your packing list (quantity, dimensions and weight per piece) for the most accurate quote: the chargeable weight is worked out as you type, and your request lands with our team ready to price.</p>`,
    "promise",
  );
  h = replaceRegexOnce(
    h,
    /(<section class="section quote-section" id="quote">\s*<div class="wrap quote-grid">[\s\S]*?<\/div>\s*<\/div>)(\s*<\/section>)/,
    `$1${quoteEmbed(lane.form)}$2`,
    "embed",
  );
  // The contact links sit beside the heading now: move them out of the copy column.
  h = replaceRegexOnce(
    h,
    /(\s*)(<div class="contact-stack">[\s\S]*?<\/div>)(\s*<p class="promise">[^<]*<\/p>\s*<\/div>)/,
    `$3$1$2`,
    "contacts beside heading",
  );

  // Footer: the portal.
  h = replaceOnce(
    h,
    `<a class="button button-outline" href="https://expac.co.za/">Visit ExPac</a>`,
    `<a class="button button-outline" href="https://expac.co.za/">Visit ExPac</a>\n          <a class="button button-outline" href="${MOTION}/portal">ExPac Motion portal</a>`,
    "footer",
  );

  // Script: the old form handler out, the embed in.
  h = replaceRegexOnce(h, /\n\s*\/\/ ---- Quote form: submit straight to ExPac Motion[\s\S]*?(\n  <\/script>)/, embedScript(lane.form) + "$1", "script");

  fs.mkdirSync(path.join(OUT, slug), { recursive: true });
  fs.writeFileSync(path.join(OUT, slug, "index.html"), h);
  return h.length;
}

for (const [slug, lane] of Object.entries(LANES)) {
  const size = build(slug, lane);
  console.log(`${slug}: ${size} bytes`);
}
console.log(`-> ${OUT}`);
