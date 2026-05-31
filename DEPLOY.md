# Deploying Job Tracker (with the API key kept secret)

Your secret (`ANTHROPIC_API_KEY`) is **never** committed. It lives in the host's
encrypted secret store and is injected as an environment variable at runtime.
`server/server.js` reads `process.env.ANTHROPIC_API_KEY`, so no code change is
needed between local and cloud.

---

## Option A — Render (simplest)

1. Push this repo to GitHub (already done).
2. Render dashboard → **New +** → **Blueprint** → select this repo.
   Render reads `render.yaml` and creates the web service.
3. When prompted (because `sync: false`), paste your key into
   **ANTHROPIC_API_KEY**. It is stored as an encrypted secret, not in the repo.
4. Deploy. Your app is at `https://<name>.onrender.com`.
   `AI_MODEL` is preset; `PORT` is provided by Render automatically.

To add/rotate the key later: service → **Environment** → edit `ANTHROPIC_API_KEY` → save (auto-redeploys).

> Free plan sleeps when idle and wakes on the next request (first hit is slow).

---

## Option B — Fly.io

1. Install the CLI and log in: `fly auth login`.
2. Edit `fly.toml`: set a unique `app` name and a `primary_region`.
3. Create the app (uses the included `Dockerfile`): `fly launch --no-deploy --copy-config`.
4. Store the key as an encrypted secret (NOT in any file):
   ```
   fly secrets set ANTHROPIC_API_KEY=sk-ant-xxxxx
   ```
   (optionally) `fly secrets set AI_MODEL=claude-haiku-4-5-20251001`
5. Deploy: `fly deploy`.
6. Open it: `fly open`.

Rotate later: `fly secrets set ANTHROPIC_API_KEY=...` (triggers a rolling restart).
List names (values hidden): `fly secrets list`.

---

## How the key is loaded (precedence)

`server/server.js`:
- In the cloud, the platform sets `process.env.ANTHROPIC_API_KEY` → used directly.
- Locally, the tiny `.env` loader fills it **only if not already set**, so a real
  env var always wins and `.env` is just dev convenience.

`GET /api/ai/health` returns `{ai:true}` once the key is present — the UI then
reveals the ✨ AI buttons.

## Other sensitive vars

Add any future secret (DB URL, other API keys) the same way: declare it in
`render.yaml` with `sync: false` (Render) or `fly secrets set NAME=value` (Fly),
then read `process.env.NAME` in the server. Keep them out of git via `.gitignore`.

## Note on the daily fetch

`.github/workflows/daily-fetch.yml` runs on GitHub and commits
`data/jobs-feed.json`. With Render `autoDeploy: true`, that push redeploys the
app so "Daily picks" stays fresh. On Fly, run `fly deploy` (or add a deploy step
to the workflow) to pick up the new feed.
