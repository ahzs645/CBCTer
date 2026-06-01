import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root was not found.");
}

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  // The service worker injects the COOP/COEP headers that make the page
  // cross-origin isolated (required for SharedArrayBuffer / threaded wasm) on
  // hosts that can't send them, e.g. GitHub Pages. On the very first visit the
  // worker isn't controlling the document yet, so once it takes over we reload
  // once to pick up the isolated context. The sessionStorage guard prevents a
  // reload loop on browsers where isolation can't be achieved.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (window.crossOriginIsolated) return;
    if (sessionStorage.getItem("coiReloaded")) return;
    sessionStorage.setItem("coiReloaded", "1");
    window.location.reload();
  });

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    });
  });
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
