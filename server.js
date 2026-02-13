// server.js
import express from "express";

const app = express();
app.disable("x-powered-by");

const PORT = Number(process.env.PORT || 10000);
const HOST = process.env.HOST || "0.0.0.0";

/* =========================
   NF widget config
========================= */
const NF_WIDGET_ID = (process.env.NF_WIDGET_ID || "").trim();
const NF_WIDGET_SCRIPT_URL = (process.env.NF_WIDGET_SCRIPT_URL || "").trim();

function getNfWidgetScriptUrl() {
  if (NF_WIDGET_SCRIPT_URL) return NF_WIDGET_SCRIPT_URL;
  if (!NF_WIDGET_ID) return "";
  return `https://portalapi.noodlefactory.ai/api/v1/widget/widget-sdk/${NF_WIDGET_ID}/widget.js`;
}

/* =========================
   UEF auth config
========================= */
// TEMP: Put a real Learn 3LO *user* access token here.
// In production, implement full OAuth2 exchange and store per-user tokens.
const UEF_USER_TOKEN = (process.env.UEF_USER_TOKEN || "").trim();

/* =========================
   Basic headers for embedding
========================= */
app.use((req, res, next) => {
  // Avoid stale JS while debugging
  res.setHeader("Cache-Control", "no-store");

  // Allow Blackboard to iframe this site (adjust domains if needed)
  // NOTE: If you later add stricter CSP, keep frame-ancestors.
  res.setHeader(
    "Content-Security-Policy",
    "frame-ancestors https://*.blackboard.com https://*.blackboard.com:* https://*.blackboardcloud.com https://*.blackboardcloud.com:*;"
  );

  next();
});

// serve /public files (put widget-wrapper.html here)
app.use(express.static("public", { extensions: ["html"] }));

app.get("/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

/**
 * Minimal token endpoint used by /uef.js
 * IMPORTANT: In production, do NOT expose tokens like this.
 */
app.get("/uef/access-token", (req, res) => {
  if (!UEF_USER_TOKEN) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing UEF_USER_TOKEN. Implement 3LO and return a real per-user bearer token.",
    });
  }
  res.json({ ok: true, token: UEF_USER_TOKEN });
});

/**
 * Integration entry page.
 * UEF should load an iframe pointing here.
 *
 * We set window.__lmsHost similarly to the docs (normally injected by backend after OAuth).
 * For now we accept ?lmsHost=https://mapua-test.blackboard.com as a shortcut.
 */
