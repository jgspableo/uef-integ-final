import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

// ✅ put your actual widget URL here (the thing you WANT users to see)
const WIDGET_URL =
  process.env.WIDGET_URL || "https://chatbot.noodlefactory.ai/";

// Serve static if you have any assets
app.use(express.static(path.join(__dirname, "public")));

/**
 * Minimal wrapper page that loads /uef.js.
 * This is what Blackboard loads in the UEF/LTI iframe.
 */
app.get("/widget-wrapper.html", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>NF Widget Wrapper</title>
</head>
<body>
  <!-- This page stays in the iframe; we do NOT try to touch window.top DOM. -->
  <script src="/uef.js" defer></script>
</body>
</html>`);
});

/**
 * ✅ UEF messaging script:
 * - handshake (integration-hello)
 * - authorize (authorization:authorize)
 * - open a portal panel with your widget URL (portal:panel)
 *
 * This avoids cross-origin DOM access (which is why your button was invisible).
 */
app.get("/uef.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");

  res.send(`(() => {
  // -----------------------------
  // Helpers
  // -----------------------------
  function log(...args) { console.log("[UEF]", ...args); }
  function warn(...args) { console.warn("[UEF]", ...args); }
  function err(...args) { console.error("[UEF]", ...args); }

  // Learn origin is usually the referrer origin (Blackboard page embedding this iframe).
  // Example: https://mapua-test.blackboard.com
  let learnOrigin = null;
  try {
    learnOrigin = new URL(document.referrer).origin;
  } catch (_) {
    // If referrer is missing, you can hardcode for debugging, but prefer referrer in prod.
    learnOrigin = null;
  }

  if (!learnOrigin) {
    warn("No document.referrer origin detected. UEF handshake may fail.");
  } else {
    log("Detected Learn origin:", learnOrigin);
  }

  // -----------------------------
  // UEF handshake + channel
  // -----------------------------
  let uefPort = null;

  // Send the hello message to Learn (UEF host).
  // Anthology docs show the integration hello handshake as the entry point to receive a MessagePort. 
  function sendHello() {
    const helloMsg = { type: "integration-hello" };
    // Some environments historically used "integration:hello".
    const helloMsgAlt = { type: "integration:hello" };

    // Target the parent (the Learn page embedding this iframe).
    const target = learnOrigin || "*";

    log("Sending integration hello...");
    window.parent.postMessage(helloMsg, target);

    // Also send the alt type for compatibility
    window.parent.postMessage(helloMsgAlt, target);
  }

  function onWindowMessage(event) {
    // Security: only accept from Learn origin if we have it
    if (learnOrigin && event.origin !== learnOrigin) return;

    const data = event.data || {};
    const t = data.type;

    // Learn responds to hello by providing a MessagePort in event.ports[0]
    if ((t === "integration-hello" || t === "integration:hello") && event.ports && event.ports[0]) {
      uefPort = event.ports[0];
      uefPort.onmessage = onPortMessage;
      log("UEF MessagePort received.");

      authorize();
    }
  }

  function postToUEF(msg) {
    if (!uefPort) return warn("UEF port not ready; cannot post:", msg?.type);
    uefPort.postMessage(msg);
  }

  // -----------------------------
  // Authorization
  // -----------------------------
  function authorize() {
    // Many orgs use a one-time session token from the LTI launch to complete auth flows reliably.
    // But even without it, the portal request below can still work if your tool is configured accordingly.
    // (Do NOT print tokens to console in production.)
    log("Requesting authorization...");

    postToUEF({
      type: "authorization:authorize",
      // Request the permissions needed to open a portal/panel
      // (Exact permissions depend on what surfaces you use)
      permissions: ["portal"]
    });
  }

  // -----------------------------
  // Open a Portal Panel to show your widget
  // -----------------------------
  function openPanel() {
    log("Opening portal panel with widget URL...");

    postToUEF({
      type: "portal:panel",
      title: "NF Widget",
      // An iframe panel pointing to your widget site
      url: ${JSON.stringify(WIDGET_URL)},
      // Optional sizing hints (Learn may enforce its own constraints)
      width: 420
    });
  }

  function onPortMessage(event) {
    const data = event.data || {};
    const t = data.type;

    if (t === "authorization:authorize:response") {
      if (data.authorized === false) {
        err("Authorization denied:", data);
        return;
      }
      log("Authorization OK:", data);
      openPanel();
      return;
    }

    // Helpful for debugging other events
    if (t) log("Port message:", t, data);
  }

  // -----------------------------
  // Boot
  // -----------------------------
  window.addEventListener("message", onWindowMessage);
  sendHello();

  // Retry hello once in case the host wasn’t ready yet
  setTimeout(() => {
    if (!uefPort) sendHello();
  }, 800);

})();`);
});

// Root redirect
app.get("/", (req, res) => res.redirect("/widget-wrapper.html"));

app.listen(PORT, () => {
  console.log(`UEF demo server running on port ${PORT}`);
});
