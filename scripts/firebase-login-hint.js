/**
 * Interactive Firebase CLI login with login_hint, writes tokens to firebase-tools configstore.
 * Usage: node scripts/firebase-login-hint.js mzlatinski@gmail.com
 */
const http = require("http");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");

const email = process.argv[2] || "mzlatinski@gmail.com";
const CLIENT_ID =
  "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";
const SCOPES = [
  "email",
  "openid",
  "https://www.googleapis.com/auth/cloudplatformprojects.readonly",
  "https://www.googleapis.com/auth/firebase",
  "https://www.googleapis.com/auth/cloud-platform",
].join(" ");

const nonce = crypto.randomBytes(20).toString("hex");
const configPath = path.join(
  process.env.USERPROFILE || process.env.HOME,
  ".config",
  "configstore",
  "firebase-tools.json"
);
const urlOut = path.join(process.env.TEMP || "/tmp", "fb-auth-url.txt");
const statusOut = path.join(process.env.TEMP || "/tmp", "fb-auth-status.txt");

function getPort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

async function main() {
  const port = await getPort();
  const redirectUri = `http://localhost:${port}`;
  const authUrl =
    "https://accounts.google.com/o/oauth2/auth?" +
    new URLSearchParams({
      client_id: CLIENT_ID,
      scope: SCOPES,
      response_type: "code",
      state: nonce,
      redirect_uri: redirectUri,
      login_hint: email,
      prompt: "select_account",
    }).toString();

  fs.writeFileSync(urlOut, authUrl, "utf8");
  fs.writeFileSync(statusOut, "WAITING\n", "utf8");
  console.log("AUTH_URL=" + authUrl);
  console.log("Open the URL above and sign in as " + email);

  const tokens = await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const u = new URL(req.url, redirectUri);
        if (u.pathname !== "/") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const code = u.searchParams.get("code");
        const state = u.searchParams.get("state");
        const err = u.searchParams.get("error");
        if (err) throw new Error(err);
        if (!code || state !== nonce) throw new Error("Invalid OAuth response");

        const body = new URLSearchParams({
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        });
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
        const json = await tokenRes.json();
        if (!json.access_token) throw new Error(JSON.stringify(json));

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<h1>Firebase login success</h1><p>You can close this tab and return to Cursor.</p>"
        );
        server.close();
        resolve(json);
      } catch (e) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(String(e.message || e));
        server.close();
        reject(e);
      }
    });
    server.listen(port, "127.0.0.1");
    // Try open system browser too
    const start =
      process.platform === "win32"
        ? `start "" "${authUrl}"`
        : process.platform === "darwin"
          ? `open "${authUrl}"`
          : `xdg-open "${authUrl}"`;
    exec(start);
  });

  // Decode id_token payload for user email
  let user = { email };
  if (tokens.id_token) {
    try {
      const payload = JSON.parse(
        Buffer.from(tokens.id_token.split(".")[1], "base64url").toString()
      );
      user = payload;
    } catch (_) {}
  }

  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (_) {}
  cfg.usage = false;
  cfg.gemini = false;
  cfg.user = user;
  cfg.tokens = {
    ...tokens,
    expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
    scopes: SCOPES.split(" "),
  };
  cfg.activeProjects = cfg.activeProjects || {};
  cfg.activeProjects["."] = "finsight-ai-jd";

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, "\t"));
  fs.writeFileSync(statusOut, "OK\n" + (user.email || email) + "\n", "utf8");
  console.log("LOGIN_OK email=" + (user.email || email));
}

main().catch((e) => {
  fs.writeFileSync(statusOut, "FAIL\n" + String(e.message || e) + "\n", "utf8");
  console.error(e);
  process.exit(1);
});
