import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { system } from "./services/ipc";

// Intercept console messages
const originalLog = console.log;
const originalError = console.error;

console.log = (...args) => {
  originalLog(...args);
  system.log("info", args.map(arg => typeof arg === "object" ? JSON.stringify(arg) : String(arg)).join(" "));
};

console.error = (...args) => {
  originalError(...args);
  system.log("error", args.map(arg => typeof arg === "object" ? JSON.stringify(arg) : String(arg)).join(" "));
};

window.onerror = (message, source, lineno, colno, error) => {
  system.log("error", `Global Error: ${message} at ${source}:${lineno}:${colno}${error ? ` (${error.message})` : ""}`);
  return false;
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
