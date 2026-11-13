/**
 * BottomDock Component — IDE Bottom Dock
 * Contains: Terminal (live stream, cd, history, Stop) and Problems Panel.
 *
 * Anything that wants to run a command visibly dispatches
 *   window.dispatchEvent(new CustomEvent("csotic:open-terminal", { detail: { cmd, cwd? } }))
 * so the run shows up here with its prompt, Running state and Stop button.
 */
import { useState, useEffect, useRef } from "react";
import { listen } from "../services/events";
import { terminal, git } from "../services/ipc";
import { ProjectInfo } from "../types/ipc";
import {
  Terminal as TerminalIcon,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Square,
  Maximize2,
  Minimize2,
  X
} from "lucide-react";

interface BottomDockProps {
  visible: boolean;
  onToggleVisibility?: () => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  activeProject: ProjectInfo | null;
  onOpenFile?: (path: string) => void;
  theme?: "dark" | "light";
}

function stripAnsi(text: string): string {
  if (!text) return "";
  const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
  return text.replace(ansiRegex, "");
}

const IS_WINDOWS = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("win");
const MAX_LINES = 3000; // ponytail: fixed scrollback; virtualize the list if users need more

const dockTabs = [
  { id: "terminal", label: "Terminal", icon: <TerminalIcon size={13} /> },
  { id: "problems", label: "Problems", icon: <AlertCircle size={13} /> },
];

export function BottomDock({
  visible,
  onToggleVisibility,
  activeTab,
  onTabChange,
  activeProject,
  onOpenFile,
  theme = "dark",
}: BottomDockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const isLight = theme === "light";
  // Unknown/legacy tab ids (e.g. removed "output"/"tasks") fall back to the terminal.
  const currentTab = dockTabs.some((t) => t.id === activeTab) ? activeTab : "terminal";

  useEffect(() => {
    if (visible) {
      setIsCollapsed(false);
    }
  }, [activeTab, visible]);

  const handleTabClick = (tabId: string) => {
    if (currentTab === tabId) {
      setIsCollapsed(!isCollapsed);
    } else {
      onTabChange(tabId);
      setIsCollapsed(false);
    }
  };

  const showContent = visible && !isCollapsed;

  return (
    <div className="bottom-dock" style={{
      height: isExpanded && !isCollapsed ? "60vh" : isCollapsed ? 30 : 240,
      background: isLight ? "#ffffff" : "#08090d",
      borderTop: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)",
      display: visible ? "flex" : "none",
      flexDirection: "column",
      zIndex: 30,
      transition: "height 0.2s ease",
      flexShrink: 0,
    }}>
      {/* Tab bar header */}
      <div className="bottom-dock__tabs" style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        width: "100%",
        height: 30,
        flexShrink: 0,
        background: isLight ? "#f8fafc" : "#0d0e14",
        borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.06)",
        padding: "0 8px",
        userSelect: "none",
      }}>
        <div role="tablist" style={{ display: "flex", gap: 2, height: "100%", alignItems: "center" }}>
          {dockTabs.map((tab) => {
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                className={`bottom-dock__tab ${isActive ? "bottom-dock__tab--active" : ""}`}
                onClick={() => handleTabClick(tab.id)}
                title={isActive ? `${tab.label} (click to collapse)` : tab.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0 10px",
                  height: "100%",
                  fontSize: "11px",
                  background: isActive ? (isLight ? "#ffffff" : "rgba(255, 255, 255, 0.05)") : "transparent",
                  border: "none",
                  borderBottom: isActive ? "2px solid #ef4444" : "2px solid transparent",
                  color: isActive ? (isLight ? "#0f172a" : "#f8fafc") : (isLight ? "#64748b" : "#94a3b8"),
                  cursor: "pointer",
                  fontWeight: isActive ? 600 : 400,
                  transition: "all 0.12s ease",
                }}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            className="btn btn--icon"
            onClick={() => { setIsCollapsed(false); setIsExpanded(!isExpanded); }}
            title={isExpanded ? "Restore panel size" : "Maximize panel"}
            aria-label={isExpanded ? "Restore panel size" : "Maximize panel"}
            style={{ width: 22, height: 22, padding: 0, color: isLight ? "#64748b" : "#94a3b8" }}
          >
            {isExpanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>

          <button
            className="btn btn--icon"
            onClick={onToggleVisibility}
            title="Close Panel (Ctrl+`)"
            aria-label="Close panel"
            style={{ width: 22, height: 22, padding: 0, color: isLight ? "#64748b" : "#94a3b8" }}
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Content. Panels stay mounted (hidden) so terminal history and a running command survive
          tab switches, collapsing and closing the dock. */}
      <div className="bottom-dock__content" style={{ flex: 1, overflow: "hidden", display: showContent ? "flex" : "none", flexDirection: "column" }}>
        <div style={{ flex: 1, minHeight: 0, display: currentTab === "terminal" ? "flex" : "none", flexDirection: "column" }}>
          <TerminalPanel activeProject={activeProject} theme={theme} active={showContent && currentTab === "terminal"} />
        </div>
        {currentTab === "problems" && <ProblemsPanel activeProject={activeProject} onOpenFile={onOpenFile} />}
      </div>
    </div>
  );
}

