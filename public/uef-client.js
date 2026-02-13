/* =========================================================
   UEF CLIENT (Help Provider + Panel Render)
   - Handshake: integration:hello
   - Authorize: authorization:authorize
   - Register help provider: help:register
   - On help click: open portal panel, render iframe -> widget-wrapper.html
========================================================= */

(function () {
  const cfg = window.__UEF_CONFIG__ || {};
  const lmsHost = cfg.lmsHost;
  const token = cfg.token;
  const portalTitle = cfg.portalTitle || "Mappy";
  const widgetWrapperPath = cfg.widgetWrapperPath || "/widget-wrapper.html";

  if (!lmsHost || !token) {
    console.warn(
      "[UEF] Missing lmsHost/token. This page is meant to be loaded by Learn/UEF."
    );
    return;
  }

  let port = null;
  let panelPortalId = null;

  // UEF requires you to "say hello" so Learn can return a MessagePort
  // (UEF docs: integration:hello + MessageChannel) :contentReference[oaicite:5]{index=5}
  function sayHello() {
    try {
      window.parent.postMessage({ type: "integration:hello" }, `${lmsHost}/*`);
    } catch (e) {
      console.error("[UEF] Failed to send integration:hello", e);
    }
  }

  function post(msg) {
    if (!port) return;
    port.postMessage(msg);
  }

  function openHelpPanelAndRender() {
    // Subscribe to portal:new so Learn responds with portalId
    post({
      type: "event:subscribe",
      subscriptions: ["portal:new"],
    });

    // Ask Learn to open a panel. Learn will respond with portal:panel:response
    post({
      type: "portal:panel",
      correlationId: "mappy-help-panel",
      panelType: "small",
      panelTitle: portalTitle,
      attributes: {
        onClose: { callbackId: "mappy-help-close" },
      },
    });
  }

  function renderIntoPanel(portalId) {
    const integrationHost = `${window.location.protocol}//${window.location.host}`;

    post({
      type: "portal:render",
      portalId,
      contents: {
        tag: "div",
        props: {
          style: {
            height: "100%",
            width: "100%",
            display: "flex",
            flexDirection: "column",
            margin: "0",
            padding: "0",
          },
        },
        children: [
          {
            tag: "iframe",
            props: {
              src: `${integrationHost}${widgetWrapperPath}`,
              style: {
                border: "0",
                width: "100%",
                height: "100%",
              },
              allow: "clipboard-read; clipboard-write;",
              referrerpolicy: "no-referrer-when-downgrade",
            },
          },
        ],
      },
    });
  }

  // Listen for the handshake response (Learn returns a MessagePort)
  window.addEventListener("message", (evt) => {
    // Must match the Learn host origin
    if (evt.origin !== lmsHost) return;

    // Learn responds with the MessagePort
    if (
      evt.data &&
      evt.data.type === "integration:hello" &&
      evt.ports &&
      evt.ports[0]
    ) {
      port = evt.ports[0];

      // Listen on the port for UEF messages
      port.onmessage = (m) => {
        const data = m.data || {};

        // Authorized OK
        if (data.type === "authorization:authorize") {
          // Register as a Help Provider so you appear in bottom-right "?" menu
          post({
            type: "help:register",
            provider: {
              id: "mappy-help",
              label: portalTitle,
              // optional: can be a URL to a 50x50 image you host
              // iconUrl: `${integrationHost}/icon.png`,
            },
          });

          return;
        }

        // Help menu item clicked
        if (data.type === "help:request") {
          // Open panel and render widget
          openHelpPanelAndRender();

          // Respond success back
          post({
            type: "help:response",
            requestId: data.requestId,
            status: "success",
          });

          return;
        }

        // Panel created -> gives portalId
        if (
          data.type === "portal:panel:response" &&
          data.correlationId === "mappy-help-panel"
        ) {
          if (data.status === "success" && data.portalId) {
            panelPortalId = data.portalId;
            renderIntoPanel(panelPortalId);
          } else {
            console.error("[UEF] portal:panel failed", data);
          }
          return;
        }

        // Panel closed callback
        if (
          data.type === "portal:callback" &&
          data.callbackId === "mappy-help-close"
        ) {
          panelPortalId = null;
          return;
        }
      };

      // Now authorize this integration with the 3LO token (UEF docs) :contentReference[oaicite:6]{index=6}
      post({ type: "authorization:authorize", token });
    }
  });

  // Kick off handshake
  sayHello();
})();
