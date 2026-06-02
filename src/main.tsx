import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root was not found.");
}

if (import.meta.env.DEV && typeof performance !== "undefined" && performance.measure) {
  // React 19.2's dev-only "Component Tracks" instrumentation structured-clones
  // each render's changed props into performance.measure()'s `detail`. While
  // scrubbing, the slice panes re-render every frame with fresh multi-MB pixel
  // arrays, so the browser ends up cloning megabytes per frame — it throws
  // "Data cannot be cloned, out of memory", which corrupts React's internal
  // state ("Should not already be working") and freezes the viewer mid-drag.
  // None of this exists in production builds. Strip the heavy `detail` here so
  // the perf-track timings still record but the giant payload is never cloned.
  const originalMeasure = performance.measure.bind(performance);
  performance.measure = ((measureName: string, startOrOptions?: unknown, endMark?: string) => {
    if (
      startOrOptions &&
      typeof startOrOptions === "object" &&
      "detail" in (startOrOptions as Record<string, unknown>)
    ) {
      const stripped: Record<string, unknown> = { ...(startOrOptions as Record<string, unknown>) };
      delete stripped.detail;
      return originalMeasure(measureName, stripped as PerformanceMeasureOptions);
    }
    return originalMeasure(
      measureName,
      startOrOptions as string | PerformanceMeasureOptions | undefined,
      endMark,
    );
  }) as typeof performance.measure;
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
