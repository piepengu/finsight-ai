# Restrict Firebase Web API Key (GCP)

Run after `gcloud auth login` (account with access to project `finsight-ai-jd`).

```powershell
# From repo root
./scripts/restrict-firebase-web-key.ps1
```

Or manually in Console:

1. Open https://console.cloud.google.com/apis/credentials?project=finsight-ai-jd
2. Edit the Browser key used by the web app (see `apiKey` in `public/index.html`)
3. Application restrictions → HTTP referrers:
   - `https://finsight-ai-jd.web.app/*`
   - `https://finsight-ai-jd.firebaseapp.com/*`
   - `http://localhost:*`
   - `http://127.0.0.1:*`
4. API restrictions → Restrict key to:
   - Identity Toolkit API
   - Token Service API
   - Cloud Firestore API
   - Firebase Installations API
5. Save

This does not hide the key (browser keys are public) — it limits which sites and APIs can use it.
