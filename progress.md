# Progress Log - FinSight AI

## Done
- Installed Firebase CLI (14.22.0) and verified on Windows PowerShell.
- Created Firebase project: `finsight-ai-jd` (Blaze with $5 budget alerts).
- Enabled Firestore (Standard edition), Production mode, region `us-east4`.
- Added Firebase config to repo: `.firebaserc`, `firebase.json`, `firestore.rules`, `firestore.indexes.json`.
- Scaffolded Cloud Functions (Node 20, CommonJS, v2): `functions/package.json`, deps installed.
- Implemented `helloWorld` function in `us-east4` and Hosting rewrite to `/api/hello`.
- Updated frontend (`public/index.html`, `public/app.js`) with a test button to call `/api/hello`.
- Opened PRs:
  - infra/firebase-init
  - feat/hello-world-function
- Hosting emulator successfully served `public/` at `http://127.0.0.1:5000`.

## In Progress / Issues
- Functions emulator not starting: CLI reports "No emulators to start" even after `firebase init emulators`.
- Firestore emulator requires Java; JDK not yet installed (`java -version` missing).

## Next Steps
1. Fix Functions emulator start
   - Re-run: `firebase init emulators` → ensure Functions + Hosting are selected; Emulator UI = Yes.
   - Verify `firebase.json` contains `emulators.functions` and `emulators.hosting` (present).
   - Start with debug to see root cause: `firebase --debug emulators:start --only functions`.
   - Update CLI to latest: `npm i -g firebase-tools` (then re-try start).
2. Optional: Enable Firestore emulator
   - Install JDK 17 (Adoptium Temurin), ensure `java -version` works.
   - Start all: `firebase emulators:start`.
3. Unblock testing via cloud deploy (optional now)
   - Deploy: `firebase deploy --only functions:helloWorld`
   - Test URL: `https://us-east4-finsight-ai-jd.cloudfunctions.net/helloWorld`.

## Notes
- Ports 5000/5001/4000 are free; Hosting emulator runs fine.
- Some earlier commands showed "Command was interrupted"—open a fresh terminal and re-run to avoid partial starts.

