/**
 * BottomDock Component — Full IDE Bottom Dock
 * Contains: Terminal (with multi-tab, quick presets, kill/clear), Problems Panel, Logs, Output, Tasks
 */
import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { terminal, git } from "../services/ipc";
import { ProjectInfo } from "../types/ipc";
import { CustomDialog } from "./GlobalDialog";
import { 
  Terminal as TerminalIcon, 
  AlertCircle, 
  FileText, 
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
}

function stripAnsi(text: string): string {
  if (!text) return "";
  const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
  return text.replace(ansiRegex, "");
}

const dockTabs = [
  { id: "terminal", label: "Terminal", icon: <TerminalIcon size={13} /> },
  { id: "problems", label: "Problems", icon: <AlertCircle size={13} /> },
  { id: "output", label: "Output", icon: <FileText size={13} /> },
  { id: "tasks", label: "Tasks", icon: <CheckCircle2 size={13} /> },
];

export function BottomDock({
  visible,
  onToggleVisibility,
  activeTab,
  onTabChange,
  activeProject,
  onOpenFile,
}: BottomDockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    if (visible) {
      setIsCollapsed(false);
    }
  }, [activeTab, visible]);

  const handleTabClick = (tabId: string) => {
    if (activeTab === tabId) {
      setIsCollapsed(!isCollapsed);
    } else {
      onTabChange(tabId);
      setIsCollapsed(false);
    }
  };

  let containerClass = "bottom-dock";
  if (!visible) {
    containerClass += " bottom-dock--hidden";
  } else if (isCollapsed) {
    containerClass += " bottom-dock--collapsed";
  } else if (isExpanded) {
    containerClass += " bottom-dock--maximized";
  }

  return (
    <div className={containerClass} style={{
      height: isExpanded ? "60vh" : isCollapsed ? 28 : 220,
      background: "var(--color-bg-base)",
      borderTop: "1px solid var(--color-border-default)",
      display: visible ? "flex" : "none",
      flexDirection: "column",
      zIndex: 30,
      transition: "height 0.2s ease",
    }}>
      {/* Tab bar header */}
      <div className="bottom-dock__tabs" style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        width: "100%",
        height: 28,
        background: "var(--color-bg-surface)",
        borderBottom: "1px solid var(--color-border-subtle)",
        padding: "0 8px",
        userSelect: "none",
      }}>
        <div style={{ display: "flex", gap: 4, height: "100%", alignItems: "center" }}>
          {dockTabs.map((tab) => (
            <button
              key={tab.id}
              className={`bottom-dock__tab ${activeTab === tab.id ? "bottom-dock__tab--active" : ""}`}
              onClick={() => handleTabClick(tab.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "0 10px",
                height: "100%",
                fontSize: "11.5px",
                background: "transparent",
                border: "none",
                borderBottom: activeTab === tab.id ? "2px solid var(--color-accent-primary)" : "2px solid transparent",
                color: activeTab === tab.id ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                cursor: "pointer",
                fontWeight: activeTab === tab.id ? 600 : 400,
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            className="btn btn--icon"
            onClick={() => setIsExpanded(!isExpanded)}
            disabled={isCollapsed}
            title={isExpanded ? "Restore panel size" : "Maximize panel size"}
            style={{ width: 22, height: 22, padding: 0 }}
          >
            {isExpanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>

          <button
            className="btn btn--icon"
            onClick={onToggleVisibility}
            title="Close panel"
            style={{ width: 22, height: 22, padding: 0 }}
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Content */}
      {visible && !isCollapsed && (
        <div className="bottom-dock__content" style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {activeTab === "terminal" && <TerminalPanel activeProject={activeProject} />}
          {activeTab === "problems" && <ProblemsPanel activeProject={activeProject} onOpenFile={onOpenFile} />}
          {activeTab === "output" && <OutputPanel activeProject={activeProject} />}
          {activeTab === "tasks" && <TasksPanel activeProject={activeProject} />}
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   Terminal Panel with Quick Process Killing and Real-time Stream
   ========================================================================= */

function TerminalPanel({ activeProject }: { activeProject: ProjectInfo | null }) {
  const [output, setOutput] = useState<string[]>([
    "Csotic Terminal v0.1.0 ready.",
    "Integrated development console for running build scripts, tests, and servers.",
  ]);
  const [inputCommand, setInputCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [running, setRunning] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  const eventsCountRef = useRef(0);

  useEffect(() => {
    let active = true;
    let unlistenFn: (() => void) | null = null;

    listen<{ text: string }>("terminal-output", (event) => {
      if (!active) return;
      setOutput((prev) => [...prev, stripAnsi(event.payload.text)]);
    }).then((fn) => {
      if (!active) {
        fn();
      } else {
        unlistenFn = fn;
      }
    });

    return () => {
      active = false;
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, []);

  const runCommand = async (command: string, approved = false) => {
    const projectPath = activeProject?.path || ".";
    if (!command.trim()) return;

    if (command === "__CLEAR__" || command.trim() === "clear" || command.trim() === "cls") {
      setOutput([]);
      setInputCommand("");
      return;
    }

    if (!approved) {
      setHistory((prev) => [...prev, command]);
      setHistoryIndex(-1);
      setInputCommand("");
    }

    eventsCountRef.current = 0;
    setRunning(true);

    try {
      const res = await terminal.executeCommand(projectPath, command, approved);
      setRunning(false);

      if (!res.success && res.error) {
        if (res.error.code === "Permission") {
          const confirmApprove = await CustomDialog.confirm(
            `Permission Required:\n\n${res.error.message}\n\nDo you want to authorize and execute this command?`
          );
          if (confirmApprove) {
            await runCommand(command, true);
          }
        } else {
          setOutput((prev) => [...prev, `Command Error: ${res.error?.message}`]);
        }
      }
    } catch (err: any) {
      setRunning(false);
      setOutput((prev) => [...prev, `Execution Error: ${err?.message || String(err)}`]);
    }
  };

  const handleStop = async () => {
    await terminal.cancelCommand();
    setRunning(false);
    setOutput((prev) => [...prev, "^C (Process terminated)"]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      void runCommand(inputCommand);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length > 0) {
        const nextIdx = historyIndex + 1 < history.length ? historyIndex + 1 : historyIndex;
        setHistoryIndex(nextIdx);
        setInputCommand(history[history.length - 1 - nextIdx]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        const nextIdx = historyIndex - 1;
        setHistoryIndex(nextIdx);
        setInputCommand(history[history.length - 1 - nextIdx]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInputCommand("");
      }
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Sleek Terminal Actions Bar (No Suggestion Chips) */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        padding: "3px 8px",
        background: "var(--color-panel-header-bg, var(--color-bg-surface))",
        borderBottom: "1px solid var(--color-border-subtle)",
        gap: 6,
      }}>
        {running && (
          <button
            className="btn btn--secondary"
            onClick={handleStop}
            style={{ height: 22, fontSize: "11px", padding: "0 8px", color: "#f87171", display: "flex", alignItems: "center", gap: 4 }}
          >
            <Square size={10} fill="#f87171" /> Stop Process
          </button>
        )}
        <button
          className="btn btn--icon"
          onClick={() => setOutput([])}
          title="Clear Terminal"
          style={{ width: 22, height: 22, padding: 0 }}
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Terminal Output Area */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "8px 12px",
        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
        fontSize: "12px",
        lineHeight: 1.45,
        color: "var(--color-terminal-text, var(--color-text-primary))",
        background: "var(--color-terminal-bg, var(--color-bg-base))",
      }}>
        {output.map((line, idx) => (
          <div key={idx} style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {line.startsWith("❯") ? (
              <span style={{ color: "#ef4444", fontWeight: "bold" }}>{line}</span>
            ) : line.includes("Error") || line.includes("failed") ? (
              <span style={{ color: "#ef4444" }}>{line}</span>
            ) : line.includes("✓") || line.includes("ready") ? (
              <span style={{ color: "#10b981" }}>{line}</span>
            ) : (
              line
            )}
          </div>
        ))}
        <div ref={terminalEndRef} />
      </div>

      {/* Terminal Input Bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        padding: "4px 8px",
        background: "var(--color-terminal-input-bg, var(--color-bg-surface))",
        borderTop: "1px solid var(--color-border-subtle)",
        gap: 6,
      }}>
        <span style={{ color: "#ef4444", fontFamily: "var(--font-mono)", fontSize: "12px", fontWeight: "bold" }}>❯</span>
        <input
          type="text"
          value={inputCommand}
          onChange={(e) => setInputCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={running ? "Command is running..." : "Type command and press Enter..."}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--color-text-primary)",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
          }}
        />
      </div>
    </div>
  );
}

/* =========================================================================
   Output Panel (Build logs & execution stream without prompt)
   ========================================================================= */

function OutputPanel({ activeProject: _activeProject }: { activeProject: ProjectInfo | null }) {
  const [logs, setLogs] = useState<string[]>([
    "Csotic System Log Stream",
    "Listening for background tasks, watchers, and build outputs...",
  ]);
  const outputEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setupListener = async () => {
      unlisten = await listen<{ text: string }>("terminal-output", (event) => {
        setLogs((prev) => [...prev, stripAnsi(event.payload.text)]);
      });
    };
    setupListener();
    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "4px 8px",
        background: "var(--color-panel-header-bg, var(--color-bg-surface))",
        borderBottom: "1px solid var(--color-border-subtle)",
        fontSize: "11px",
        color: "var(--color-text-tertiary)",
      }}>
        <span>Build & Output Channel</span>
        <button
          className="btn btn--icon"
          onClick={() => setLogs([])}
          title="Clear Output"
          style={{ width: 20, height: 20, padding: 0 }}
        >
          <Trash2 size={11} />
        </button>
      </div>
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "8px 12px",
        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
        fontSize: "11.5px",
        lineHeight: 1.45,
        color: "var(--color-terminal-text, var(--color-text-primary))",
        background: "var(--color-terminal-bg, var(--color-bg-base))",
      }}>
        {logs.map((l, i) => (
          <div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{l}</div>
        ))}
        <div ref={outputEndRef} />
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
        <div style={{ color: "var(--color-text-tertiary)", fontStyle: "italic", padding: "12px 0", display: "flex", alignItems: "center", gap: 6 }}>
          <CheckCircle2 size={14} style={{ color: "var(--color-success)" }} />
          <span>No workspace issues or merge conflicts detected.</span>
        </div>
      ) : (
        problems.map((p, i) => (
          <div
            key={i}
            onClick={() => onOpenFile?.(`${activeProject?.path}/${p.file}`)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              borderRadius: 4,
              cursor: "pointer",
              background: "rgba(239, 68, 68, 0.08)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              marginBottom: 4,
            }}
          >
            <AlertCircle size={14} style={{ color: "#ef4444" }} />
            <span style={{ fontWeight: 600, color: "#ef4444" }}>{p.file}</span>
            <span style={{ color: "var(--color-text-secondary)" }}>{p.message}</span>
          </div>
        ))
      )}
    </div>
  );
}

/* =========================================================================
   Tasks Panel (Interactive Process & Script Runner)
   ========================================================================= */

function TasksPanel({ activeProject }: { activeProject: ProjectInfo | null }) {
  const [runningTask, setRunningTask] = useState<string | null>(null);

  const TASKS = [
    { id: "dev", name: "Run Dev Server", cmd: "npm run dev", icon: "⚡" },
    { id: "build", name: "Build Project", cmd: "npm run build", icon: "📦" },
    { id: "test", name: "Run Tests", cmd: "npm test", icon: "🧪" },
    { id: "cargo_check", name: "Cargo Check", cmd: "cargo check", icon: "🦀" },
    { id: "salivo_run", name: "Salivo Run", cmd: "salivo run", icon: "🚀" },
  ];

  const handleRun = async (task: { id: string; name: string; cmd: string }) => {
    if (!activeProject) return;
    setRunningTask(task.id);
    try {
      await terminal.executeCommand(activeProject.path, task.cmd, true);
    } catch (e) {
      console.error(e);
    } finally {
      setRunningTask(null);
    }
  };

  return (
    <div style={{ padding: "12px", fontSize: "12px", color: "var(--color-text-secondary)", height: "100%", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>Active Project Tasks</div>
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: 2 }}>
            Root: <code>{activeProject?.path || "No project loaded"}</code>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
        {TASKS.map((t) => {
          const isRunning = runningTask === t.id;
          return (
            <button
              key={t.id}
              onClick={() => handleRun(t)}
              disabled={!activeProject || (runningTask !== null && !isRunning)}
              className="btn btn--secondary"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px",
                height: "auto",
                borderRadius: "var(--radius-sm)",
                background: isRunning ? "rgba(239, 68, 68, 0.15)" : undefined,
                borderColor: isRunning ? "#ef4444" : undefined,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span>{t.icon}</span>
                <span style={{ fontWeight: 500 }}>{t.name}</span>
              </div>
              <span style={{ fontSize: "10px", color: isRunning ? "#ef4444" : "var(--color-text-tertiary)" }}>
                {isRunning ? "Running..." : "▶"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
