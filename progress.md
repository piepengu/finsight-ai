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
- **Deployed `helloWorld` function to cloud and tested successfully!**
  - Function URL: `https://us-east4-finsight-ai-jd.cloudfunctions.net/helloWorld`
  - Response: `{"ok": true, "message": "Hello from FinSight AI (us-east4)!"}`

## In Progress / Issues
- Functions emulator not starting locally (CLI reports "No emulators to start").
- Firestore emulator requires Java; JDK not yet installed.
- **Workaround:** Using cloud-deployed functions for testing.

## Next Steps
1. **Get API keys** for:
   - Alpha Vantage (stocks): https://www.alphavantage.co/support/#api-key
   - CoinGecko (crypto): https://www.coingecko.com/en/api
   - Google Gemini (AI): https://aistudio.google.com/app/apikey

2. **Store API keys securely** (do NOT commit keys):
   ```bash
   firebase functions:config:set alpha.key="YOUR_KEY" coingecko.key="YOUR_KEY" gemini.key="YOUR_KEY"
   ```

3. **Build `getDailyBriefing` function** that:
   - Fetches S&P 500 data from Alpha Vantage
   - Fetches BTC/ETH prices from CoinGecko
   - Sends data to Gemini for AI summary
   - Returns JSON to the frontend

4. **Update frontend** to call `/api/briefing` and display the AI response

5. **Optional: Fix local emulators**
   - Install JDK 17 (Adoptium Temurin) for Firestore emulator
   - Debug Functions emulator startup issue

## Notes
- Cloud deployment is working; can test functions immediately at production URLs.
- Ports 5000/5001/4000 are free; Hosting emulator runs fine standalone.
- Node 20 runtime; using CommonJS for simplicity.


