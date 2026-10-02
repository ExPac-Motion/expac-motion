import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import App from "./App.tsx";
import { ToastProvider } from "./components/Toast";

// Every deploy renames the hashed files under /assets and drops the old
// ones, so a tab opened before a deploy can't lazy-load a chunk it hasn't
// fetched yet ("Failed to fetch dynamically imported module" -- e.g. the
// quotation PDF on a Comms send). Two guards:
//  1. Fetch the lazy chunks in the background right after start-up, while
//     they still exist; once loaded they stay in memory for the tab's life.
//  2. If a chunk is already gone, reload once onto the new build. Guarded so
//     a genuinely broken chunk can't cause a reload loop.
const RELOAD_KEY = "expac:chunk-reload-at";
function reloadOntoNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // storage blocked -- still worth one reload
  }
  window.location.reload();
  return true;
}
window.addEventListener("vite:preloadError", (e) => {
  if (reloadOntoNewBuild()) e.preventDefault();
});
const warmLazyChunks = () => {
  Promise.all([
    import("jspdf"),
    import("html2canvas-pro"),
    import("leaflet"),
  ]).catch(() => reloadOntoNewBuild());
};
if ("requestIdleCallback" in window) {
  window.requestIdleCallback(warmLazyChunks, { timeout: 5000 });
} else {
  setTimeout(warmLazyChunks, 3000);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
