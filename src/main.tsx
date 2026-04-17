import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";
import { registerSW } from "virtual:pwa-register";

if (import.meta.env.VITE_ELECTRON_BUILD !== "true") {
  registerSW({ immediate: true });
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
