import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root was not found.");
}

const originalMeasure =
  import.meta.env.DEV &&
  typeof performance !== "undefined" &&
  typeof performance.measure === "function"
    ? performance.measure
    : null;

if (originalMeasure) {
  // React 19.2's dev-only Component Tracks walk every changed prop before
  // calling performance.measure(). During MPR scrubbing those props include
  // multi-MB slice buffers, producing multi-second pointer stalls in dev.
  // Hide measure before ReactDOM initializes so those tracks stay disabled.
  Object.defineProperty(performance, "measure", {
    configurable: true,
    value: undefined,
  });
}

const [{ default: React }, ReactDOM, { default: App }] = await Promise.all([
  import("react"),
  import("react-dom/client"),
  import("./App"),
]);

if (originalMeasure) {
  Object.defineProperty(performance, "measure", {
    configurable: true,
    value: originalMeasure,
  });
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