app.get("/integration", (req, res) => {
  res.type("text/html; charset=utf-8").send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>UEF Integration</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script>
      (function () {
        try {
          var qs = new URLSearchParams(location.search);
          var lmsHost = qs.get("lmsHost");

          // fallback: derive from referrer (will be the Learn page that iframed you)
          if (!lmsHost && document.referrer) {
            try { lmsHost = new URL(document.referrer).origin; } catch (_) {}
          }

          window.__lmsHost = lmsHost || "";
        } catch (e) {}
      })();
    </script>

    <!-- UEF client script -->
    <script src="/uef.js"></script>
  </body>
</html>`);
});

/**
 * UEF client script (served dynamically so widgetUrl can be injected)
 */
app.get("/uef.js", (req, res) => {
  const widgetUrl = getNfWidgetScriptUrl();
  if (!widgetUrl) {
    res
      .status(500)
      .type("application/javascript; charset=utf-8")
      .send(
        `console.error("[UEF] Missing NF_WIDGET_ID or NF_WIDGET_SCRIPT_URL");`
      );
    return;
  }

  res.type("application/javascript; charset=utf-8").send(`
(function () {
  try {
    function log() { try { console.log.apply(console, arguments); } catch(_) {} }
    function warn() { try { console.warn.apply(console, arguments); } catch(_) {} }
    function err() { try { console.error.apply(console, arguments); } catch(_) {} }

    var lmsHost = (window.__lmsHost || "").trim();
    if (!lmsHost) {
      err("[UEF] Missing window.__lmsHost. Open /integration?lmsHost=https://mapua-test.blackboard.com for a quick test.");
      return;
    }

    // IMPORTANT: postMessage targetOrigin must be the *origin*, not a URL with path.
    // (UEF docs show \`\${window.__lmsHost}/*\`, but browsers conceptually validate origin.)
    // We'll keep it strict and safe.
    var targetOrigin = lmsHost;

    log("[UEF] lmsHost =", lmsHost);

    var messageChannel = null;
    var panelPortalId = null;

    function onMessageFromUltra(evt) {
      try {
        if (!evt || !evt.data) return;

        // UEF handshake response comes back with the same type and a MessagePort.
        if (evt.data.type === "integration:hello") {
          if (!evt.ports || !evt.ports[0]) {
            warn("[UEF] integration:hello received but no MessagePort found.");
            return;
          }
          messageChannel = evt.ports[0];
          log("[UEF] MessagePort received.");

          messageChannel.onmessage = function (m) {
            try {
              var t = m && m.data && m.data.type;
              if (t) log("[UEF] Port message:", t, m.data);

              // Panel response: capture portalId then render
              if (t === "portal:panel:response" && m.data.status === "success") {
                if (m.data.correlationId === "nf-panel-1") {
                  panelPortalId = m.data.portalId;
                  renderPanel(panelPortalId);
                }
              }
            } catch (e) {}
          };

          authorize();
        }
      } catch (e) {
        err("[UEF] onMessageFromUltra error:", e);
      }
    }

    window.addEventListener("message", onMessageFromUltra, false);

    function sendHello() {
      log("[UEF] Sending integration:hello to", targetOrigin);
      window.parent.postMessage({ type: "integration:hello" }, targetOrigin);
    }

    async function fetchToken() {
      var resp = await fetch("/uef/access-token", { credentials: "include" });
      var data = await resp.json();
      if (!data || !data.ok || !data.token) throw new Error("No token from /uef/access-token");
      return data.token;
    }

    async function authorize() {
      if (!messageChannel) return;

      log("[UEF] Requesting authorization...");
      var token = await fetchToken();

      // UEF docs: authorization:authorize with token
      messageChannel.postMessage({
        type: "authorization:authorize",
        token: token
      });

      log("[UEF] authorization:authorize sent.");

      // Subscribe to portal events (optional but matches docs)
      messageChannel.postMessage({
        type: "event:subscribe",
        subscriptions: ["portal:new"]
      });

      // Open a panel immediately (debug-friendly)
      openPanel();
    }

    function openPanel() {
      if (!messageChannel) return;

      messageChannel.postMessage({
        type: "portal:panel",
        correlationId: "nf-panel-1",
        panelType: "small",
        panelTitle: "NF Chatbot",
        attributes: {
          onClose: { callbackId: "nf-panel-1-close" }
        }
      });

      log("[UEF] portal:panel requested.");
    }

    function renderPanel(portalId) {
      if (!messageChannel || !portalId) return;

      // Render an iframe that loads your widget wrapper page
      // (your widget wrapper should load the NF widget SDK and create the UI)
      var wrapperUrl = window.location.origin + "/widget-wrapper.html";

      messageChannel.postMessage({
        type: "portal:render",
        portalId: portalId,
        contents: {
          tag: "iframe",
          props: {
            src: wrapperUrl,
            style: {
              width: "100%",
              height: "100%",
              border: "0",
              background: "transparent"
            },
            allow: "clipboard-read; clipboard-write"
          }
        }
      });

      log("[UEF] portal:render ->", wrapperUrl);
    }

    // Boot
    sendHello();
  } catch (e) {
    console.error("[UEF] fatal:", e);
  }
})();
  `);
});

app.get("/", (req, res) => res.redirect("/integration"));

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://\${HOST}:\${PORT}`);
});
