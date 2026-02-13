import express from "express";

const app = express();

// Render expects you to bind to 0.0.0.0 and use process.env.PORT
const PORT = Number(process.env.PORT || 10000);
const HOST = "0.0.0.0";

/**
 * ENV you should set in Render:
 * - NF_WIDGET_ID = A60CF5EFD2705979 (your widget id)
 *
 * Optional overrides:
 * - NF_WIDGET_SCRIPT_URL = full widget.js URL if you prefer (otherwise computed from ID)
 */
const NF_WIDGET_ID = (process.env.NF_WIDGET_ID || "").trim();
const NF_WIDGET_SCRIPT_URL = (process.env.NF_WIDGET_SCRIPT_URL || "").trim();

function getNfWidgetScriptUrl() {
  if (NF_WIDGET_SCRIPT_URL) return NF_WIDGET_SCRIPT_URL;
  if (!NF_WIDGET_ID) return "";
  return `https://portalapi.noodlefactory.ai/api/v1/widget/widget-sdk/${NF_WIDGET_ID}/widget.js`;
}

// Basic hardening + make debugging easier
app.disable("x-powered-by");

app.use((req, res, next) => {
  // Helpful for debugging UEF fetching and caching
  res.setHeader("Cache-Control", "no-store");
  next();
});

// Serve static test page
app.use(
  express.static("public", {
    extensions: ["html"],
  })
);

