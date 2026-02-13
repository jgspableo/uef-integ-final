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
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.static("public", { extensions: ["html"] }));
app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/uef.js", (req, res) => {
  const widgetUrl = getNfWidgetScriptUrl();
  res.type("application/javascript; charset=utf-8");

  const js = `
/**
 * UEF loader - DEBUG MODE
 */
(function () {
  try {
    if (window.__UEF_ZdEBUG_LOADED__) return;
    window.__UEF_ZdEBUG_LOADED__ = true;

    console.log("-----------------------------------------");
    console.log("[UEF] DEBUG LOADER STARTED");
    
    // 1. IFRAME DETECTOR
    if (window.self !== window.top) {
        console.error("[UEF] 🚨 CRITICAL WARNING: I am running inside an IFRAME.");
        console.error("[UEF] If the parent iframe is hidden (display: none), I will be invisible.");
        
        // Attempt to break out (Only works if Same-Origin, which BB is usually not)
        try {
            console.log("[UEF] Parent URL:", window.parent.location.href);
        } catch(e) {
            console.log("[UEF] Cannot access parent window (Cross-Origin Blocked).");
        }
    } else {
        console.log("[UEF] ✅ GOOD: Running in Top Window.");
    }

    // 2. THE BLUE BUTTON TEST (Sanity Check)
    function injectBlueButton() {
        var btn = document.createElement('button');
        btn.innerHTML = 'UEF IS HERE!';
        btn.style.position = 'fixed';
        btn.style.top = '100px';
        btn.style.left = '100px';
        btn.style.zIndex = '2147483647';
        btn.style.padding = '20px';
        btn.style.fontSize = '20px';
        btn.style.backgroundColor = 'blue';
        btn.style.color = 'white';
        btn.style.border = '5px solid yellow';
        btn.style.cursor = 'pointer';
        btn.onclick = function() { alert('I am alive!'); };
        
        (document.body || document.documentElement).appendChild(btn);
        console.log("[UEF] Injected Blue Debug Button.");
    }

    // 3. Inject Noodle Factory (Standard)
    function injectNF() {
       var s = document.createElement("script");
       s.src = "${widgetUrl}";
       s.async = true;
       s.onload = () => {
           console.log("[UEF] NF Script Loaded.");
           if (window.$_NFW) window.$_NFW.initialize();
       };
       document.head.appendChild(s);
       
       // Force Styles just in case
       var css = \`
        .noodle-factory-widget-wrapper {
            z-index: 2147483647 !important;
            position: fixed !important;
            bottom: 50px !important;
            right: 50px !important;
            height: auto !important;
            width: auto !important;
            overflow: visible !important;
            border: 5px solid red !important; /* VISUAL CONFIRMATION */
        }
       \`;
       var style = document.createElement('style');
       style.appendChild(document.createTextNode(css));
       document.head.appendChild(style);
    }

    injectBlueButton();
    injectNF();

  } catch (err) {
    console.error("[UEF] crashed:", err);
  }
})();
`;
  res.send(js);
});

app.listen(PORT, HOST, () => console.log(`Server listening`));
