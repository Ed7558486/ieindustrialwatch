/**
 * ieindustrialwatch.com
 * Serves the static site and handles subscriber signups.
 *
 * POST /api/subscribe  { email, name?, company?, hp? }
 *   -> { ok: true }            new or already-subscribed (same response either way)
 *   -> { ok: false, error }    validation failure
 *
 * POST /api/benchmark  { email, city?, size_sf?, current_rent?, expiry?, name?, hp? }
 *   -> { ok: true }            lead captured
 *   -> { ok: false, error }    validation failure
 *   Rent-benchmark requests from the site's call to action. Stored in the same D1
 *   database, in its own table, which is created on first use so no migration is
 *   needed, and emailed to Ed through Cloudflare Email Routing as they arrive.
 *   A failed notification never fails the capture.
 *
 * Addresses are stored in D1. Nothing is sent from here; Ed exports the list
 * and mails from RealNex, which handles unsubscribe and CAN-SPAM.
 */

import { EmailMessage } from "cloudflare:email";

const EMAIL_RE = /^[^\s@,;:<>()[\]\\]+@[^\s@.,;:<>()[\]\\]+\.[^\s@,;:<>()[\]\\]{2,}$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function handleSubscribe(request, env) {
  let data;
  const ct = request.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) {
      data = await request.json();
    } else {
      const form = await request.formData();
      data = Object.fromEntries(form.entries());
    }
  } catch {
    return json({ ok: false, error: "Could not read that submission." }, 400);
  }

  // Honeypot. Real people leave it empty; most bots fill every field.
  if (data.hp) return json({ ok: true });

  const email = String(data.email || "").trim().toLowerCase();
  const name = String(data.name || "").trim().slice(0, 120);
  const company = String(data.company || "").trim().slice(0, 160);

  if (!email) return json({ ok: false, error: "Enter an email address." }, 400);
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return json({ ok: false, error: "That doesn't look like a valid email address." }, 400);
  }

  if (!env.DB) {
    return json({ ok: false, error: "Signups are temporarily unavailable." }, 503);
  }

  const meta = {
    ip: request.headers.get("cf-connecting-ip") || "",
    country: (request.cf && request.cf.country) || "",
    ua: (request.headers.get("user-agent") || "").slice(0, 300),
    ref: (data.source || request.headers.get("referer") || "").slice(0, 300),
  };

  try {
    await env.DB.prepare(
      `INSERT INTO subscribers (email, name, company, source, ip, country, user_agent, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))
       ON CONFLICT(email) DO UPDATE SET
         name    = COALESCE(NULLIF(excluded.name, ''), subscribers.name),
         company = COALESCE(NULLIF(excluded.company, ''), subscribers.company)`
    ).bind(email, name, company, meta.ref, meta.ip, meta.country, meta.ua).run();
  } catch (err) {
    return json({ ok: false, error: "Something went wrong saving that. Try again." }, 500);
  }

  return json({ ok: true });
}

const BENCHMARK_TABLE = `CREATE TABLE IF NOT EXISTS benchmark_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT NOT NULL,
  name         TEXT,
  city         TEXT,
  size_sf      TEXT,
  current_rent TEXT,
  expiry       TEXT,
  source       TEXT,
  ip           TEXT,
  country      TEXT,
  user_agent   TEXT,
  created_at   TEXT NOT NULL
)`;

// Anything interpolated into a mail header must not be able to inject one.
function header(v) {
  return String(v || "").replace(/[\r\n]+/g, " ").trim();
}

/**
 * Emails Ed the moment a benchmark request lands, through Cloudflare Email
 * Routing. Built by hand rather than with mimetext so the Worker keeps zero
 * npm dependencies; there is no package.json and no build step in this repo.
 * Never allowed to fail the request: the lead is already in D1 by this point.
 */
