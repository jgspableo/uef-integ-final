import express from "express";

const app = express();

// Render expects you to bind to 0.0.0.0 and use process.env.PORT
const PORT = Number(process.env.PORT || 10000);
const HOST = "0.0.0.0";

/**
 * ENV you should set in Render:
 * - NF_WIDGET_ID = A60CF5EFD2705979  (your widget id)
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
app.use(express.static("public", { extensions: ["html"] }));

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
    // 1. Prevent double-loading
    if (window.__NF_WIDGET_LOADED__) return;
    window.__NF_WIDGET_LOADED__ = true;

    // Globals expected by NF
    window.$_Widget = window.$_Widget || {};
    window.$_NFW = window.$_NFW || {};

    // ---------------------------------------------------------
    // STRATEGY A: NICE CSS INJECTION
    // (Tries to override styles globally via a style tag)
    // ---------------------------------------------------------
    function injectStyles() {
      var css = \`
        /* Force wrapper visibility */
        .noodle-factory-widget-wrapper {
            overflow: visible !important;
            height: auto !important; 
            width: auto !important;
            z-index: 2147483647 !important;
            position: fixed !important;
            bottom: 20px !important;
            right: 20px !important;
        }
        /* Force button visibility */
        .noodle-factory-button-wrapper {
            width: 60px !important;
            height: 60px !important;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
        }
        /* Force iframe visibility */
        .noodle-factory-widget iframe {
            min-width: 60px !important;
            min-height: 60px !important;
        }
      \`;
      var style = document.createElement('style');
      style.id = 'uef-nf-css-overrides';
      style.appendChild(document.createTextNode(css));
      document.head.appendChild(style);
      console.log("[UEF] Injected CSS overrides.");
    }

    // ---------------------------------------------------------
    // STRATEGY B: THE NUCLEAR OPTION (Aggressive JS)
    // (Repeatedly forces inline styles to fight the widget's internal resets)
    // ---------------------------------------------------------
    function forceStyles() {
      // 1. Fix the Outer Wrapper
      var wrapper = document.querySelector('.noodle-factory-widget-wrapper');
      if (wrapper) {
        // We use setProperty with 'important' to beat inline styles
        wrapper.style.setProperty('overflow', 'visible', 'important');
        wrapper.style.setProperty('height', 'auto', 'important');
        wrapper.style.setProperty('width', 'auto', 'important');
        wrapper.style.setProperty('z-index', '2147483647', 'important');
        wrapper.style.setProperty('position', 'fixed', 'important');
        wrapper.style.setProperty('bottom', '0px', 'important');
        wrapper.style.setProperty('right', '0px', 'important');
      }

      // 2. Fix the Button (The Launcher)
      var btn = document.querySelector('.noodle-factory-button-wrapper');
      if (btn) {
        btn.style.setProperty('width', '60px', 'important');
        btn.style.setProperty('height', '60px', 'important');
        btn.style.setProperty('display', 'block', 'important');
        btn.style.setProperty('visibility', 'visible', 'important');
        btn.style.setProperty('opacity', '1', 'important');
      }
      
      // 3. Fix the Chat Window (If it's open)
      var chat = document.querySelector('.noodle-factory-chat-wrapper');
      if (chat) {
         // Ensure it sits on top of everything else
         chat.style.setProperty('z-index', '2147483648', 'important');
      }
    }

    // Run the enforcer immediately
    forceStyles();
    // And run it every 500ms to fight any "height: 0px" updates from the widget itself
    setInterval(forceStyles, 500);


    // ---------------------------------------------------------
    // SCRIPT INJECTION LOGIC
    // ---------------------------------------------------------
    function inject() {
      // If script already exists, just try to initialize
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
          }
        } catch (e) {
          console.error("[UEF] initialize() failed:", e);
        }
      };

      (document.head || document.documentElement).appendChild(s1);
    }

    // Execute logic
    injectStyles();
    inject();

    // Re-check on load (sometimes Ultra modifies DOM late)
    window.addEventListener("load", inject, { once: true });

    // Watch for DOM changes (SPA navigation)
    // We observe body instead of documentElement to save CPU
    var mo = new MutationObserver(function () {
      if (!document.getElementById("sw-widget")) {
        console.log("[UEF] Widget removed by navigation, re-injecting...");
        inject();
        injectStyles();
      }
      // Also run style force on every DOM change just in case
      forceStyles();
    });

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

// Optional: convenient redirect
app.get("/", (req, res) => res.redirect("/widget-wrapper.html"));

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
  console.log(`UEF loader: /uef.js`);
});
