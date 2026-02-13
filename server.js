import express from "express";

const app = express();

// Render expects you to bind to 0.0.0.0 and use process.env.PORT
const PORT = Number(process.env.PORT || 10000);
const HOST = "0.0.0.0";

// Your Widget ID from Render Environment Variables
const NF_WIDGET_ID = (process.env.NF_WIDGET_ID || "").trim();
const NF_WIDGET_SCRIPT_URL = (process.env.NF_WIDGET_SCRIPT_URL || "").trim();

function getNfWidgetScriptUrl() {
  if (NF_WIDGET_SCRIPT_URL) return NF_WIDGET_SCRIPT_URL;
  if (!NF_WIDGET_ID) return "";
  return `https://portalapi.noodlefactory.ai/api/v1/widget/widget-sdk/${NF_WIDGET_ID}/widget.js`;
}

app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(express.static("public", { extensions: ["html"] }));

app.get("/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

/**
 * SERVES THE INJECTION SCRIPT
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

  res.type("application/javascript; charset=utf-8");

  // This script runs inside the Blackboard page
  const js = `
/**
 * UEF loader for NoodleFactory widget
 * Injects: ${widgetUrl}
 */
(function () {
  try {
    // 1. Prevent double-loading
    if (window.__NF_WIDGET_LOADED__) return;
    window.__NF_WIDGET_LOADED__ = true;

    // Globals
    window.$_Widget = window.$_Widget || {};
    window.$_NFW = window.$_NFW || {};

    // 2. CSS FORCE FIX: Make the invisible container visible
    function injectStyles() {
      var css = \`
        /* Override the 0px height and hidden overflow that's hiding your widget */
        .noodle-factory-widget-wrapper {
            overflow: visible !important;
            height: auto !important; 
            width: auto !important;
            z-index: 2147483647 !important; /* Max Z-index to float above everything */
            position: fixed !important;
            bottom: 0px !important;
            right: 0px !important;
        }

        /* Ensure the button wrapper has physical size */
        .noodle-factory-button-wrapper {
            width: 60px !important;
            height: 60px !important;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
        }

        /* Ensure the iframe itself is not collapsed */
        .noodle-factory-widget iframe {
            min-width: 60px !important;
            min-height: 60px !important;
        }
      \`;
      var style = document.createElement('style');
      style.id = 'uef-nf-css-overrides';
      style.appendChild(document.createTextNode(css));
      document.head.appendChild(style);
      console.log("[UEF] Injected CSS overrides to fix visibility.");
    }

    // 3. Script Injection
    function inject() {
      // If script exists, just try to re-initialize
      if (document.getElementById("sw-widget")) {
        if (window.$_NFW && typeof window.$_NFW.initialize === "function") {
          window.$_NFW.initialize();
        }
        return;
      }

      var s1 = document.createElement("script");
      s1.async = true;
      s1.src = "${widgetUrl}";
      s1.charset = "UTF-8";
      s1.setAttribute("crossorigin", "*");
      s1.setAttribute("id", "sw-widget");
      s1.onload = function () {
        console.log("[UEF] Widget script loaded.");
        try {
          if (window.$_NFW && typeof window.$_NFW.initialize === "function") {
            window.$_NFW.initialize();
            console.log("[UEF] $_NFW.initialize() called.");
          } else {
            console.warn("[UEF] $_NFW found but initialize() missing.");
          }
        } catch (e) {
          console.error("[UEF] initialize() failed:", e);
        }
      };

      (document.head || document.documentElement).appendChild(s1);
    }

    // Run Logic
    injectStyles();
    inject();

    // Re-check on load (for slow connections)
    window.addEventListener("load", inject, { once: true });

    // 4. Optimized Observer (Watches for page changes/navigation)
    // We now watch 'body' instead of 'documentElement' to save CPU
    var mo = new MutationObserver(function (mutations) {
      if (!document.getElementById("sw-widget")) {
        console.log("[UEF] Widget removed by Ultra nav, re-injecting...");
        inject();
        injectStyles(); // Ensure CSS stays too
      }
    });
    
    // Wait for body to exist before observing
    var startObserver = function() {
        if (document.body) {
            mo.observe(document.body, { childList: true, subtree: true });
        } else {
            setTimeout(startObserver, 100);
        }
    };
    startObserver();

  } catch (err) {
    console.error("[UEF] loader crashed:", err);
  }
})();
`;

  res.send(js);
});

// Optional: convenient redirect for testing
app.get("/", (req, res) => res.redirect("/widget-wrapper.html"));

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
  console.log(`UEF loader available at /uef.js`);
});
