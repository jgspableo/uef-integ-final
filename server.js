// server.js
import express from "express";

const app = express();
app.disable("x-powered-by");

const PORT = Number(process.env.PORT || 10000);
const HOST = process.env.HOST || "0.0.0.0";

// ====== NF widget config ======
const NF_WIDGET_ID = (process.env.NF_WIDGET_ID || "").trim();
const NF_WIDGET_SCRIPT_URL = (process.env.NF_WIDGET_SCRIPT_URL || "").trim();

function getNfWidgetScriptUrl() {
  if (NF_WIDGET_SCRIPT_URL) return NF_WIDGET_SCRIPT_URL;
  if (!NF_WIDGET_ID) return "";
  return `https://portalapi.noodlefactory.ai/api/v1/widget/widget-sdk/${NF_WIDGET_ID}/widget.js`;
}

// ====== UEF auth config ======
// TEMP: Put a real user 3LO access token here to prove authorize works.
// Replace this with real 3LO later.
const UEF_USER_TOKEN = (process.env.UEF_USER_TOKEN || "").trim();

// no cache while debugging
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// serve /public files
app.use(express.static("public", { extensions: ["html"] }));

app.get("/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

/**
 * Minimal token endpoint used by /uef.js
 * IMPORTANT: In production, do NOT expose tokens like this.
 * Replace with a short-lived, per-user token retrieval (3LO) + origin checks.
 */
app.get("/uef/access-token", (req, res) => {
  if (!UEF_USER_TOKEN) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing UEF_USER_TOKEN. Implement 3LO and return a real user bearer token.",
    });
  }
  res.json({ ok: true, token: UEF_USER_TOKEN });
});

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

  res.type("application/javascript; charset=utf-8");

  const js = `
(function () {
  try {
    // -----------------------------
    // Helpers
    // -----------------------------
    function log() { try { console.log.apply(console, arguments); } catch(_) {} }
    function warn() { try { console.warn.apply(console, arguments); } catch(_) {} }
    function err() { try { console.error.apply(console, arguments); } catch(_) {} }

    // In UEF, this script runs in a hidden iframe.
    // We will talk to the parent (Learn) via MessageChannel handshake (integration-hello)
    // then authorize with a 3LO token (authorization:authorize). See Anthology docs.
    // Docs: https://docs.anthology.com/docs/blackboard/uef/uef-authentication

    // -----------------------------
    // Detect Learn origin
    // -----------------------------
    var learnOrigin = null;
    try {
      // You're on https://mapua-test.blackboard.com/...
      learnOrigin = window.location.origin;
    } catch (e) {}

    if (!learnOrigin) {
      err("[UEF] Could not determine learnOrigin.");
      return;
    }

    log("[UEF] Detected Learn origin:", learnOrigin);

    // -----------------------------
    // Get TOP document (Ultra UI)
    // -----------------------------
    var topWin = window;
    try {
      if (window.top && window.top.document) topWin = window.top;
    } catch (e) {
      // if blocked, stay in current window (but usually same-origin in Learn)
      topWin = window;
    }
    var doc = topWin.document;

    // -----------------------------
    // Visual proof injection (debug dot)
    // -----------------------------
    function injectDebugDot() {
      try {
        if (doc.getElementById("uef-debug-dot")) return;
        var dot = doc.createElement("div");
        dot.id = "uef-debug-dot";
        dot.title = "UEF injected into TOP document";
        dot.style.cssText = [
          "position:fixed",
          "left:12px",
          "bottom:12px",
          "width:14px",
          "height:14px",
          "border-radius:999px",
          "background:#ff0000",
          "z-index:2147483647",
          "box-shadow:0 0 10px rgba(0,0,0,.35)",
          "pointer-events:none"
        ].join(";");
        (doc.body || doc.documentElement).appendChild(dot);
        log("[UEF] Debug dot injected. compatMode =", doc.compatMode, "url =", (doc.location && doc.location.href));
      } catch (e) {
        // ignore
      }
    }

    // -----------------------------
    // Force widget to a stable overlay container (helps with odd layouts)
    // -----------------------------
    function ensureOverlayHost() {
      var host = doc.getElementById("uef-nf-overlay-host");
      if (host) return host;

      host = doc.createElement("div");
      host.id = "uef-nf-overlay-host";
      host.style.cssText = [
        "position:fixed",
        "inset:0",
        "z-index:2147483647",
        "pointer-events:none"
      ].join(";");

      (doc.body || doc.documentElement).appendChild(host);
      return host;
    }

    // -----------------------------
    // CSS overrides
    // -----------------------------
    function injectStyles() {
      if (doc.getElementById("uef-nf-css-overrides")) return;

      var css = \`
        /* Put wrapper in a predictable spot */
        .noodle-factory-widget-wrapper{
          position: fixed !important;
          right: 32px !important;
          bottom: 20px !important;
          z-index: 2147483647 !important;
          overflow: visible !important;
          pointer-events: auto !important;
          transform: none !important;
          inset: auto !important;
        }
        .noodle-factory-button-wrapper{
          width: 60px !important;
          height: 60px !important;
          min-width: 60px !important;
          min-height: 60px !important;
          display: block !important;
          visibility: visible !important;
          opacity: 1 !important;
          pointer-events: auto !important;
          transform: none !important;
        }
        .noodle-factory-chat-wrapper{
          z-index: 2147483648 !important;
          pointer-events: auto !important;
          transform: none !important;
        }
      \`;

      var style = doc.createElement("style");
      style.id = "uef-nf-css-overrides";
      style.appendChild(doc.createTextNode(css));
      (doc.head || doc.documentElement).appendChild(style);

      log("[UEF] CSS overrides injected into top document.");
    }

    // -----------------------------
    // Ensure visible + in overlay host
    // -----------------------------
    function ensureVisible() {
      var overlay = ensureOverlayHost();

      var wrapper = doc.querySelector(".noodle-factory-widget-wrapper");
      if (wrapper && wrapper.parentElement !== overlay) {
        overlay.appendChild(wrapper);
        log("[UEF] Moved widget wrapper into overlay host");
      }

      if (wrapper) {
        wrapper.style.setProperty("pointer-events", "auto", "important");
        wrapper.style.setProperty("position", "fixed", "important");
        wrapper.style.setProperty("right", "32px", "important");
        wrapper.style.setProperty("bottom", "20px", "important");
        wrapper.style.setProperty("transform", "none", "important");
      }

      var btn = doc.querySelector(".noodle-factory-button-wrapper");
      if (btn) {
        btn.style.setProperty("pointer-events", "auto", "important");
        btn.style.setProperty("opacity", "1", "important");
        btn.style.setProperty("visibility", "visible", "important");
      }

      // If rect is offscreen (you saw negative x/y), force fallback using left/top.
      if (btn && btn.getBoundingClientRect) {
        var r = btn.getBoundingClientRect();
        if (r.x < 0 || r.y < 0 || r.width === 0 || r.height === 0) {
          // Fallback anchor
          wrapper && wrapper.style.setProperty("left", "auto", "important");
          wrapper && wrapper.style.setProperty("top", "auto", "important");
          wrapper && wrapper.style.setProperty("right", "32px", "important");
          wrapper && wrapper.style.setProperty("bottom", "20px", "important");
          log("[UEF] Offscreen rect detected; reapplied anchors", { x: r.x, y: r.y, w: r.width, h: r.height });
        }
      }
    }

    // -----------------------------
    // Inject NF widget script into TOP
    // -----------------------------
    topWin.$_Widget = topWin.$_Widget || {};
    topWin.$_NFW = topWin.$_NFW || {};

    function injectWidgetScript() {
      if (doc.getElementById("sw-widget")) return;

      var s = doc.createElement("script");
      s.async = true;
      s.src = "${widgetUrl}";
      s.charset = "UTF-8";
      s.crossOrigin = "anonymous";
      s.id = "sw-widget";

      s.onload = function () {
        log("[UEF] Widget script loaded (top document).");
        try {
          if (topWin.$_NFW && typeof topWin.$_NFW.initialize === "function") {
            topWin.$_NFW.initialize();
            log("[UEF] $_NFW.initialize() called.");
          } else {
            warn("[UEF] $_NFW.initialize not found.");
          }
        } catch (e) {
          err("[UEF] initialize error:", e);
        }

        // enforce visibility after load
        topWin.setTimeout(ensureVisible, 250);
        topWin.setTimeout(ensureVisible, 1000);
        topWin.setTimeout(ensureVisible, 3000);
      };

      (doc.head || doc.documentElement).appendChild(s);
      log("[UEF] Injected NF widget script into top window.");
    }

    // -----------------------------
    // UEF handshake + authorize (this is what you're missing)
    // -----------------------------
    var messagePort = null;

    function sendHello() {
      // Anthology doc: type is 'integration-hello' and target should be learnOrigin + '/*'
      // https://docs.anthology.com/docs/blackboard/uef/uef-authentication
      log("[UEF] Sending integration hello...");
      window.parent.postMessage({ type: "integration-hello" }, learnOrigin + "/*");
    }

    async function fetchToken() {
      // Pull a token from your backend (replace with real 3LO later)
      var resp = await fetch("/uef/access-token", { credentials: "include" });
      var data = await resp.json();
      if (!data || !data.ok || !data.token) {
        throw new Error("No token returned from /uef/access-token");
      }
      return data.token;
    }

    async function authorizeOnPort(port) {
      log("[UEF] Requesting authorization...");
      var token = await fetchToken();

      port.postMessage({
        type: "authorization:authorize",
        token: token
      });

      log("[UEF] Sent authorization:authorize with token.");
    }

    window.addEventListener("message", async function (incomingMessage) {
      try {
        if (!incomingMessage || incomingMessage.origin !== learnOrigin) return;

        // Some docs show integration:hello vs integration-hello in different contexts;
        // accept both to be safe.
        var t = incomingMessage.data && incomingMessage.data.type;
        if (t !== "integration-hello" && t !== "integration:hello") return;

        if (!incomingMessage.ports || !incomingMessage.ports[0]) {
          warn("[UEF] integration hello received but no MessagePort found.");
          return;
        }

        messagePort = incomingMessage.ports[0];
        log("[UEF] UEF MessagePort received.");

        messagePort.onmessage = function (evt) {
          var mt = evt && evt.data && evt.data.type;
          if (mt) log("[UEF] Port message:", mt, evt.data);
        };

        await authorizeOnPort(messagePort);

        // Only after attempting auth, inject widget into TOP UI.
        injectDebugDot();
        injectStyles();
        injectWidgetScript();
        ensureVisible();

      } catch (e) {
        err("[UEF] handshake/auth error:", e);
      }
    });

    // -----------------------------
    // Boot
    // -----------------------------
    sendHello();

    // Keep enforcing in Ultra SPA
    topWin.setInterval(function () {
      injectDebugDot();
      injectStyles();
      ensureVisible();
    }, 500);

  } catch (e) {
    console.error("[UEF] fatal:", e);
  }
})();
`;

  res.send(js);
});

app.get("/", (req, res) => res.redirect("/widget-wrapper.html"));

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
