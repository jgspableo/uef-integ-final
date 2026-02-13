import express from "express";

const app = express();
const PORT = Number(process.env.PORT || 10000);
const HOST = "0.0.0.0";

const NF_WIDGET_ID = (process.env.NF_WIDGET_ID || "").trim();
const NF_WIDGET_SCRIPT_URL = (process.env.NF_WIDGET_SCRIPT_URL || "").trim();

function getNfWidgetScriptUrl() {
  if (NF_WIDGET_SCRIPT_URL) return NF_WIDGET_SCRIPT_URL;
  if (!NF_WIDGET_ID) return "";
  return `https://portalapi.noodlefactory.ai/api/v1/widget/widget-sdk/${NF_WIDGET_ID}/widget.js`;
}

app.disable("x-powered-by");

// no cache while debugging
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// serve /public files (optional)
app.use(
  express.static("public", {
    extensions: ["html"],
  })
);

app.get("/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get("/uef.js", (req, res) => {
  const widgetUrl = getNfWidgetScriptUrl();
  res.type("application/javascript; charset=utf-8");

  if (!widgetUrl) {
    res
      .status(500)
      .send(
        `console.error("[UEF] Missing NF_WIDGET_ID or NF_WIDGET_SCRIPT_URL");`
      );
    return;
  }

  const js = `
(function () {
  try {
    // ---------------------------------------------------------
    // Target TOP window + document (Ultra UI)
    // ---------------------------------------------------------
    var topWin = window;
    try {
      if (window.top && window.top.document) topWin = window.top;
    } catch (e) {
      topWin = window;
    }
    var doc = topWin.document;

    // Guard
    if (topWin.__NF_WIDGET_LOADED_V2__) return;
    topWin.__NF_WIDGET_LOADED_V2__ = true;

    // Debug helper
    function log() {
      try { console.log.apply(console, arguments); } catch (_) {}
    }

    // ---------------------------------------------------------
    // 1) Visible proof we're injecting into TOP document:
    //    a red dot at bottom-left
    // ---------------------------------------------------------
    function injectDebugDot() {
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
      log("[UEF] Debug dot injected. compatMode =", doc.compatMode, "url =", doc.location && doc.location.href);
    }

    // ---------------------------------------------------------
    // 2) CSS overrides
    // ---------------------------------------------------------
    function injectStyles() {
      if (doc.getElementById("uef-nf-css-overrides")) return;

      var css = \`
        .noodle-factory-widget-wrapper{
          overflow: visible !important;
          height: auto !important;
          width: auto !important;
          position: fixed !important;
          bottom: 20px !important;
          right: 32px !important;
          z-index: 2147483647 !important;
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
          inset: auto !important;
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

    // ---------------------------------------------------------
    // 3) Hard enforcement + ensure widget is attached to BODY
    // ---------------------------------------------------------
    function ensureInBodyAndVisible() {
      var wrapper = doc.querySelector(".noodle-factory-widget-wrapper");
      if (wrapper && wrapper.parentElement !== doc.body && doc.body) {
        doc.body.appendChild(wrapper);
        log("[UEF] Moved widget wrapper to document.body");
      }

      if (wrapper) {
        wrapper.style.setProperty("position", "fixed", "important");
        wrapper.style.setProperty("bottom", "20px", "important");
        wrapper.style.setProperty("right", "32px", "important");
        wrapper.style.setProperty("z-index", "2147483647", "important");
        wrapper.style.setProperty("overflow", "visible", "important");
        wrapper.style.setProperty("pointer-events", "auto", "important");
        wrapper.style.setProperty("transform", "none", "important");
      }

      var btn = doc.querySelector(".noodle-factory-button-wrapper");
      if (btn) {
        btn.style.setProperty("width", "60px", "important");
        btn.style.setProperty("height", "60px", "important");
        btn.style.setProperty("display", "block", "important");
        btn.style.setProperty("visibility", "visible", "important");
        btn.style.setProperty("opacity", "1", "important");
        btn.style.setProperty("pointer-events", "auto", "important");
        btn.style.setProperty("transform", "none", "important");
        btn.style.setProperty("bottom", "20px", "important");
        btn.style.setProperty("right", "32px", "important");
        btn.style.setProperty("position", "fixed", "important");
        btn.style.setProperty("z-index", "2147483647", "important");
      }
    }

    // ---------------------------------------------------------
    // 4) Diagnostic snapshot: is the button actually there?
    // ---------------------------------------------------------
    function snapshot(label) {
      var btn = doc.querySelector(".noodle-factory-button-wrapper");
      var wrap = doc.querySelector(".noodle-factory-widget-wrapper");
      log("[UEF][SNAP]", label, {
        compatMode: doc.compatMode,
        hasWrapper: !!wrap,
        hasButton: !!btn
      });

      if (btn && btn.getBoundingClientRect) {
        var r = btn.getBoundingClientRect();
        log("[UEF][SNAP] button rect:", { x: r.x, y: r.y, w: r.width, h: r.height });
      }
    }

    // ---------------------------------------------------------
    // 5) Inject widget script into TOP document
    // ---------------------------------------------------------
    topWin.$_Widget = topWin.$_Widget || {};
    topWin.$_NFW = topWin.$_NFW || {};

    function injectWidgetScript() {
      if (doc.getElementById("sw-widget")) return;

      var s = doc.createElement("script");
      s.async = true;
      s.src = "${widgetUrl}";
      s.charset = "UTF-8";
      s.crossOrigin = "anonymous"; // valid value (not "*")
      s.id = "sw-widget";

      s.onload = function () {
        log("[UEF] Widget script loaded (top document).");
        try {
          if (topWin.$_NFW && typeof topWin.$_NFW.initialize === "function") {
            topWin.$_NFW.initialize();
            log("[UEF] $_NFW.initialize() called.");
          } else {
            log("[UEF] $_NFW.initialize not found.");
          }
        } catch (e) {
          console.error("[UEF] initialize error:", e);
        }

        // after load, take snapshots
        topWin.setTimeout(function () { ensureInBodyAndVisible(); snapshot("t+250ms"); }, 250);
        topWin.setTimeout(function () { ensureInBodyAndVisible(); snapshot("t+1s"); }, 1000);
        topWin.setTimeout(function () { ensureInBodyAndVisible(); snapshot("t+3s"); }, 3000);
      };

      (doc.head || doc.documentElement).appendChild(s);
      log("[UEF] Injected NF widget script into top window.");
    }

    // boot
    function boot() {
      injectDebugDot();
      injectStyles();
      injectWidgetScript();
      ensureInBodyAndVisible();
      snapshot("boot");
    }

    boot();

    // keep enforcing in Ultra SPA
    topWin.setInterval(function () {
      injectDebugDot();
      injectStyles();
      ensureInBodyAndVisible();
    }, 500);

    var mo = new topWin.MutationObserver(function () {
      ensureInBodyAndVisible();
    });

    function startObserver() {
      if (doc.body) mo.observe(doc.body, { childList: true, subtree: true });
      else topWin.setTimeout(startObserver, 100);
    }
    startObserver();

  } catch (err) {
    console.error("[UEF] loader crashed:", err);
  }
})();
`;
  res.send(js);
});

app.get("/", (req, res) => res.redirect("/widget-wrapper.html"));

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
