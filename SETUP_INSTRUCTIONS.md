# 📋 Setup Instructions - Copy & Paste Ready

## Step 1: Get Firebase Config (2 minutes)

**Open this URL:**
```
https://console.firebase.google.com/project/finsight-ai-jd/settings/general
```

1. Scroll down to **"Your apps"** section
2. Click the **Web icon** (`</>`)
3. App nickname: `FinSight AI Web`
4. Click **Register app**
5. **Copy the entire config block** that appears

It will look like this:
```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "finsight-ai-jd.firebaseapp.com",
  projectId: "finsight-ai-jd",
  storageBucket: "finsight-ai-jd.appspot.com",
  messagingSenderId: "99481735828",
  appId: "1:99481735828:web:..."
};
```

**Just copy the `apiKey` and `appId` values and tell me!**

Example:
- apiKey: `AIzaSyABC123...`
- appId: `1:99481735828:web:xyz789...`

## Step 2: Enable Google Sign-In (1 minute)

**Open this URL:**
```
https://console.firebase.google.com/project/finsight-ai-jd/authentication
```

1. Click **Get Started** (if shown)
2. Click **Sign-in method** tab
3. Click **Google**
4. Toggle **Enable**
5. Set Project support email
6. Click **Save**

## Step 3: Tell Me the Values

Just reply with:
```
apiKey: AIzaSy...
appId: 1:99481735828:web:...
```

And I'll update everything and deploy! 🚀

