# Deploy — Vercel (frontend) + Render (backend), no Docker

Push to the default branch → both redeploy automatically.

```
GitHub repo ──┬─▶ Vercel  →  apps/web  (static Vite SPA)      https://<app>.vercel.app
              └─▶ Render  →  apps/api  (Node web service)     https://<api>.onrender.com
```

- Backend runs in **local mode** (serves `sample-data/` DICOM; no Orthanc).
- Dashboard "database" is JSON files under `data/` — **ephemeral** on Render free
  (resets on redeploy; deterministic seed rebuilds the ~144 cases, edits are lost).
- Render free sleeps after 15 min idle → first hit after that is a ~40 s cold start.

---

## One-time setup

### 1. Backend on Render

1. https://dashboard.render.com → **New +** → **Blueprint**.
2. Connect the GitHub repo. Render reads [`render.yaml`](../render.yaml) and
   proposes **radiolinq-api** (Node, free). **Apply**.
3. Wait for the first deploy. Health check: `GET /api/health` → `{"status":"ok"}`.
4. Copy the service URL, e.g. `https://radiolinq-api.onrender.com`.

(Manual alternative, no blueprint: New + → **Web Service** → repo →
Root Directory `apps/api`, Build `npm install --include=dev && npm run build`,
Start `node dist/main.js`, Health check path `/api/health`, plan Free.)

### 2. Frontend on Vercel

1. https://vercel.com/new → import the same GitHub repo.
2. **Root Directory: `apps/web`** (Framework auto-detects as Vite; leave build =
   `npm run build`, output = `dist`). [`apps/web/vercel.json`](../apps/web/vercel.json)
   adds the SPA rewrite.
3. **Environment Variables** → add:

   | Name | Value |
   |---|---|
   | `VITE_API_BASE` | `https://radiolinq-api.onrender.com` (your Render URL, no trailing slash) |

4. **Deploy.** Open the Vercel URL → Cases dashboard.

### 3. Lock CORS (optional, after both are up)

Render → radiolinq-api → Environment → set `CORS_ORIGIN` to your Vercel URL
(e.g. `https://radiolinq.vercel.app`) → save (redeploys).

---

## Everyday flow

```
git add -A && git commit -m "…" && git push
```

- Vercel rebuilds `apps/web` and ships the new frontend (~1 min).
- Render rebuilds `apps/api` and restarts (~2–3 min; `autoDeploy: true`).

Change `VITE_API_BASE` only if the Render URL changes.

## Notes / limits

- **Cold start:** the first request after 15 min idle spins for ~40 s (Render free).
- **Data resets** on every Render deploy/restart. For persistence, replace the
  JSON store (`apps/api/src/store/json-store.ts`) with Postgres — Neon / Supabase
  both have a free tier; the store is the only file that touches persistence.
- **Bandwidth:** opening the MRI in MPR downloads all 384 slices (~80 MB) to the
  browser. Fine for demos; trim `sample-data/mri/` if you want it lighter.
- **No PHI** on a free tier — the committed sample set is public de-identified data.
- **Custom domain:** add it in Vercel (frontend) and, if you proxy, update
  `CORS_ORIGIN` on Render.
