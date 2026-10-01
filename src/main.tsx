import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { dropLegacyStorage } from "./stores/legacyStorage";
import "./index.css";

dropLegacyStorage();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