async function notifyBenchmark(env, lead) {
  if (!env.LEAD_MAIL) return;

  const bits = [lead.sizeSf && lead.sizeSf + " SF", lead.city, lead.currentRent && "$" + lead.currentRent]
    .filter(Boolean)
    .join(", ");
  const subject = header("Rent benchmark request" + (bits ? ": " + bits : "") + (lead.expiry ? " \u2014 expires " + lead.expiry : ""));

  const body = [
    "A rent benchmark request came in from ieindustrialwatch.com.",
    "",
    "Email:         " + (lead.email || "-"),
    "Name:          " + (lead.name || "-"),
    "Building city: " + (lead.city || "-"),
    "Size:          " + (lead.sizeSf ? lead.sizeSf + " SF" : "-"),
    "Current rent:  " + (lead.currentRent ? "$" + lead.currentRent + "/SF/mo NNN" : "-"),
    "Lease expiry:  " + (lead.expiry || "-"),
    "",
    "Page:          " + (lead.source || "-"),
    "Received:      " + new Date().toISOString(),
    "",
    "Reply to this message to answer them directly.",
    "The full record is in the benchmark_requests table of the iewatch-subscribers database.",
  ].join("\r\n");

  const raw = [
    "From: IE Industrial Watch <leads@ieindustrialwatch.com>",
    "To: Ed Smith <esmith@lee-assoc.com>",
    lead.email ? "Reply-To: " + header(lead.email) : null,
    "Message-ID: <" + crypto.randomUUID() + "@ieindustrialwatch.com>",
    "Subject: " + subject,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ]
    .filter((line) => line !== null)
    .join("\r\n");

  await env.LEAD_MAIL.send(
    new EmailMessage("leads@ieindustrialwatch.com", "esmith@lee-assoc.com", raw)
  );
}

async function handleBenchmark(request, env) {
  let data;
  const ct = request.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) {
      data = await request.json();
    } else {
      const form = await request.formData();
      data = Object.fromEntries(form.entries());
    }
  } catch {
    return json({ ok: false, error: "Could not read that submission." }, 400);
  }

  // Honeypot. Real people leave it empty; most bots fill every field.
  if (data.hp) return json({ ok: true });

  const email = String(data.email || "").trim().toLowerCase();
  if (!email) return json({ ok: false, error: "Enter an email address." }, 400);
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return json({ ok: false, error: "That doesn't look like a valid email address." }, 400);
  }

  const field = (v, n) => String(v || "").trim().slice(0, n);
  const name = field(data.name, 120);
  const city = field(data.city, 80);
  const sizeSf = field(data.size_sf, 40);
  const currentRent = field(data.current_rent, 40);
  const expiry = field(data.expiry, 60);

  if (!env.DB) {
    return json({ ok: false, error: "That form is temporarily unavailable. Email esmith@lee-assoc.com instead." }, 503);
  }

  const meta = {
    ip: request.headers.get("cf-connecting-ip") || "",
    country: (request.cf && request.cf.country) || "",
    ua: (request.headers.get("user-agent") || "").slice(0, 300),
    ref: (data.source || request.headers.get("referer") || "").slice(0, 300),
  };

  try {
    await env.DB.prepare(BENCHMARK_TABLE).run();
    await env.DB.prepare(
      `INSERT INTO benchmark_requests
         (email, name, city, size_sf, current_rent, expiry, source, ip, country, user_agent, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, datetime('now'))`
    ).bind(email, name, city, sizeSf, currentRent, expiry, meta.ref, meta.ip, meta.country, meta.ua).run();
  } catch (err) {
    return json({ ok: false, error: "Something went wrong saving that. Try again." }, 500);
  }

  // The lead is saved. A failed notification must not tell the sender otherwise.
  try {
    await notifyBenchmark(env, { email, name, city, sizeSf, currentRent, expiry, source: meta.ref });
  } catch (err) {
    // swallowed on purpose
  }

  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/subscribe") {
      if (request.method === "POST") return handleSubscribe(request, env);
      return json({ ok: false, error: "Method not allowed." }, 405);
    }

    if (url.pathname === "/api/benchmark") {
      if (request.method === "POST") return handleBenchmark(request, env);
      return json({ ok: false, error: "Method not allowed." }, 405);
    }

    return env.ASSETS.fetch(request);
  },
};
