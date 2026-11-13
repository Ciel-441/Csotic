import { XCircle, AlertTriangle, Terminal as TerminalIcon } from "lucide-react";

interface StatusBarProps {
  line?: number;
  col?: number;
  language?: string;
  onToggleProblems?: () => void;
  onToggleTerminal?: () => void;
  errorCount?: number;
  warnCount?: number;
  theme?: "dark" | "light";
}

export function StatusBar({
  line = 1,
  col = 1,
  language = "PLAINTEXT",
  onToggleProblems,
  onToggleTerminal,
  errorCount = 0,
  warnCount = 0,
  theme = "dark",
}: StatusBarProps) {
  const isLight = theme === "light";
  const muted = isLight ? "#64748b" : "#94a3b8";
  const displayLang = language ? language.toUpperCase() : "PLAINTEXT";

  return (
    <footer
      style={{
        width: "100vw",
        height: 24,
        minHeight: 24,
        maxHeight: 24,
        background: isLight ? "#f8fafc" : "#0a0b10",
        borderTop: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.07)",
        color: muted,
        fontSize: "11px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 10px",
        userSelect: "none",
        zIndex: 900,
        boxSizing: "border-box",
        fontFamily: "var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4, height: "100%" }}>
        <button className="statusbar__btn" onClick={onToggleProblems} title="Show Problems">
          <XCircle size={12} style={{ color: errorCount > 0 ? "#f87171" : undefined }} />
          <span style={{ color: errorCount > 0 ? "#f87171" : undefined }}>{errorCount}</span>
          <AlertTriangle size={12} style={{ marginLeft: 2, color: warnCount > 0 ? "#fbbf24" : undefined }} />
          <span style={{ color: warnCount > 0 ? "#fbbf24" : undefined }}>{warnCount}</span>
        </button>

        <button className="statusbar__btn" onClick={onToggleTerminal} title="Show Terminal (Ctrl+`)">
          <TerminalIcon size={12} />
          <span>Terminal</span>
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, height: "100%" }}>
        <span style={{ color: isLight ? "#1e293b" : "#d4d4d8" }}>Ln {line}, Col {col}</span>
        <span style={{ color: isLight ? "#1e293b" : "#cbd5e1", fontWeight: 600 }}>{displayLang}</span>
      </div>
    </footer>
  );
}
