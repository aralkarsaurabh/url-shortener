# Test Frontend

A small Next.js app in `url-shortener/web` for trying the service by hand. It is a testing tool, not one of the six phases, and it should keep working as each phase lands.

## How to run it

```
docker compose up -d                  # repo root
cd url-shortener && npm start         # API on http://localhost:3000
cd url-shortener/web && npm install && npm run dev   # UI on http://localhost:3001
```

Paste a URL, press Shorten, and click the short link to check the redirect. Links created in the current session are listed with a Copy button.

## Decisions and why

- **Next.js calls `/api/*`, and `next.config.ts` rewrites it to the service.** The browser only talks to its own origin, so there is no CORS and the API needed no changes. The target is set with `BACKEND_URL` (default `http://localhost:3000`).
- **Own folder with its own `node_modules`, not a root workspace.** Next.js has a lot of dependencies and we did not want them mixed into the API packages.
- **Follows the ES feature layout.** `app/` holds only the route. The code is in `features/shortener/` (`components`, `hooks`, `model`, `api`). Only the page component and the hook use `"use client"`, because they need state and click handlers.
- **No Tailwind, no state library.** One page, one list, plain CSS with light and dark colors.
- **The list lives in memory.** It resets on refresh. The database is the source of truth, and the page is only for quick checks.
- **Short links open the service directly** (`localhost:3000/<code>`), so you test the real redirect.

## Checked

- Type check and lint pass.
- Through the proxy: `POST localhost:3001/api/shorten` returned code `3`, an invalid URL returned the `400` message, and the short link returned `302` to the right place.
- Not checked: clicking around in a real browser.
