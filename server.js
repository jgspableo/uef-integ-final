import express from "express";

const app = express();

// Render expects you to bind to 0.0.0.0 and use process.env.PORT
const PORT = Number(process.env.PORT || 10000);
const HOST = "0.0.0.0";

const NF_WIDGET_ID = (process.env.NF_WIDGET_ID || "").trim();
const NF_WIDGET_SCRIPT_URL = (process.env.NF_WIDGET_SCRIPT_URL || "").trim();

function getNfWidgetScriptUrl() {
  if (NF_WIDGET_SCRIPT_URL) return NF_WIDGET_SCRIPT_URL;
  if (!NF_WIDGET_ID) return "";
  return `https://portalapi.noodlefactory.ai/api/v1/widget/widget-sdk/${NF_WIDGET_ID}/widget.js`;
}

// Basic security headers
app.disable("x-powered-by");

app.use((req, res, next) => {
  // Prevent caching so updates to the script propagate immediately
  res.setHeader("Cache-Control", "no-store");
  next();
});

// Serve static files (optional, for your health check page)
app.use(express.static("public", { extensions: ["html"] }));

app.get("/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

/**
 * PRODUCTION UEF INJECTION ROUTE
 */
app.get("/uef.js", (req, res) => {
  const widgetUrl = getNfWidgetScriptUrl();

  if (!widgetUrl) {
    res.status(500).send("console.error('[UEF] Missing NF_WIDGET_ID');");
    return;
  }

  res.type("application/javascript; charset=utf-8");

  const js = `
/**
 * UEF Loader for NoodleFactory
 */
(function () {
  try {
    // 1. Prevent double-loading
    if (window.__NF_UEF_LOADED__) return;
    window.__NF_UEF_LOADED__ = true;

    // Globals expected by NF
    window.$_Widget = window.$_Widget || {};
    window.$_NFW = window.$_NFW || {};

    // ---------------------------------------------------------
    // STYLE ENFORCER (The "Nuclear Option")
    // Keeps the widget visible even if the internal script tries to hide it
    // ---------------------------------------------------------
    function forceStyles() {
      // A. Fix the Outer Wrapper
      var wrapper = document.querySelector('.noodle-factory-widget-wrapper');
      if (wrapper) {
        wrapper.style.setProperty('overflow', 'visible', 'important');
        wrapper.style.setProperty('height', 'auto', 'important');
        wrapper.style.setProperty('width', 'auto', 'important');
        
        // Max Z-Index to float above everything (including Blackboard Nav)
        wrapper.style.setProperty('z-index', '2147483647', 'important');
        
        // Positioning: Bottom Right
        wrapper.style.setProperty('position', 'fixed', 'important');
        wrapper.style.setProperty('bottom', '20px', 'important');
        wrapper.style.setProperty('right', '20px', 'important');
      }

      // B. Fix the Button (The Launcher)
      var btn = document.querySelector('.noodle-factory-button-wrapper');
      if (btn) {
        btn.style.setProperty('width', '60px', 'important');
        btn.style.setProperty('height', '60px', 'important');
        btn.style.setProperty('display', 'block', 'important');
        btn.style.setProperty('visibility', 'visible', 'important');
        btn.style.setProperty('opacity', '1', 'important');
      }
      
      // C. Fix the Chat Window (If open)
      var chat = document.querySelector('.noodle-factory-chat-wrapper');
      if (chat) {
         chat.style.setProperty('z-index', '2147483648', 'important');
      }
    }

    // Run immediately and then repeatedly to fight resets
    forceStyles();
    setInterval(forceStyles, 1000); // Check every second

    // ---------------------------------------------------------
    // SCRIPT INJECTION
    // ---------------------------------------------------------
    function inject() {
      if (document.getElementById("sw-widget")) {
        if (window.$_NFW && typeof window.$_NFW.initialize === "function") {
          window.$_NFW.initialize();
        }
        return;
      }

      var s = document.createElement("script");
      s.async = true;
      s.src = "${widgetUrl}";
      s.charset = "UTF-8";
      s.setAttribute("crossorigin", "*");
      s.setAttribute("id", "sw-widget");
      s.onload = function () {
        console.log("[UEF] NF Widget Loaded.");
        if (window.$_NFW && typeof window.$_NFW.initialize === "function") {
            window.$_NFW.initialize();
        }
      };
      (document.head || document.documentElement).appendChild(s);
    }

    // Start Injection
    inject();

    // Re-check on load 
    window.addEventListener("load", inject, { once: true });

    // Watch for SPA Navigation changes (re-inject if lost)
    var observer = new MutationObserver(function () {
      if (!document.getElementById("sw-widget")) {
        inject();
      }
      forceStyles();
    });

    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    } else {
        window.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }

  } catch (err) {
    console.error("[UEF] Error:", err);
  }
})();
`;

  res.send(js);
});

// Redirect root to a helpful page or just 404
app.get("/", (req, res) => res.send("UEF Widget Service Running"));

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
