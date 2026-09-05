/**
 * ieindustrialwatch.com
 * Serves the static site and handles subscriber signups.
 *
 * POST /api/subscribe  { email, name?, company?, hp? }
 *   -> { ok: true }            new or already-subscribed (same response either way)
 *   -> { ok: false, error }    validation failure
 *
 * Addresses are stored in D1. Nothing is sent from here; Ed exports the list
 * and mails from RealNex, which handles unsubscribe and CAN-SPAM.
 */

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/subscribe") {
      if (request.method === "POST") return handleSubscribe(request, env);
      return json({ ok: false, error: "Method not allowed." }, 405);
    }

    return env.ASSETS.fetch(request);
  },
};