/* =========================================================================
   Terminal Panel — one command at a time, live output, Stop kills the tree
   ========================================================================= */

function isAbsolutePath(p: string): boolean {
  return /^[a-zA-Z]:/.test(p) || p.startsWith("/") || p.startsWith("\\");
}

function folderName(p: string): string {
  return p.replace(/\\/g, "/").split("/").filter(Boolean).pop() || p;
}

function TerminalPanel({ activeProject, theme = "dark", active }: { activeProject: ProjectInfo | null; theme?: "dark" | "light"; active: boolean }) {
  const isLight = theme === "light";
  const [output, setOutput] = useState<string[]>([
    `Csotic Terminal — ${IS_WINDOWS ? "cmd.exe" : "sh"}. Each command runs in a fresh shell; cd is remembered.`,
  ]);
  const [inputCommand, setInputCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [running, setRunning] = useState(false);
  const [terminalCwd, setTerminalCwd] = useState<string>(() => activeProject?.path || ".");
  const runningRef = useRef(false);
  const cwdRef = useRef(terminalCwd);
  cwdRef.current = terminalCwd;
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stickToBottomRef = useRef(true);

  const append = (...lines: string[]) => {
    setOutput((prev) => {
      const next = prev.concat(lines);
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  };

  // Follow output only while the user is at the bottom; scrolling up pauses it.
  useEffect(() => {
    const el = outputRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [output]);

  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  useEffect(() => {
    if (activeProject?.path) {
      setTerminalCwd(activeProject.path);
    }
  }, [activeProject?.path]);

  useEffect(() => {
    let disposed = false;
    let unlistenFn: (() => void) | null = null;

    listen<{ text: string }>("terminal-output", (event) => {
      if (!disposed) append(stripAnsi(event.payload.text));
    }).then((fn) => {
      if (disposed) fn();
      else unlistenFn = fn;
    });

    return () => {
      disposed = true;
      unlistenFn?.();
    };
  }, []);

  const changeDirectory = async (rawTarget: string) => {
    let target = rawTarget.replace(/^\/d\s+/i, "").trim().replace(/^["']|["']$/g, "");
    if (!target || target === "~") {
      target = activeProject?.path || ".";
    }
    const base = cwdRef.current.replace(/[\\/]+$/, "");
    const candidate = isAbsolutePath(target) || base === "." ? target : `${base}/${target}`;

    // Let the shell resolve "..", relative paths and casing; it also proves the folder exists.
    const res = await terminal.executeCommand(candidate, IS_WINDOWS ? "cd" : "pwd", true);
    const resolved = res.success ? String((res.data as any)?.stdout || "").trim() : "";
    if (resolved) {
      setTerminalCwd(resolved);
    } else {
      append(`⚠️ cd: no such directory: ${target}`);
    }
  };

  const runCommand = async (rawCmd: string, cwdOverride?: string) => {
    const cmd = rawCmd.trim();
    if (!cmd) return;

    if (cmd === "clear" || cmd === "cls") {
      setOutput([]);
      return;
    }

    setHistory((prev) => (prev[prev.length - 1] === cmd ? prev : [...prev, cmd]));
    setHistoryIndex(-1);

    if (runningRef.current) {
      append(`⚠️ A command is still running. Stop it first (Ctrl+C or the Stop button).`);
      return;
    }

    append(`❯ ${cmd}`);
    stickToBottomRef.current = true;

    // Plain `cd x` or drive change `D:` changes the remembered cwd; `cd x && npm i` goes to the shell as-is.
    if (((cmd === "cd" || /^cd[\s/\\.]/i.test(cmd) || /^chdir\s/i.test(cmd)) && !/[&|]/.test(cmd)) || /^[a-zA-Z]:$/i.test(cmd)) {
      await changeDirectory(/^[a-zA-Z]:$/i.test(cmd) ? cmd + "/" : cmd.replace(/^(cd|chdir)/i, ""));
      return;
    }

    runningRef.current = true;
    setRunning(true);
    try {
      const res = await terminal.executeCommand(cwdOverride || cwdRef.current, cmd, true, true);
      if (!res.success) {
        append(`⚠️ ${res.error?.message || "Execution failed"}`);
      }
    } catch (err: any) {
      append(`⚠️ ${err?.message || "Execution failed"}`);
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  // Every "run this in the terminal" button in the app routes through here.
  const runCommandRef = useRef(runCommand);
  runCommandRef.current = runCommand;
  useEffect(() => {
    const onOpenTerminal = (e: Event) => {
      const detail = (e as CustomEvent<{ cmd?: string; cwd?: string }>).detail;
      if (detail?.cmd) void runCommandRef.current(detail.cmd, detail.cwd);
    };
    window.addEventListener("csotic:open-terminal", onOpenTerminal);
    return () => window.removeEventListener("csotic:open-terminal", onOpenTerminal);
  }, []);

  const handleStop = async () => {
    try {
      await terminal.cancelCommand();
      append("[Process terminated]");
    } catch (err) {
      console.error(err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (running) {
        const text = inputCommand;
        setInputCommand("");
        append(`❯ ${text}`);
        stickToBottomRef.current = true;
        void terminal.sendInput(text).catch((err) => {
          console.error("Failed to send terminal input:", err);
        });
        return;
      }
      void runCommand(inputCommand);
      setInputCommand("");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length > 0) {
        const nextIdx = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(nextIdx);
        setInputCommand(history[nextIdx]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex !== -1) {
        const nextIdx = historyIndex + 1;
        if (nextIdx < history.length) {
          setHistoryIndex(nextIdx);
          setInputCommand(history[nextIdx]);
        } else {
          setHistoryIndex(-1);
          setInputCommand("");
        }
      }
    } else if (e.key.toLowerCase() === "c" && e.ctrlKey && !e.shiftKey) {
      const input = e.currentTarget;
      const hasSelection = input.selectionStart !== input.selectionEnd;
      if (running) {
        e.preventDefault();
        void handleStop();
      } else if (!hasSelection) {
        e.preventDefault();
        if (inputCommand) append(`❯ ${inputCommand}^C`);
        setInputCommand("");
      }
    } else if (e.key.toLowerCase() === "l" && e.ctrlKey) {
      // Keep Ctrl+L local to the terminal (globally it toggles the AI slide).
      e.preventDefault();
      e.stopPropagation();
      setOutput([]);
    }
  };

  const mutedColor = isLight ? "#64748b" : "#94a3b8";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: isLight ? "#ffffff" : "#090a0f" }}>
      {/* Toolbar: shell + cwd on the left, Stop / Clear on the right */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "3px 10px",
        background: isLight ? "#f8fafc" : "#0d0f15",
        borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.05)",
        fontSize: "11px",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{
            fontSize: "10px",
            fontFamily: "var(--font-mono)",
            background: isLight ? "rgba(0, 0, 0, 0.05)" : "rgba(255, 255, 255, 0.05)",
            border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.08)",
            padding: "1px 5px",
            borderRadius: 3,
            color: isLight ? "#475569" : "#94a3b8",
            flexShrink: 0,
          }}>
            {IS_WINDOWS ? "cmd" : "sh"}
          </span>
          <span
            title={terminalCwd}
            style={{ fontSize: "11px", color: isLight ? "#334155" : "#94a3b8", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left" }}
          >
            {terminalCwd === "." ? (activeProject?.path || "app folder") : terminalCwd}
          </span>
          {running && (
            <span style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: 4, flexShrink: 0, fontSize: "10.5px", color: "#10b981" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px rgba(16, 185, 129, 0.5)" }} />
              Running
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {running && (
            <button
              onClick={handleStop}
              title="Stop running command (Ctrl+C)"
              style={{
                height: 20,
                fontSize: "10.5px",
                padding: "0 7px",
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: 3,
                color: "#ef4444",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Square size={9} fill="#ef4444" /> Stop
            </button>
          )}
          <button
            className="btn btn--icon"
            onClick={() => setOutput([])}
            title="Clear Terminal (Ctrl+L)"
            aria-label="Clear terminal"
            style={{ width: 20, height: 20, padding: 0, color: mutedColor }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Output */}
      <div
        ref={outputRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        onMouseUp={() => {
          if (!window.getSelection()?.toString()) inputRef.current?.focus();
        }}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 12px",
          fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace",
          fontSize: "12px",
          lineHeight: 1.5,
          color: isLight ? "#1e293b" : "#cbd5e1",
          background: isLight ? "#ffffff" : "#090a0f",
          cursor: "text",
        }}
      >
        {output.map((line, idx) => {
          const color = line.startsWith("❯")
            ? "#ef4444"
            : line.startsWith("⚠️") || /\b(error|failed)\b/i.test(line)
              ? "#f87171"
              : line.startsWith("✨")
                ? "#10b981"
                : undefined;
          return (
            <div key={idx} style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", color, fontWeight: line.startsWith("❯") ? 600 : undefined }}>
              {line || " "}
            </div>
          );
        })}
      </div>

      {/* Input */}
      <div style={{
        display: "flex",
        alignItems: "center",
        padding: "5px 10px",
        background: isLight ? "#f8fafc" : "#0c0d13",
        borderTop: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.06)",
        gap: 8,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: mutedColor, flexShrink: 0 }}>
          {terminalCwd === "." ? (activeProject?.name || "~") : folderName(terminalCwd)}
        </span>
        <span style={{ color: "#ef4444", fontFamily: "var(--font-mono)", fontSize: "11px", fontWeight: "bold" }}>❯</span>
        <input
          ref={inputRef}
          type="text"
          aria-label="Terminal command"
          spellCheck={false}
          autoComplete="off"
          value={inputCommand}
          onChange={(e) => setInputCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={running ? "Enter input for running process (or Ctrl+C to stop)..." : "Type a command and press Enter"}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: isLight ? "#0f172a" : "#f8fafc",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
          }}
        />
      </div>
    </div>
  );
}

/* =========================================================================
   Problems Panel with Diagnostic Navigator
   ========================================================================= */

interface ProblemItem {
  type: "error" | "warning";
  file: string;
  line: number;
  message: string;
}

function ProblemsPanel({ activeProject, onOpenFile }: { activeProject: ProjectInfo | null; onOpenFile?: (path: string) => void }) {
  const [problems, setProblems] = useState<ProblemItem[]>([]);

  useEffect(() => {
    if (!activeProject) {
      setProblems([]);
      return;
    }
    // Inspect Git status & diagnostic checks
    git.status(activeProject.path).then((res) => {
      if (res.success && res.data) {
        const raw = (res.data as any).status || "";
        const list: ProblemItem[] = [];
        raw.split("\n").forEach((l: string) => {
          if (l.startsWith("UU") || l.startsWith("AA")) {
            list.push({
              type: "error",
              file: l.substring(3).trim(),
              line: 1,
              message: "Git merge conflict detected in file",
            });
          }
        });
        setProblems(list);
      }
    });
  }, [activeProject]);

  return (
    <div style={{ padding: "8px 12px", height: "100%", overflowY: "auto", fontSize: "12px" }}>
      {problems.length === 0 ? (
        <div style={{ color: "var(--color-text-tertiary)", padding: "12px 0", display: "flex", alignItems: "center", gap: 6 }}>
          <CheckCircle2 size={14} style={{ color: "var(--color-success)" }} />
          <span>{activeProject ? "No merge conflicts detected." : "Open a folder to see problems."}</span>
        </div>
      ) : (
        problems.map((p, i) => (
          <button
            key={i}
            onClick={() => onOpenFile?.(`${activeProject?.path}/${p.file}`)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "6px 10px",
              borderRadius: 4,
              cursor: "pointer",
              background: "rgba(239, 68, 68, 0.08)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              marginBottom: 4,
              textAlign: "left",
              fontSize: "12px",
            }}
          >
            <AlertCircle size={14} style={{ color: "#ef4444", flexShrink: 0 }} />
            <span style={{ fontWeight: 600, color: "#ef4444" }}>{p.file}</span>
            <span style={{ color: "var(--color-text-secondary)" }}>{p.message}</span>
          </button>
        ))
      )}
    </div>
  );
}