// Health endpoint (Render likes having something to hit)
app.get("/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

/**
 * THE INJECTION SCRIPT ROUTE
 */
app.get("/uef.js", (req, res) => {
  const widgetUrl = getNfWidgetScriptUrl();

  if (!widgetUrl) {
    res
      .status(500)
      .type("application/javascript; charset=utf-8")
      .send(
        `console.error("[UEF] Missing NF_WIDGET_ID or NF_WIDGET_SCRIPT_URL in env.");`
      );
    return;
  }

  // Important: send correct content-type
  res.type("application/javascript; charset=utf-8");

  const js = `
/**
 * UEF loader for NoodleFactory widget
 * Injects: ${widgetUrl}
 */
(function () {
  try {
    // ---------------------------------------------------------
    // IMPORTANT: Target TOP WINDOW + TOP DOCUMENT (Ultra UI)
    // If we inject into the hidden LTI iframe, the widget looks "greyed out"
    // ---------------------------------------------------------
    var topWin = window;
    try {
      if (window.top && window.top.document) topWin = window.top;
    } catch (e) {
      topWin = window; // cross-origin/sandbox fallback
    }

    var doc = topWin.document;

    // Prevent double-loading across SPA navigation
    if (topWin.__NF_WIDGET_LOADED__) return;
    topWin.__NF_WIDGET_LOADED__ = true;

    // Globals expected by NF
    topWin.$_Widget = topWin.$_Widget || {};
    topWin.$_NFW = topWin.$_NFW || {};

    // ---------------------------------------------------------
    // STRATEGY A: CSS INJECTION (TOP DOCUMENT)
    // ---------------------------------------------------------
    function injectStyles() {
      if (doc.getElementById("uef-nf-css-overrides")) return;

      var css = \`
        /* Make sure wrapper is not collapsed/hidden */
        .noodle-factory-widget-wrapper {
          overflow: visible !important;
          height: auto !important;
          width: auto !important;
          z-index: 2147483647 !important;
          position: fixed !important;
          bottom: 20px !important;
          right: 32px !important;
          pointer-events: auto !important;
        }

        /* Make sure launcher button is clickable */
        .noodle-factory-button-wrapper {
          width: 60px !important;
          height: 60px !important;
          display: block !important;
          visibility: visible !important;
          opacity: 1 !important;
          pointer-events: auto !important;
        }

        /* If the widget creates an iframe, keep it visible */
        .noodle-factory-widget iframe {
          min-width: 60px !important;
          min-height: 60px !important;
        }
      \`;

      var style = doc.createElement("style");
      style.id = "uef-nf-css-overrides";
      style.appendChild(doc.createTextNode(css));
      (doc.head || doc.documentElement).appendChild(style);

      console.log("[UEF] Injected CSS overrides into top document.");
    }

    // ---------------------------------------------------------
    // STRATEGY B: STYLE ENFORCER (TOP DOCUMENT)
    // ---------------------------------------------------------
    function forceStyles() {
      // Outer wrapper
      var wrapper = doc.querySelector(".noodle-factory-widget-wrapper");
      if (wrapper) {
        wrapper.style.setProperty("overflow", "visible", "important");
        wrapper.style.setProperty("height", "auto", "important");
        wrapper.style.setProperty("width", "auto", "important");
        wrapper.style.setProperty("z-index", "2147483647", "important");
        wrapper.style.setProperty("position", "fixed", "important");
        wrapper.style.setProperty("bottom", "20px", "important");
        wrapper.style.setProperty("right", "32px", "important");
        wrapper.style.setProperty("pointer-events", "auto", "important");
      }

      // Button (launcher)
      var btn = doc.querySelector(".noodle-factory-button-wrapper");
      if (btn) {
        btn.style.setProperty("width", "60px", "important");
        btn.style.setProperty("height", "60px", "important");
        btn.style.setProperty("display", "block", "important");
        btn.style.setProperty("visibility", "visible", "important");
        btn.style.setProperty("opacity", "1", "important");
        btn.style.setProperty("pointer-events", "auto", "important");
      }

      // Chat window (if open)
      var chat = doc.querySelector(".noodle-factory-chat-wrapper");
      if (chat) {
        chat.style.setProperty("z-index", "2147483648", "important");
        chat.style.setProperty("pointer-events", "auto", "important");
      }
    }

    // ---------------------------------------------------------
    // SCRIPT INJECTION (TOP DOCUMENT)
    // ---------------------------------------------------------
    function injectWidgetScript() {
      // If already present in TOP DOC, just initialize
      if (doc.getElementById("sw-widget")) {
        try {
          if (topWin.$_NFW && typeof topWin.$_NFW.initialize === "function") {
            topWin.$_NFW.initialize();
          }
        } catch (e) {
          console.error("[UEF] initialize() failed:", e);
        }
        return;
      }

      var s1 = doc.createElement("script");
      s1.async = true;
      s1.src = "${widgetUrl}";
      s1.charset = "UTF-8";

      // IMPORTANT: valid values are "anonymous" or "use-credentials"
      // DO NOT use "*"
      s1.crossOrigin = "anonymous";

      s1.id = "sw-widget";

      s1.onload = function () {
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

      (doc.head || doc.documentElement).appendChild(s1);
      console.log("[UEF] Injected NF widget script into top window.");
    }

    // Execute
    injectStyles();
    forceStyles();
    injectWidgetScript();

    // Keep fighting internal resets
    topWin.setInterval(forceStyles, 500);

    // Re-check on load (Ultra modifies DOM late)
    topWin.addEventListener("load", function () {
      injectStyles();
      forceStyles();
      injectWidgetScript();
    }, { once: true });

    // Watch for DOM changes (Ultra SPA navigation)
    var mo = new topWin.MutationObserver(function () {
      // If navigation removed it, re-inject
      if (!doc.getElementById("sw-widget")) {
        console.log("[UEF] Widget removed by navigation, re-injecting...");
        injectStyles();
        injectWidgetScript();
      }
      forceStyles();
    });

    function startObserver() {
      if (doc.body) {
        mo.observe(doc.body, { childList: true, subtree: true });
      } else {
        topWin.setTimeout(startObserver, 100);
      }
    }
    startObserver();

  } catch (err) {
    console.error("[UEF] loader crashed:", err);
  }
})();
`;

  res.send(js);
});

// Optional: convenient redirect
app.get("/", (req, res) => res.redirect("/widget-wrapper.html"));

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
  console.log(`UEF loader: /uef.js`);
});
