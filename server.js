import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import crypto from "crypto";
import dotenv from "dotenv";
import { createRemoteJWKSet, jwtVerify } from "jose";

dotenv.config();

const app = express();

// Blackboard posts LTI launch as application/x-www-form-urlencoded (form_post)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---------------- REQUIRED ENV VARS ---------------- */
const TOOL_BASE_URL = must("TOOL_BASE_URL"); // e.g. https://uef-integ-final.onrender.com
const LEARN_HOST = must("LEARN_HOST"); // e.g. https://mapua-test.blackboard.com

// LTI platform values (from Blackboard/Anthology app details)
const CLIENT_ID = must("CLIENT_ID");
const PLATFORM_OIDC_AUTH_ENDPOINT = must("PLATFORM_OIDC_AUTH_ENDPOINT");
const PLATFORM_ISSUER = must("PLATFORM_ISSUER");
const PLATFORM_JWKS_URL = must("PLATFORM_JWKS_URL");
const REDIRECT_URI = must("REDIRECT_URI"); // must match exactly what you registered

// NF widget
const NF_WIDGET_SRC = must("NF_WIDGET_SRC");

// Optional (UEF shim / REST token usage)
const REST_KEY = process.env.REST_KEY || "";
const REST_SECRET = process.env.REST_SECRET || "";

// Optional (cosmetics / UEF registration)
const PORTAL_TITLE = process.env.PORTAL_TITLE || "NoodleFactory Chat";
const LTI_PLACEMENT_HANDLE = process.env.LTI_PLACEMENT_HANDLE || "";

// Remote JWKS fetcher for platform signature verification
const PLATFORM_JWKS = createRemoteJWKSet(new URL(PLATFORM_JWKS_URL));

// OIDC state store (in-memory). For production, use Redis/DB.
const stateStore = new Map();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [state, rec] of stateStore.entries()) {
    if (now - rec.createdAt > STATE_TTL_MS) stateStore.delete(state);
  }
}, 60 * 1000);

/* ---------------- Security headers (iframe) ---------------- */
app.use((req, res, next) => {
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
  res.send("OK: BB LTI/UEF NF tool is running");
});

/* ---------------- JWKS (your tool public keyset) ---------------- */
app.get("/jwks.json", (req, res) => {
  const jwksPath = path.join(__dirname, "public", "jwks.json");
  if (!fs.existsSync(jwksPath)) {
    return res.status(500).json({
      error: "jwks.json not found. Generate it and redeploy.",
    });
  }
  res.sendFile(jwksPath);
});

/* ---------------- LTI 1.3 Login Initiation ---------------- */
app.get("/login", (req, res) => {
  const { iss, login_hint, target_link_uri, lti_message_hint } = req.query;

  if (!iss || !login_hint || !target_link_uri) {
    return res
      .status(400)
      .send(
        "Missing required OIDC login initiation params: iss, login_hint, target_link_uri"
      );
  }

  const state = crypto.randomBytes(16).toString("hex");
  const nonce = crypto.randomBytes(16).toString("hex");

  stateStore.set(state, {
    nonce,
    iss: String(iss),
    target_link_uri: String(target_link_uri),
    createdAt: Date.now(),
  });

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

  if (lti_message_hint)
    params.set("lti_message_hint", String(lti_message_hint));

  return res.redirect(`${PLATFORM_OIDC_AUTH_ENDPOINT}?${params.toString()}`);
});

/* ---------------- LTI 1.3 Launch (redirect_uri) ---------------- */
app.all("/launch", async (req, res) => {
  try {
    const method = req.method.toUpperCase();

    // Real LTI launch is POST form_post
    const id_token = req.body?.id_token;
    const state = req.body?.state;

    // Allow GET for manual debugging
    if (method === "GET") {
      // If you open /launch directly in browser, show a selected mode (defaults to chat)
      const mode = req.query.mode || "chat";
      return serveMode({ mode, req, res, restToken: "" });
    }

    if (!id_token || !state) {
      return res.status(400).send("Missing id_token or state in POST /launch");
    }

    const stateRec = stateStore.get(state);
    if (!stateRec) {
      return res.status(400).send("Invalid/expired state");
    }
    stateStore.delete(state);

    // Verify JWT signature + issuer + audience
    const { payload } = await jwtVerify(id_token, PLATFORM_JWKS, {
      issuer: PLATFORM_ISSUER,
      audience: CLIENT_ID,
    });

    // Verify nonce matches what we generated
    if (!payload?.nonce || payload.nonce !== stateRec.nonce) {
      return res.status(400).send("Nonce mismatch");
    }

    // Decide mode based on target_link_uri OR explicit mode param
    let mode = "chat";
    try {
      const u = new URL(stateRec.target_link_uri);
      mode = u.searchParams.get("mode") || "chat";
    } catch {
      // ignore parse errors
    }

    // REST token only needed for UEF scenario
    let restToken = "";
    if (mode === "uef") {
      if (!REST_KEY || !REST_SECRET) {
        throw new Error("UEF mode requires REST_KEY and REST_SECRET env vars.");
      }
      restToken = await getLearnRestToken(LEARN_HOST, REST_KEY, REST_SECRET);
    }

    return serveMode({ mode, req, res, restToken });
  } catch (e) {
    console.error("Launch failed:", e);
    res.status(500).send("Launch failed: " + (e?.message || String(e)));
  }
});

function serveMode({ mode, req, res, restToken }) {
  if (mode === "uef") {
    const html = renderTemplate(path.join(__dirname, "public", "launch.html"), {
      LEARN_HOST,
      TOOL_BASE_URL,
      PORTAL_TITLE,
      REST_TOKEN: restToken,
      LTI_PLACEMENT_HANDLE,
      // Use LTI launch again for opening the widget (so it always works inside Learn)
      CHAT_LAUNCH_URL: `${TOOL_BASE_URL}/launch?mode=chat`,
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  }

  // Default: show widget page
  const html = renderTemplate(path.join(__dirname, "public", "chat.html"), {
    NF_WIDGET_SRC,
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(html);
}

/* Optional direct route (debug only) */
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

// IMPORTANT: this must be a REAL HTML escape (your old version was broken)
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Learn REST token (client_credentials):
 * POST {learnHost}/learn/api/public/v1/oauth2/token
 * Authorization: Basic base64(key:secret)
 * body: grant_type=client_credentials
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
