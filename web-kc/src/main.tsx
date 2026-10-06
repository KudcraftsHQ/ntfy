import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import { applyTheme, useUi } from "./store/ui";
import { HttpError } from "./lib/api";
import { setOnCleared } from "./lib/auth";
import "./index.css";

applyTheme(useUi.getState().theme);
// ?theme=dark|light overrides the saved preference for this load (handy for screenshots/links).
const forced = new URLSearchParams(location.search).get("theme");
if (forced === "dark" || forced === "light") applyTheme(forced);

if (import.meta.env.PROD) registerSW({ immediate: true });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof HttpError && (e.status === 401 || e.status === 403 || e.status === 404)) && n < 2,
      refetchOnWindowFocus: true,
    },
  },
});

setOnCleared(() => queryClient.clear());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
