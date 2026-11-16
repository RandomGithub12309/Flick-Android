import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./components/app-shell";
import "./styles.css";

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <AppShell />
    </StrictMode>,
  );
}
