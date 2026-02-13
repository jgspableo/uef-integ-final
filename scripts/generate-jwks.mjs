import fs from "fs";
import path from "path";
import crypto from "crypto";
import { generateKeyPair, exportJWK, exportPKCS8 } from "jose";

const keysDir = path.join(process.cwd(), "keys");
const publicDir = path.join(process.cwd(), "public");

fs.mkdirSync(keysDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

const kid = crypto.randomBytes(8).toString("hex");

const { publicKey, privateKey } = await generateKeyPair("RS256", {
  modulusLength: 2048,
});

const jwk = await exportJWK(publicKey);
jwk.use = "sig";
jwk.alg = "RS256";
jwk.kid = kid;

const jwks = { keys: [jwk] };

// NOTE: We keep private key as PEM for later (if you add LTI services)
const pkcs8 = await exportPKCS8(privateKey);

fs.writeFileSync(path.join(keysDir, "private.pem"), pkcs8, "utf-8");
fs.writeFileSync(
  path.join(publicDir, "jwks.json"),
  JSON.stringify(jwks, null, 2),
  "utf-8"
);

console.log("✅ Generated:");
console.log(" - keys/private.pem (SECRET, do not commit)");
console.log(" - public/jwks.json (serve publicly at /jwks.json)");
