# FinSight AI – Build Plan

### Scope and Architecture

- Frontend: Static site on Firebase Hosting (`public/`), Tailwind CSS, vanilla JS.
- Backend: Firebase Cloud Functions (Node.js) for API aggregation + Gemini calls.
- Data: Firestore for simulator (later phase).
- Auth: Firebase Authentication (added in Phase 3).
- External APIs: Alpha Vantage (stocks), CoinGecko (crypto), Gemini (AI).

### Monorepo Layout

- `functions/` (Node.js): Cloud Functions source
- `public/` (HTML/CSS/JS): Hosted site
- `firebase.json`, `.firebaserc`, `README.md`
- `.github/workflows/` (CI/CD)

### Step-by-Step: Start in GitHub (for 2 devs)

1. Create a GitHub org/repo `finsight-ai` (public or private).
2. Add both devs as Collaborators; enable branch protections on `main` (PR required, 1 review).
3. Add repo scaffolding:

- `README.md` with architecture and setup
- `public/index.html`, `public/app.js`, `public/styles.css`
- `functions/package.json` (Node 20), `functions/index.js`
- `firebase.json`, `.firebaserc`, `.gitignore`

4. Create labels (backend, frontend, infra, good-first-task, bug, chore) and PR template `.github/pull_request_template.md`.
5. Branch strategy: feature branches (`feat/…`, `fix/…`), conventional commits, PRs with checks.
6. Add GitHub Actions:

- `ci.yml`: lint + build for functions and public
- `deploy-preview.yml`: optional preview via Firebase emulators (artifact)

### Firebase Setup (once)

- Create Firebase project (Console).
- `firebase init` → select Hosting, Functions, Firestore, Emulators.
- Configure Functions: Node 20, ESM or CJS (use CJS for simplicity).
- Enable Firestore and Authentication in Console (Auth later used).

### Secrets and Config

- Store API keys as Firebase environment config (not in repo):
- `firebase functions:config:set alpha.key=… coingecko.key=… gemini.key=…`
- In CI: use GitHub Encrypted Secrets and a deploy token (`FIREBASE_TOKEN`).
- In code, read via `functions.config()`.

### Minimal MVP (Phase 1–2)

- Backend `getDailyBriefing` function:
- Fetch SPX (Alpha Vantage), BTC/ETH (CoinGecko), lightly summarize with Gemini.
- Return JSON { date, markets: […], summary }.
- Frontend:
- On load, call `getDailyBriefing` and render sections.
- Basic Tailwind layout; show loading and error states.

### Portfolio Simulator (Phase 3)

- Add Auth (Google Sign-In).
- Functions: `buyStock`, `sellStock` (validate auth; write to Firestore under user doc).
- Frontend: simple form and positions table; realtime listeners.

### CI/CD and Deploy

- CI runs lint/build on PRs.
- Deployment via Firebase CLI from `main` after approval:
- `functions` deploy
- `hosting` deploy

### Security & Reliability

- Backend-only API calls (no keys in browser).
- Rate limiting/backoff to vendors; cache latest briefing for X minutes.
- Validate Gemini responses; sanitize HTML.

### Observability

- Cloud Functions logs (structured console.log JSON).
- Basic metrics: request counts, latency, error rates; log sample payload sizes.

### Two-Dev Work Split

- Dev A (Backend/Infra lead): Firebase init, Functions, secrets, CI/CD.
- Dev B (Frontend/UX lead): Tailwind UI, fetch layer, state, rendering.
- Shared: API contract (`/functions/getDailyBriefing` schema), review each other’s PRs.

### Milestones

- Week 0–1: Repo + Firebase init; empty deploy.
- Week 1–2: `getDailyBriefing` end-to-end; deploy v0.
- Week 3–4: UI polish; error/loading; content tuning; caching.
- Week 5–6: Auth + simulator CRUD; Firestore rules; deploy v1.
- Week 7–8: Tests, docs, cleanup; optional preview envs.

### Definition of Done (MVP)

- One-click deploy from `main` passes CI.
- Daily briefing loads <2s (excluding AI), safe content, no secrets in client.
- Docs: setup, env config, run locally, deploy.

### Risks and Mitigations

- API limits: cache responses; stagger calls; fallback text.
- Cost control: meter Gemini usage; switch to cheaper model if needed.
- Security: enforce Auth on functions that touch data; Firestore rules tested.