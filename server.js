import express from "express";

const app = express();

const PORT = Number(process.env.PORT || 10000);
const HOST = "0.0.0.0";

/**
 * ENV:
 * - NF_WIDGET_ID = your widget id (recommended)
 * Optional:
 * - NF_WIDGET_SCRIPT_URL = full widget.js URL override
 */
const NF_WIDGET_ID = (process.env.NF_WIDGET_ID || "").trim();
const NF_WIDGET_SCRIPT_URL = (process.env.NF_WIDGET_SCRIPT_URL || "").trim();

function getNfWidgetScriptUrl() {
  if (NF_WIDGET_SCRIPT_URL) return NF_WIDGET_SCRIPT_URL;
  if (!NF_WIDGET_ID) return "";
  return `https://portalapi.noodlefactory.ai/api/v1/widget/widget-sdk/${NF_WIDGET_ID}/widget.js`;
}

app.disable("x-powered-by");

// no-store while debugging
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// static test page
app.use(express.static("public", { extensions: ["html"] }));

app.get("/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
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
    // -------------------------------
    // Always target TOP WINDOW
    // -------------------------------
    var topWin = window;
    try {
      if (window.top && window.top.document) topWin = window.top;
    } catch (e) {
      topWin = window; // fallback if sandboxed/cross-origin
    }

    var doc = topWin.document;

    // Prevent double-load
    if (topWin.__NF_WIDGET_LOADED__) return;
    topWin.__NF_WIDGET_LOADED__ = true;

    // Globals expected by NF
    topWin.$_Widget = topWin.$_Widget || {};
    topWin.$_NFW = topWin.$_NFW || {};

    // -------------------------------
    // DEBUG BADGE (visible proof)
    // -------------------------------
    function ensureDebugBadge(text) {
      try {
        var id = "uef-nf-debug-badge";
        var el = doc.getElementById(id);
        if (!el) {
          el = doc.createElement("div");
          el.id = id;
          el.style.position = "fixed";
          el.style.bottom = "8px";
          el.style.left = "8px";
          el.style.zIndex = "2147483647";
          el.style.padding = "6px 10px";
          el.style.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
          el.style.borderRadius = "10px";
          el.style.background = "rgba(0,0,0,0.75)";
          el.style.color = "#fff";
          el.style.pointerEvents = "none";
          el.textContent = text || "UEF OK";
          (doc.body || doc.documentElement).appendChild(el);
        } else if (text) {
          el.textContent = text;
        }
      } catch (_) {}
    }

    ensureDebugBadge("UEF OK: loader running");

    // -------------------------------
    // CSS overrides (TOP DOCUMENT)
    // -------------------------------
    function injectStyles() {
      if (doc.getElementById("uef-nf-css-overrides")) return;

      var css = \`
        .noodle-factory-widget-wrapper{
          overflow: visible !important;
          height: auto !important;
          width: auto !important;
          z-index: 2147483647 !important;
          position: fixed !important;
          bottom: 20px !important;
          right: 32px !important;
          pointer-events: auto !important;
          display: block !important;
          visibility: visible !important;
          opacity: 1 !important;
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
          cursor: pointer !important;
        }
        .noodle-factory-chat-wrapper{
          z-index: 2147483648 !important;
          pointer-events: auto !important;
          display: block !important;
          visibility: visible !important;
          opacity: 1 !important;
        }
      \`;

      var style = doc.createElement("style");
      style.id = "uef-nf-css-overrides";
      style.appendChild(doc.createTextNode(css));
      (doc.head || doc.documentElement).appendChild(style);

      console.log("[UEF] Injected CSS overrides into top document.");
    }

    // -------------------------------
    // Unhide + relocate under body
    // (fixes “rendered but invisible” cases)
    // -------------------------------
    function unhideAndRelocate() {
      var wrapper = doc.querySelector(".noodle-factory-widget-wrapper");
      var btn = doc.querySelector(".noodle-factory-button-wrapper");
      var chat = doc.querySelector(".noodle-factory-chat-wrapper");

      // If NF inserted under a hidden parent, move to body.
      // This is the most common reason for "still nothing" in Ultra.
      if (wrapper && doc.body && wrapper.parentElement !== doc.body) {
        doc.body.appendChild(wrapper);
      }

      // Force critical visibility styles
      function force(el, z) {
        if (!el) return;
        el.style.setProperty("display", "block", "important");
        el.style.setProperty("visibility", "visible", "important");
        el.style.setProperty("opacity", "1", "important");
        el.style.setProperty("pointer-events", "auto", "important");
        if (z) el.style.setProperty("z-index", String(z), "important");
      }

      force(wrapper, 2147483647);
      force(btn, 2147483647);
      force(chat, 2147483648);

      // Force button size (your computed styles showed 30x30 earlier)
      if (btn) {
        btn.style.setProperty("width", "60px", "important");
        btn.style.setProperty("height", "60px", "important");
        btn.style.setProperty("min-width", "60px", "important");
        btn.style.setProperty("min-height", "60px", "important");
      }

      // Update badge with current status
      if (!wrapper && !btn) {
        ensureDebugBadge("UEF OK: waiting for NF DOM…");
      } else {
        ensureDebugBadge("UEF OK: NF DOM detected");
      }
    }

    // -------------------------------
    // Inject widget script into TOP DOC
    // -------------------------------
    function injectWidgetScript() {
      if (doc.getElementById("sw-widget")) return;

      var s = doc.createElement("script");
      s.async = true;
      s.src = "${widgetUrl}";
      s.charset = "UTF-8";
      s.crossOrigin = "anonymous"; // valid value

      s.id = "sw-widget";

      s.onload = function () {
        console.log("[UEF] Widget script loaded (top document).");
        try {
          if (topWin.$_NFW && typeof topWin.$_NFW.initialize === "function") {
            topWin.$_NFW.initialize();
            console.log("[UEF] $_NFW.initialize() called.");
          } else {
            console.warn("[UEF] $_NFW.initialize not found after load.");
          }
        } catch (e) {
          console.error("[UEF] initialize() failed:", e);
        }
      };

      (doc.head || doc.documentElement).appendChild(s);
      console.log("[UEF] Injected NF widget script into top window.");
    }

    // Run
    injectStyles();
    injectWidgetScript();

    // Aggressive enforcer (Ultra is SPA + DOM constantly changes)
    topWin.setInterval(function () {
      try { unhideAndRelocate(); } catch (_) {}
    }, 400);

    // Mutation observer to catch late renders
    var mo = new topWin.MutationObserver(function () {
      try { unhideAndRelocate(); } catch (_) {}
    });

    function startObserver() {
      if (doc.body) mo.observe(doc.body, { childList: true, subtree: true });
      else topWin.setTimeout(startObserver, 100);
    }
    startObserver();

    topWin.addEventListener("load", function () {
      injectStyles();
      injectWidgetScript();
      unhideAndRelocate();
    }, { once: true });

  } catch (err) {
    console.error("[UEF] loader crashed:", err);
  }
})();
`;
  res.send(js);
});

// convenience
app.get("/", (req, res) => res.redirect("/widget-wrapper.html"));

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://\${HOST}:\${PORT}`);
  console.log("UEF loader: /uef.js");
});
