# 🚀 Quick Setup - Portfolio Feature

## What You Need to Do (5 minutes)

### Step 1: Get Firebase Config (2 minutes)

1. **Open this link in your browser:**
   https://console.firebase.google.com/project/finsight-ai-jd/settings/general

2. **Scroll down** to find **"Your apps"** section

3. **Click the Web icon** (`</>`) - it looks like this: `</>`

4. **Fill in the form:**
   - App nickname: `FinSight AI Web`
   - ✅ Check "Also set up Firebase Hosting" (optional)
   - Click **Register app**

5. **Copy the config** - You'll see something like this:
   ```javascript
   const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "finsight-ai-jd.firebaseapp.com",
     projectId: "finsight-ai-jd",
     storageBucket: "finsight-ai-jd.appspot.com",
     messagingSenderId: "99481735828",
     appId: "1:99481735828:web:abc123..."
   };
   ```

6. **Send me these 2 values:**
   - `apiKey` (starts with "AIzaSy...")
   - `appId` (starts with "1:99481735828:web:...")

   **OR** copy the entire config and I'll update it for you!

### Step 2: Enable Google Sign-In (1 minute)

1. **Open this link:**
   https://console.firebase.google.com/project/finsight-ai-jd/authentication

2. Click **Get Started** (if you see it)

3. Click **Sign-in method** tab

4. Click **Google**

5. **Toggle it ON** (Enable)

6. Set:
   - Project support email: (your email)
   - Project public-facing name: `FinSight AI`

7. Click **Save**

### Step 3: I'll Update the Code

Once you give me the `apiKey` and `appId`, I'll:
- ✅ Update `public/index.html` with your config
- ✅ Deploy the updated code
- ✅ Test it for you

## That's It! 🎉

After I update the code, you'll be able to:
- Sign in with Google
- See your $10,000 starting balance
- Buy and sell stocks
- Track your portfolio in real-time

---

## Need Help?

Just tell me:
1. The `apiKey` value
2. The `appId` value

And I'll handle the rest! 🚀

