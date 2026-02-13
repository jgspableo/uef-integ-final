import express from "express";
import { jwtVerify, createRemoteJWKSet } from "jose";
import fs from "fs";
import path from "path";

const app = express();
const PORT = Number(process.env.PORT || 10000);

// Configuration
const CONFIG = {
  clientId: "b00d7797-a2f2-4e2f-9159-0056cc3b7da7", // From Blackboard Dev Portal
  iss: "https://blackboard.com",
  jwksUrl: "https://developer.anthology.com/api/v1/jwks/bb-blearn-1004.json", // Public keys from Blackboard
  restToken: "lp2DFoWoxsVjmOrCHkMVK5Nou3Ra4DLf", // In prod, swap this for real 3LO
};

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

// Security Headers [cite: 389, 390]
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", "frame-ancestors https://*.blackboard.com https://*.blackboardcloud.com;");
  res.setHeader("X-Frame-Options", "ALLOW-FROM https://blackboard.com");
  next();
});

// 1. JWKS Endpoint (Required for LTI) [cite: 73]
app.get("/.well-known/jwks.json", (req, res) => {
  const jwks = fs.readFileSync(path.join(process.cwd(), "public/jwks.json"), "utf-8");
  res.type("json").send(jwks);
});

// 2. OIDC Login Route [cite: 143]
app.get("/login", (req, res) => {
  const { iss, login_hint, target_link_uri } = req.query;
  const state = "random_state_string"; // In prod, use crypto.randomUUID()
  const nonce = "random_nonce_string"; 
  
  // Construct redirect to Blackboard's Auth Endpoint
  const authUrl = new URL("https://developer.anthology.com/api/v1/gateway/oidc/auth");
  authUrl.searchParams.append("response_type", "id_token");
  authUrl.searchParams.append("scope", "openid");
  authUrl.searchParams.append("login_hint", login_hint);
  authUrl.searchParams.append("client_id", CONFIG.clientId);
  authUrl.searchParams.append("redirect_uri", target_link_uri); // Should point to /launch
  authUrl.searchParams.append("state", state);
  authUrl.searchParams.append("nonce", nonce);

  res.redirect(authUrl.toString());
});

// 3. LTI Launch Route [cite: 150, 151]
app.post("/launch", async (req, res) => {
  const {Tk, state} = req.body;
  
  try {
    // Verify Token (Simplified) [cite: 154, 157]
    const JWKS = createRemoteJWKSet(new URL(CONFIG.jwksUrl));
    const { payload } = await jwtVerify(id_token, JWKS, {
      issuer: CONFIG.iss,
      audience: CONFIG.clientId,
    });

    const contextId = payload["https://purl.imsglobal.org/spec/lti/claim/context"]?.id;
    const userId = payload.sub;

    // Render the Bridge HTML [cite: 171, 182]
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>NoodleFactory UEF Bridge</title>
        <script src="/uef-integration.js"></script>
        <script>
          // Inject configuration for the frontend bridge
          window.UEF_CONFIG = {
            restToken: "${CONFIG.restToken}",
            userId: "${userId}",
            courseId: "${contextId}"
          };
        </script>
      </head>
      <body></body>
      </html>
    `);
  } catch (error) {
    console.error("Launch Error:", error);
    res.status(401).send("Unauthorized LTI Launch");
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));