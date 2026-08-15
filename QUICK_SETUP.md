# Quick Setup

Project `finsight-ai-jd` is already configured. Use this checklist only for a new machine or new collaborator.

## 1. Install

```bash
npm install
cd functions && npm install && cd ..
npx firebase login
npx firebase use finsight-ai-jd
```

## 2. Confirm Google Sign-In

1. Open https://console.firebase.google.com/project/finsight-ai-jd/authentication/providers
2. Ensure **Google** provider is enabled
3. Authorized domains include `finsight-ai-jd.web.app` and `localhost`

## 3. Secrets (production)

Already set in this project. To rotate:

```bash
firebase functions:secrets:set ALPHA_KEY
firebase functions:secrets:set GEMINI_KEY
firebase deploy --only functions
```

## 4. Restrict web API key

Follow [SECURITY_FIX.md](./SECURITY_FIX.md) (HTTP referrers for Hosting + localhost).

## 5. Verify

Open https://finsight-ai-jd.web.app — Mag7 banner, briefing, Explain, Recommend, and Sign-In → portfolio should work.

For day-to-day coding, prefer deploy-and-test against production (see [DEV_SETUP.md](./DEV_SETUP.md)). Emulators need JDK 17+ and do not wire Auth/Firestore on the frontend by default.
