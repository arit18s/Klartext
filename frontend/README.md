# Klartext frontend

Vite + React + TypeScript, Tailwind 3.4 with the tokens from `docs/04_FRONTEND_GUIDELINES.md`. Design source of truth: `docs/Klartext.html`.

```bash
cd frontend
npm install
npm run dev              # http://127.0.0.1:5173, /api is proxied to 127.0.0.1:8000
npm run typecheck
npm run check:fixtures   # fixtures against the API contract
npm run build
```

`.env.development` sets `VITE_USE_FIXTURES=true`: calls, call details and scores come from `src/fixtures` (Stufe2_C09-K3 alarm, Stufe2_C10-K3 no alert, Stufe3_C17-K3 review). Other endpoints need the backend. The API contract is `docs/API_CONTRACT.md`, mirrored in `src/lib/types.ts`.

Layout: `src/app` (routes, sidebar, top bar), `src/pages`, `src/components`, `src/lib` (`api.ts`, `types.ts`, `format.ts`), `src/fixtures`.

shadcn/ui is configured (`components.json`, `src/lib/utils.ts`) for Tailwind 3. Add components when a step needs them: `npx shadcn@2.3.0 add dialog`.
