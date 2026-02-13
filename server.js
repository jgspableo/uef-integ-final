import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// Blackboard posts LTI launch as application/x-www-form-urlencoded (form_post)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---------------- REQUIRED ENV VARS ----------------
   TOOL_BASE_URL = https://uef-integ-final.onrender.com
   LEARN_HOST = https://mapua-test.blackboard.com   (must be the origin you iframe from)
   REST_KEY / REST_SECRET = REST API integration key/secret
   CLIENT_ID = LTI tool Client ID (UUID)
   PLATFORM_OIDC_AUTH_ENDPOINT = the "OIDC auth request endpoint" shown in Learn tool details
   REDIRECT_URI = https://uef-integ-final.onrender.com/launch
   NF_WIDGET_SRC = your NF widget SDK URL (or whatever you inject into chat.html)
---------------------------------------------------- */

const TOOL_BASE_URL = must("TOOL_BASE_URL");
const LEARN_HOST = must("LEARN_HOST");
const REST_KEY = must("REST_KEY");
const REST_SECRET = must("REST_SECRET");

const CLIENT_ID = must("CLIENT_ID");
const PLATFORM_OIDC_AUTH_ENDPOINT = must("PLATFORM_OIDC_AUTH_ENDPOINT");
const REDIRECT_URI = must("REDIRECT_URI");

const NF_WIDGET_SRC = must("NF_WIDGET_SRC");

const PORTAL_TITLE = process.env.PORTAL_TITLE || "NoodleFactory Chat";

// OIDC state store (in-memory). For production, use a persistent store.
const stateStore = new Map();

/* ---------------- Security headers (iframe) ----------------
   You MUST allow Blackboard to iframe your tool.
*/
app.use((req, res, next) => {
  // include 'self' and the Learn host
  res.setHeader(
    "Content-Security-Policy",
    `frame-ancestors 'self' ${LEARN_HOST};`
  );
  next();
});

/* ---------------- Static ---------------- */
app.use(express.static(path.join(__dirname, "public")));

/* ---------------- Health ---------------- */
app.get("/", (req, res) => {
  res.send("OK: BB UEF NF Widget tool is running");
});

/* ---------------- JWKS ----------------
   Tool JWKS URL (your public keyset) – Blackboard uses this to verify *your* signatures
   if/when you sign things. Serve the generated jwks.json file.
*/
app.get("/jwks.json", (req, res) => {
  const jwksPath = path.join(__dirname, "public", "jwks.json");
  if (!fs.existsSync(jwksPath)) {
    return res
      .status(500)
      .json({ error: "jwks.json not found. Generate it and deploy it." });
  }
  res.sendFile(jwksPath);
});

/* ---------------- LTI 1.3 Login Initiation ----------------
   Learn calls this URL first (GET) with iss/login_hint/target_link_uri (+ optional lti_message_hint)
   Tool must redirect to PLATFORM_OIDC_AUTH_ENDPOINT with required params.
   If lti_message_hint exists, echo it back unmodified. :contentReference[oaicite:3]{index=3}
*/
app.get("/login", (req, res) => {
  const { iss, login_hint, target_link_uri, lti_message_hint } = req.query;

  if (!iss || !login_hint || !target_link_uri) {
    return res
      .status(400)
      .send(
        "Missing required OIDC login initiation params: iss, login_hint, target_link_uri"
      );
  }

  // Create state + nonce
  const state = crypto.randomBytes(16).toString("hex");
  const nonce = crypto.randomBytes(16).toString("hex");

  // Store what the platform wanted to launch
  stateStore.set(state, {
    nonce,
    iss,
    target_link_uri: String(target_link_uri),
    createdAt: Date.now(),
  });

  // Build OIDC auth request
  const params = new URLSearchParams({
    scope: "openid",
    response_type: "id_token",
    response_mode: "form_post",
    prompt: "none",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state,
    nonce,
    login_hint: String(login_hint),
  });

  if (lti_message_hint) {
    // must be forwarded unaltered
    params.set("lti_message_hint", String(lti_message_hint));
  }

  return res.redirect(`${PLATFORM_OIDC_AUTH_ENDPOINT}?${params.toString()}`);
});

/* ---------------- LTI 1.3 Redirect / Launch ----------------
   After OIDC, Learn auto-submits a FORM POST to redirect_uri with:
     - id_token (JWT)
     - state
   :contentReference[oaicite:4]{index=4}

   We accept both GET and POST:
   - POST: real LTI launch
   - GET: manual debugging
*/
app.all("/launch", async (req, res) => {
  try {
    const method = req.method.toUpperCase();

    // LTI form_post payload
    const id_token = req.body?.id_token;
    const state = req.body?.state;

    // Decide which page to show based on original target_link_uri
    let target = null;
    if (state && stateStore.has(state)) {
      target = stateStore.get(state)?.target_link_uri || null;
      // one-time use (optional)
      stateStore.delete(state);
    }

    // If this launch came from a Course Content Tool placement,
    // the platform usually intended to open your “content” UI (chat).
    // If Ultra Extension, you usually want the UEF shim (launch.html).
    const looksLikeChatTarget =
      target && (target.includes("/chat") || target.includes("chat.html"));

    if (method === "POST" && !id_token) {
      return res.status(400).send("Missing id_token in POST /launch");
    }

    if (looksLikeChatTarget) {
      // Serve chat UI (widget page)
      const html = renderTemplate(path.join(__dirname, "public", "chat.html"), {
        NF_WIDGET_SRC,
      });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(html);
    }

    // Default: serve the UEF shim page (launch.html)
    // If you truly need REST token for UEF calls, fetch it here:
    const restToken = await getLearnRestToken(
      LEARN_HOST,
      REST_KEY,
      REST_SECRET
    );

    const html = renderTemplate(path.join(__dirname, "public", "launch.html"), {
      LEARN_HOST,
      REST_TOKEN: restToken,
      TOOL_BASE_URL,
      PORTAL_TITLE,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (e) {
    console.error("Launch failed:", e);
    res.status(500).send("Launch failed: " + (e?.message || String(e)));
  }
});

/* Optional: direct route to chat for manual testing (GET only) */
app.get("/chat", (req, res) => {
  const html = renderTemplate(path.join(__dirname, "public", "chat.html"), {
    NF_WIDGET_SRC,
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

/* ---------------- Start ---------------- */
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on :${port}`));

/* ---------------- helpers ---------------- */

function must(key) {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

function renderTemplate(filePath, vars) {
  let html = fs.readFileSync(filePath, "utf-8");
  for (const [k, v] of Object.entries(vars)) {
    html = html.replaceAll(`%%${k}%%`, escapeHtml(String(v)));
  }
  return html;
}

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Get a Learn REST token using 2-legged OAuth (client_credentials).
 * Token endpoint: /learn/api/public/v1/oauth2/token :contentReference[oaicite:5]{index=5}
 */
async function getLearnRestToken(learnHost, key, secret) {
  const tokenUrl = `${learnHost}/learn/api/public/v1/oauth2/token`;
  const basic = Buffer.from(`${key}:${secret}`).toString("base64");

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`REST token failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  if (!data?.access_token) throw new Error("No access_token in response");
  return data.access_token;
}
