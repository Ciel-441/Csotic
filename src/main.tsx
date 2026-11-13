import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { system } from "./services/ipc";
import { CustomDialog } from "./components/GlobalDialog";

// Globally redirect native browser alert to custom obsidian-crimson modal
window.alert = (msg?: any) => {
  void CustomDialog.alert(String(msg ?? ""));
};

// Capture unhandled errors for backend diagnostics
const originalError = console.error;
console.error = (...args) => {
  originalError(...args);
  try {
    const msg = args.map(arg => typeof arg === "object" ? (arg?.message || JSON.stringify(arg)) : String(arg)).join(" ");
    system.log("error", msg).catch(() => {});
  } catch {}
};

window.onerror = (message, source, lineno, colno, error) => {
  system.log("error", `Global Error: ${message} at ${source}:${lineno}:${colno}${error ? ` (${error.message})` : ""}`).catch(() => {});
  return false;
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
