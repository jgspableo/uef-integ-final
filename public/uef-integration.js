// public/uef-integration.js

let messageChannel;

// 1. Listen for the Handshake [cite: 202]
window.addEventListener("message", (event) => {
  if (event.data.type === "integration:hello") {
    messageChannel = event.ports[0];
    messageChannel.onmessage = onChannelMessage;

    // 2. Send Authorization [cite: 214]
    messageChannel.postMessage({
      type: "authorization:authorize",
      token: window.UEF_CONFIG.restToken,
    });
  }
});

function onChannelMessage(event) {
  const data = event.data;

  // 3. Subscribe to Events [cite: 240]
  if (data.type === "authorization:authorize") {
    messageChannel.postMessage({
      type: "event:subscribe",
      subscriptions: ["portal:new"],
    });
  }

  // 4. Handle Portal Discovery (Render Button) [cite: 246, 259]
  if (data.type === "event:event" && data.eventType === "portal:new") {
    if (data.selector === "course.outline.details") {
      messageChannel.postMessage({
        type: "portal:render",
        portalId: data.portalId,
        contents: {
          tag: "div",
          props: { className: "uef--course-details--container" },
          children: [
            {
              tag: "button",
              props: {
                className: "uef--button--course-details",
                onClick: { callbackId: "noodle-launch-click" },
                style: { cursor: "pointer", padding: "10px", width: "100%" },
              },
              children: "Ask AI Tutor",
            },
          ],
        },
      });
    }
  }

  // 5. Handle Button Click (Open Panel) [cite: 250, 286]
  if (
    data.type === "portal:callback" &&
    data.callbackId === "noodle-launch-click"
  ) {
    messageChannel.postMessage({
      type: "portal:panel",
      correlationId: "noodle-panel-req",
      panelType: "small",
      panelTitle: "Noodle Factory AI Tutor",
      attributes: { onClose: { callbackId: "noodle-panel-close" } },
    });
  }

  // 6. Render Widget into Panel [cite: 253, 300]
  if (
    data.type === "portal:panel:response" &&
    data.correlationId === "noodle-panel-req"
  ) {
    const widgetUrl = `/widget-wrapper.html?userId=${window.UEF_CONFIG.userId}&courseId=${window.UEF_CONFIG.courseId}`;
    messageChannel.postMessage({
      type: "portal:render",
      portalId: data.portalId,
      contents: {
        tag: "iframe",
        props: {
          src: widgetUrl,
          style: { height: "100%", width: "100%", border: "none" },
        },
      },
    });
  }
}

// Start Handshake
window.parent.postMessage({ type: "integration:hello" }, "*");
