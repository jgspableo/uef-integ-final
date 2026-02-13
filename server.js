import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const TOOL_BASE_URL = must("TOOL_BASE_URL");
const LEARN_HOST = must("LEARN_HOST");
const REST_KEY = must("REST_KEY");
const REST_SECRET = must("REST_SECRET");

const PORTAL_TITLE = process.env.PORTAL_TITLE || "NoodleFactory Chat";
const NF_WIDGET_SRC = must("NF_WIDGET_SRC");

// --- Security headers: allow Learn to iframe your tool ---
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", `frame-ancestors ${LEARN_HOST};`);
  next();
});

// --- Static ---
app.use(express.static(path.join(__dirname, "public")));

// Health
app.get("/", (req, res) => {
  res.send("OK: BB UEF NF Widget tool is running");
});

// Serve JWKS (generated into /public/jwks.json)
app.get("/jwks.json", (req, res) => {
  const jwksPath = path.join(__dirname, "public", "jwks.json");
  if (!fs.existsSync(jwksPath)) {
    return res
      .status(500)
      .json({ error: "jwks.json not found. Run: npm run gen:jwks" });
  }
  res.sendFile(jwksPath);
});

/**
 * LTI Tool "Launch" URL
 * Blackboard will open this in an iframe and pass launch params as query string.
 * We do NOT implement full LTI validation here because your immediate blocker is UEF.
 * (You can add LTI id_token validation later if needed.)
 */
app.all("/launch", async (req, res) => {
  try {
    const restToken = await getLearnRestToken(
      LEARN_HOST,
      REST_KEY,
      REST_SECRET
    );

    // Render launch.html with injected values
    const html = renderTemplate(path.join(__dirname, "public", "launch.html"), {
      LEARN_HOST,
      REST_TOKEN: restToken,
      TOOL_BASE_URL,
      PORTAL_TITLE,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (e) {
    console.error("Launch failed:", e);
    res.status(500).send("Launch failed: " + (e?.message || String(e)));
  }
});

// Start
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
 * Learn REST integrations commonly use:
 * POST {learnHost}/learn/api/public/v1/oauth2/token
 * Authorization: Basic base64(key:secret)
 * body: grant_type=client_credentials
 *
 * This is consistent with Learn REST examples and integration docs. :contentReference[oaicite:9]{index=9}
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
