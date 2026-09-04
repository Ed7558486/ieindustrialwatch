# Inland Empire Industrial Watch

Weekly market and regulatory brief for Inland Empire industrial tenants and owners.
Published at **https://ieindustrialwatch.com**

Ed Smith, CCIM · DRE #00874955 · Broker Associate, Lee & Associates – Ontario
esmith@lee-assoc.com · 909.373.2730 direct · 562.755.8486 mobile

## How this repo publishes

- Site files live in `IE Watch Site/`.
- The Cloudflare Worker `ieindustrialwatch` builds from `main`, output directory `IE Watch Site`.
- Every push to `main` redeploys automatically. There is no manual upload step.

## Structure

| Path | Purpose |
|---|---|
| `IE Watch Site/index.html` | Current issue |
| `IE Watch Site/archive/` | Index of all issues |
| `IE Watch Site/issues/<date>-<slug>/` | Permanent URL for each issue |
| `IE Watch Site/port-volumes/` | Monthly POLA + POLB TEU data |
| `IE Watch Site/about/` | Bio, credentials, coverage |
| `IE Watch Site/_headers` | Cache and security headers |
| `IE Watch Site/sitemap.xml` | Submitted to Google Search Console |

## Gotchas worth remembering

- `_redirects` does not work here. Cloudflare Workers static assets reject absolute URLs,
  so the edsmithccim.com redirect is a Redirect Rule on that zone instead.
- workers.dev is deliberately disabled so no duplicate copy of the site gets indexed.
- The lead feature rotates weekly: regulatory deep-dive, submarket spotlight,
  lease economics, trade and supply chain.

Updated automatically each Friday morning.
