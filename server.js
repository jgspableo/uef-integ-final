import express from "express";
import { jwtVerify, createRemoteJWKSet } from "jose";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Fix for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 10000);

// ==========================================
// 1. CONFIGURATION
// ==========================================
const CONFIG = {
  // Your Application ID from the screenshot
  clientId: "b00d7797-a2f2-4e2f-9159-0056cc3b7da7",

  // Your specific Blackboard OIDC endpoint (Bypassing the global gateway)
  oidcAuthUrl: "https://developer.blackboard.com/api/v1/gateway/oidcauth",

  // Blackboard's public keys
  jwksUrl: "https://developer.blackboard.com/keys/jwks ",

  // The Issuer (always blackboard.com for LTI 1.3)
  iss: "https://blackboard.com",

  // Your hardcoded token for now (Implement real 3LO later)
  restToken: "1p2DFoWoxsVjmOrCHKmMVK5Nou3Ra4DLf",
};

// Middleware to handle form data (LTI Launches are Form POSTs)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Serve static files (public/jwks.json, widget-wrapper.html, etc.)
app.use(express.static("public"));

// ==========================================
// 2. SECURITY HEADERS
// ==========================================
app.use((req, res, next) => {
  // Allow Blackboard to frame your app
  res.setHeader(
    "Content-Security-Policy",
    "frame-ancestors https://*.blackboard.com https://*.blackboardcloud.com;"
  );
  next();
});

// ==========================================
// 3. ROUTES
// ==========================================

// JWKS Endpoint - Required by Blackboard to verify YOUR messages
app.get("/.well-known/jwks.json", (req, res) => {
  const jwksPath = path.join(__dirname, "public", "jwks.json");
  if (fs.existsSync(jwksPath)) {
    res.type("json").send(fs.readFileSync(jwksPath, "utf-8"));
  } else {
    res.status(500).json({ error: "jwks.json not found in /public" });
  }
});

// LTI 1.3 OIDC Login Endpoint
app.get("/login", (req, res) => {
  const { login_hint, target_link_uri } = req.query;

  if (!login_hint) {
    return res.status(400).send("Missing login_hint");
  }

  // Construct the redirect URL to YOUR Blackboard instance
  const authUrl = new URL(CONFIG.oidcAuthUrl);
  authUrl.searchParams.append("response_type", "id_token");
  authUrl.searchParams.append("scope", "openid");
  authUrl.searchParams.append("login_hint", login_hint);
  authUrl.searchParams.append("client_id", CONFIG.clientId);
  authUrl.searchParams.append("redirect_uri", target_link_uri);
  authUrl.searchParams.append("state", "random_state_string"); // In prod, use a unique UUID
  authUrl.searchParams.append("nonce", "random_nonce_string");

  console.log(`[OIDC] Redirecting to: ${authUrl.toString()}`);
  res.redirect(authUrl.toString());
});

// LTI 1.3 Launch Endpoint
app.post("/launch", async (req, res) => {
  const { id_token } = req.body;

  if (!id_token) {
    return res.status(400).send("Missing id_token");
  }

  try {
    // Verify the token sent by Blackboard
    const JWKS = createRemoteJWKSet(new URL(CONFIG.jwksUrl));
    const { payload } = await jwtVerify(id_token, JWKS, {
      issuer: CONFIG.iss,
      audience: CONFIG.clientId,
    });

    console.log("[LTI] Launch successful for user:", payload.sub);

    // Extract Context Data
    const contextClaim =
      payload["https://purl.imsglobal.org/spec/lti/claim/context"] || {};
    const contextId = contextClaim.id || "unknown_course";
    const userId = payload.sub;

    // Return the Bridge HTML
    // This runs inside the hidden iframe and starts the UEF handshake
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>UEF Bridge</title>
        <script>
          // Inject configuration for the frontend script
          window.UEF_CONFIG = {
            restToken: "${CONFIG.restToken}",
            userId: "${userId}",
            courseId: "${contextId}"
          };
        </script>
        <script src="/uef-integration.js"></script>
      </head>
      <body>
        <h1>UEF Bridge Loaded</h1>
      </body>
      </html>
    `);
  } catch (error) {
    console.error("[LTI] Verification Failed:", error.message);
    res.status(401).send("Unauthorized: " + error.message);
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
