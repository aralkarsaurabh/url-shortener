# Test Frontend

A small Next.js app in `url-shortener/web` for trying the service by hand. It is a testing tool, not one of the six phases, and it should keep working as each phase lands.

## How to run it

```
docker compose up -d                  # repo root
cd url-shortener && npm start         # API on http://localhost:3302
cd url-shortener/web && npm install && npm run dev   # UI on http://localhost:3301
```

Paste a URL, press Shorten, and click the short link to check the redirect. Links created in the current session are listed with a Copy button.

## Decisions and why

- **Next.js calls `/api/*`, and `next.config.ts` rewrites it to the service.** The browser only talks to its own origin, so there is no CORS and the API needed no changes. The target is set with `BACKEND_URL` (default `http://localhost:3302`).
- **Own folder with its own `node_modules`, not a root workspace.** Next.js has a lot of dependencies and we did not want them mixed into the API packages.
- **Follows the ES feature layout.** `app/` holds only the route. The code is in `features/shortener/` (`components`, `hooks`, `model`, `api`). Only the page component and the hook use `"use client"`, because they need state and click handlers.
- **No Tailwind, no state library.** One page, one list, plain CSS with light and dark colors.
- **The list lives in memory.** It resets on refresh. The database is the source of truth, and the page is only for quick checks.
- **Short links open the service directly** (`localhost:3302/<code>`), so you test the real redirect.

## Checked

- Type check and lint pass.
- Through the proxy: `POST localhost:3301/api/shorten` returned code `3`, an invalid URL returned the `400` message, and the short link returned `302` to the right place.
- Not checked: clicking around in a real browser.

## Workflow page (the home page)

The home page is an n8n-style canvas in `web/features/workflow/`. Two workflows, switched with the tabs at the top:

- **Shorten a URL:** Manual Trigger, Rate Limit Check, Validate Request, Decide the code (random number, Base62), Save the link (code filter, Postgres INSERT, clear cache), Response.
- **Open a short link:** Manual Trigger, Rate Limit Check, Code Filter, Find the URL (Redis, Postgres, fill cache), Count the click (Redis, batch save), Redirect.

Saving in the trigger dialog starts the workflow. The answer opens by itself (or the step that failed).

- **One real request per run.** The page also reads `/debug/counters` and `/debug/code/:code` before and after (they need `ENABLE_DEBUG=true`), so each step shows what really happened: cache hit or miss, a database read, the row now in Postgres, clicks waiting in Redis. The steps then light up one after the other; the timing is for watching, the outcomes are real.
- **Exploded view** (top right) opens the grouped steps into their parts, for example the code step into "pick a number" and "turn it into Base62", with the real code taken apart.
- **Open a short link** goes through `app/trace/visit/[code]/route.ts`, because a browser hides a redirect's address.
- The UI runs on port 3301; the services are 3302 (shortener), 3303 (rate limiter), 3304 (load balancer). `npm run system-design` starts everything.

## Exporting for LinkedIn

All pictures are drawn on a canvas in the browser (`web/features/workflow/lib/export*.ts`), so no library or server is needed. They use the colours of the current theme and are 2x size, so they stay sharp when LinkedIn shrinks them.

- **Export PNG** (top right): the whole workflow as one picture, including steps off screen, in the current view (normal or exploded). Long workflows wrap into rows that snake left to right, then right to left, with numbered steps.
- **Export PNG in every step's dialog:** one picture of that step with what it does and what it returned in this run (the real numbers, headers, rows and answers). The final answer dialog has it too.
- **Export ZIP** (top right, after a run): `url-shortener-<workflow>.zip` with `00-workflow.png`, `00-workflow-exploded.png`, a `steps/` folder with one picture for each step, and `caption.txt`, a draft post listing the real steps to edit before posting. The ZIP is written by `lib/zip.ts`, a small writer with no compression, since PNGs are already compressed.
- Run the workflow first for pictures that show a real run. Before a run the pictures show the explanations only.
