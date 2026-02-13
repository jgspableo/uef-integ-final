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
 * This is the ONLY URL you need to paste into UEF as your "external script" / script URL:
 *   https://<service>.onrender.com/uef.js
 *
 * It injects the NoodleFactory widget script into the Ultra page so it floats globally.
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

  // Important: send correct content-type + charset so the browser won't warn about encoding
  res.type("application/javascript; charset=utf-8");

  // Minimal loader: inject widget only once
  const js = `
/**
 * UEF loader for NoodleFactory widget
 * Injects: ${widgetUrl}
 */
(function () {
  try {
    // Prevent double-loading across SPA navigations
    if (window.__NF_WIDGET_LOADED__) return;
    window.__NF_WIDGET_LOADED__ = true;

    // NF snippet expects these globals
    window.$_Widget = window.$_Widget || {};
    window.$_NFW = window.$_NFW || {};

    function inject() {
      // If script already exists, just try initialize
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
        try {
          if (window.$_NFW && typeof window.$_NFW.initialize === "function") {
            window.$_NFW.initialize();
          } else {
            console.warn("[UEF] Widget script loaded but $_NFW.initialize not found yet.");
          }
        } catch (e) {
          console.error("[UEF] initialize() failed:", e);
        }
      };

      (document.head || document.documentElement).appendChild(s1);
      console.log("[UEF] Injected NF widget script.");
    }

    // Run now + again after SPA route changes (Ultra is SPA-like)
    inject();

    // Try again after load (sometimes Ultra modifies DOM late)
    window.addEventListener("load", inject, { once: true });

    // Watch for DOM changes; if Ultra swaps root nodes, ensure widget remains injected
    var mo = new MutationObserver(function () {
      inject();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

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
