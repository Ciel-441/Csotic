/**
 * RightPanel Component
 * Context Panel for Csotic AI IDE.
 * Displays: Current objective, Live agent execution stepper, 
 * Retrieved memory bank, Project Truth Index, and Live Changed Files.
 */
import { useState, useEffect } from "react";
import { listen } from "../services/events";
import { memory, indexing, git } from "../services/ipc";
import { ProjectInfo } from "../types/ipc";
import * as diff from "diff";
import {
  Layers,
  Target,
  CheckCircle2,
  Loader2,
  Circle,
  Brain,
  Plus,
  Trash2,
  RefreshCw,
  FileCode,
  FolderGit2,
  Sparkles,
  Database,
  X,
} from "lucide-react";

interface RightPanelProps {
  visible: boolean;
  onClose?: () => void;
  onFileClick?: (path: string) => void;
  activeProject: ProjectInfo | null;
  width?: number;
  theme?: "dark" | "light";
}

interface PlanStep {
  description: string;
  status: string; // "pending" | "running" | "completed" | "failed"
  files?: string[];
}

interface AgentState {
  status: string; // "idle" | "planning" | "executing" | "verifying" | "completed"
  objective: string;
  plan_steps: PlanStep[];
  current_step_idx: number | null;
  elapsed_ms: number;
}

interface MemoryItem {
  id: string;
  category: string;
  summary: string;
  source: string;
  confidence: number;
  created_at: string;
}

export function RightPanel({ visible, onClose, onFileClick, activeProject, width, theme = "dark" }: RightPanelProps) {
  const isLight = theme === "light";
  const [agentState, setAgentState] = useState<AgentState>({
    status: "idle",
    objective: "No active task",
    plan_steps: [],
    current_step_idx: null,
    elapsed_ms: 0,
  });

  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [newMemory, setNewMemory] = useState("");
  const [indexMessage, setIndexMessage] = useState("");
  const [indexSummary, setIndexSummary] = useState<string>("");
  const [indexingInProgress, setIndexingInProgress] = useState(false);
  const [numstat, setNumstat] = useState<{
    filesCount: number;
    added: number;
    removed: number;
    files: { path: string; basename: string; dir: string; added: number; removed: number }[];
  } | null>(null);
  const [sessionFiles, setSessionFiles] = useState<
    { path: string; basename: string; dir: string; added: number; removed: number }[]
  >([]);

  // Load project index summary whenever active project changes
  useEffect(() => {
    if (!activeProject?.path) {
      setIndexSummary("");
      setIndexMessage("");
      return;
    }

    const loadSummary = async () => {
      try {
        const res = await indexing.getSummary(activeProject.path);
        if (res.success && res.data && (res.data as any).summary) {
          setIndexSummary((res.data as any).summary);
        }
      } catch {}
    };

    void loadSummary();
  }, [activeProject?.path]);

  useEffect(() => {
    if (!activeProject) {
      setNumstat(null);
      return;
    }

    let active = true;

    const fetchNumstat = async () => {
      const res = await git.numstat(activeProject.path);
      if (!active) return;
      if (res.success && res.data) {
        const out = (res.data as any).numstat || "";
        let totalAdded = 0;
        let totalRemoved = 0;
        const files: { path: string; basename: string; dir: string; added: number; removed: number }[] = [];

        out.split("\n").forEach((line: string) => {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3) {
            const add = parseInt(parts[0], 10);
            const rem = parseInt(parts[1], 10);
            const relPath = parts.slice(2).join(" ");
            if (!isNaN(add)) totalAdded += add;
            if (!isNaN(rem)) totalRemoved += rem;
            if (relPath) {
              const fullPath = `${activeProject.path}/${relPath}`;
              const pathParts = relPath.split("/");
              const basename = pathParts.pop() || relPath;
              const dir = pathParts.join("/");

              files.push({
                path: fullPath,
                basename,
                dir,
                added: isNaN(add) ? 0 : add,
                removed: isNaN(rem) ? 0 : rem,
              });
            }
          }
        });
        setNumstat({
          filesCount: files.length,
          added: totalAdded,
          removed: totalRemoved,
          files,
        });
      }
    };

    fetchNumstat();

    let unlisten: (() => void) | undefined;
    const setupListener = async () => {
      unlisten = await listen<AgentState>("agent-state-update", () => {
        fetchNumstat();
      });
    };

    setupListener();

    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, [activeProject, agentState.plan_steps]);

  const refreshMemories = async () => {
    const res = await memory.getMemories();
    if (res.success && Array.isArray(res.data)) {
      setMemories(res.data as MemoryItem[]);
    }
  };

  // Listen for agent updates
  useEffect(() => {
    if (!visible) return;

    let unlistenAgent: (() => void) | undefined;
    let unlistenFileEdited: (() => void) | undefined;

    const setupListener = async () => {
      unlistenAgent = await listen<AgentState>("agent-state-update", (event) => {
        setAgentState(event.payload);
        if (event.payload.status === "completed") {
          refreshMemories();
        }
      });

      unlistenFileEdited = await listen<{ path: string; oldContent: string; newContent: string }>(
        "agent-file-edited",
        (event) => {
          const { path, oldContent, newContent } = event.payload;
          let added = 0;
          let removed = 0;
          try {
            const diffParts = diff.diffLines(oldContent || "", newContent || "");
            diffParts.forEach((part) => {
              const count = part.value.split("\n").filter((l) => l.trim().length > 0).length;
              if (part.added) added += count;
              if (part.removed) removed += count;
            });
          } catch (e) {}

          const pathParts = path.split(/[/\\]/);
          const basename = pathParts.pop() || path;
          const dir = pathParts.join("/");

          setSessionFiles((prev) => {
            const filtered = prev.filter((f) => f.path !== path);
            return [{ path, basename, dir, added, removed }, ...filtered];
          });
        }
      );
    };

    setupListener();
    refreshMemories();

    return () => {
      if (unlistenAgent) unlistenAgent();
      if (unlistenFileEdited) unlistenFileEdited();
    };
  }, [visible]);

  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemory.trim()) return;

    const res = await memory.addMemory(null, "Convention", newMemory.trim(), "User Input");

    if (res.success) {
      setNewMemory("");
      refreshMemories();
    }
  };

  const handleDeleteMemory = async (id: string) => {
    const res = await memory.deleteMemory(id);
    if (res.success) {
      refreshMemories();
    }
  };

  const formatStepText = (raw: string) => {
    let clean = raw.trim();
    const funcMatch = clean.match(/^(\w+)\((.*)\)$/);
    if (funcMatch) {
      const fn = funcMatch[1];
      const arg = funcMatch[2].replace(/["']/g, "");
      if (fn === "read_file") return `Read ${arg}`;
      if (fn === "create_file") return `Create ${arg}`;
      if (fn === "modify_file") return `Edit ${arg}`;
      if (fn === "delete_file") return `Delete ${arg}`;
      if (fn === "execute_command") return `Run \`${arg}\``;
      if (fn === "search_symbols") return `Search symbol ${arg}`;
      if (fn === "list_files") return `List directory ${arg}`;
      return `${fn}: ${arg}`;
    }
    return clean;
  };

  if (!visible) {
    return <div className="right-panel right-panel--collapsed" />;
  }

  const isBusy = agentState.status !== "idle" && agentState.status !== "completed";

  return (
    <aside
      className="right-panel"
      style={{
        background: isLight ? "#ffffff" : "#0a0b10",
        borderLeft: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.07)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        width: visible ? (width ? `${width}px` : "var(--right-panel-width)") : 0,
        minWidth: visible ? (width ? `${width}px` : "var(--right-panel-width)") : 0,
        maxWidth: visible ? (width ? `${width}px` : "var(--right-panel-width)") : 0,
      }}
    >
      {/* Sleek Top Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          height: 38,
          borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.06)",
          background: isLight ? "#f8fafc" : "#0d0e14",
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Layers size={13} style={{ color: isLight ? "#64748b" : "#94a3b8" }} />
          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.06em",
              color: isLight ? "#0f172a" : "#cbd5e1",
              textTransform: "uppercase",
            }}
          >
            Context Telemetry
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Live Status Beacon */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "2px 7px",
              borderRadius: 4,
              background: isBusy
                ? "rgba(16, 185, 129, 0.1)"
                : agentState.status === "completed"
                ? "rgba(56, 189, 248, 0.1)"
                : "rgba(255, 255, 255, 0.04)",
              border: isBusy
                ? "1px solid rgba(16, 185, 129, 0.25)"
                : agentState.status === "completed"
                ? "1px solid rgba(56, 189, 248, 0.25)"
                : "1px solid rgba(255, 255, 255, 0.06)",
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                backgroundColor: isBusy ? "#10b981" : agentState.status === "completed" ? "#38bdf8" : "#64748b",
                boxShadow: isBusy ? "0 0 6px #10b981" : "none",
              }}
            />
            <span
              style={{
                fontSize: "9.5px",
                fontWeight: 600,
                letterSpacing: "0.05em",
                color: isBusy ? "#34d399" : agentState.status === "completed" ? "#38bdf8" : "#94a3b8",
                textTransform: "uppercase",
              }}
            >
              {agentState.status}
              {agentState.status !== "idle" && agentState.elapsed_ms > 0 && (
                <span style={{ marginLeft: 4, opacity: 0.8, fontFamily: "var(--font-mono, monospace)" }}>
                  · {(agentState.elapsed_ms / 1000).toFixed(1)}s
                </span>
              )}
            </span>
          </div>

          {/* Close / Hide Button */}
          {onClose && (
            <button
              onClick={onClose}
              title="Hide Context Panel (Ctrl+J)"
              aria-label="Close Context Panel"
              style={{
                background: "transparent",
                border: "none",
                color: "#64748b",
                cursor: "pointer",
                padding: "3px",
                borderRadius: "3px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "color 0.12s ease, background 0.12s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#f8fafc";
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "#64748b";
                e.currentTarget.style.background = "transparent";
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Main Scrollable Body */}
      <div
        className="right-panel__content"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {/* 1. Objective Card */}
        <ModernCard icon={<Target size={12} style={{ color: "#94a3b8" }} />} title="Objective">
          <div
            style={{
              fontSize: "11.5px",
              lineHeight: 1.45,
              color: agentState.status !== "idle" ? "#f1f5f9" : "#64748b",
              fontWeight: agentState.status !== "idle" ? 500 : 400,
              background: "#07080c",
              border: "1px solid rgba(255, 255, 255, 0.05)",
              borderLeft: agentState.status !== "idle" ? "2px solid #38bdf8" : "2px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "4px",
              padding: "7px 9px",
              wordBreak: "break-word",
            }}
          >
            {agentState.objective && agentState.objective !== "No active task"
              ? agentState.objective
              : "Ready for next instruction. No active agent task."}
          </div>
        </ModernCard>

        {/* 2. Execution Plan Stepper */}
        <ModernCard
          icon={<Sparkles size={12} style={{ color: "#94a3b8" }} />}
          title="Plan Steps"
          badge={
            agentState.plan_steps.length > 0 ? (
              <span
                style={{
                  fontSize: "9.5px",
                  fontWeight: 600,
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(255, 255, 255, 0.07)",
                  color: "#94a3b8",
                  fontFamily: "var(--font-mono, monospace)",
                }}
              >
                {agentState.plan_steps.filter((s) => s.status === "completed").length}/{agentState.plan_steps.length}
              </span>
            ) : null
          }
        >
          {agentState.plan_steps.length === 0 ? (
            <div style={{ color: "#64748b", fontSize: "11px", fontStyle: "italic", padding: "2px 0" }}>
              No execution plan loaded
            </div>
          ) : (
            <div style={{ position: "relative", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Connected vertical line */}
              <div
                style={{
                  position: "absolute",
                  left: 6,
                  top: 4,
                  bottom: 4,
                  width: 1,
                  background: "rgba(255, 255, 255, 0.08)",
                }}
              />
              {agentState.plan_steps.map((step, idx) => {
                const isCurrent = step.status === "running";
                const isDone = step.status === "completed";

                return (
                  <div
                    key={idx}
                    style={{
                      position: "relative",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 7,
                      padding: "3px 6px",
                      borderRadius: 4,
                      background: isCurrent ? "rgba(56, 189, 248, 0.05)" : "transparent",
                      border: isCurrent ? "1px solid rgba(56, 189, 248, 0.15)" : "1px solid transparent",
                      transition: "all 0.12s ease",
                    }}
                  >
                    {/* Stepper Node Indicator */}
                    <div
                      style={{
                        position: "absolute",
                        left: -18,
                        top: 2,
                        background: "#0a0b10",
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {isDone && <CheckCircle2 size={12} style={{ color: "#10b981" }} />}
                      {isCurrent && <Loader2 size={12} className="animate-spin" style={{ color: "#38bdf8" }} />}
                      {!isDone && !isCurrent && <Circle size={12} style={{ color: "#475569" }} />}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", flex: 1 }}>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: isCurrent ? 500 : 400,
                          color: isDone ? "#64748b" : isCurrent ? "#f8fafc" : "#cbd5e1",
                          lineHeight: 1.35,
                          wordBreak: "break-word",
                        }}
                      >
                        {formatStepText(step.description)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ModernCard>

        {/* 3. Memory Bank Card */}
        <ModernCard
          icon={<Brain size={12} style={{ color: "#94a3b8" }} />}
          title="Memory Bank"
          badge={
            memories.length > 0 ? (
              <span
                style={{
                  fontSize: "9.5px",
                  fontWeight: 600,
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(255, 255, 255, 0.07)",
                  color: "#94a3b8",
                  fontFamily: "var(--font-mono, monospace)",
                }}
              >
                {memories.length}
              </span>
            ) : null
          }
        >
          {/* Quick Add Memory Input */}
          <form onSubmit={handleAddMemory} style={{ display: "flex", gap: 5, marginBottom: 8 }}>
            <input
              type="text"
              placeholder="Add project guideline or rule…"
              value={newMemory}
              onChange={(e) => setNewMemory(e.target.value)}
              style={{
                flex: 1,
                fontSize: "11px",
                padding: "4px 8px",
                background: "#07080c",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 4,
                color: "#ffffff",
                outline: "none",
                transition: "border 0.12s ease",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(56, 189, 248, 0.4)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.08)")}
            />
            <button
              type="submit"
              disabled={!newMemory.trim()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                height: 25,
                fontSize: "10.5px",
                fontWeight: 500,
                padding: "0 8px",
                background: !newMemory.trim() ? "rgba(255, 255, 255, 0.03)" : "rgba(255, 255, 255, 0.08)",
                color: !newMemory.trim() ? "#64748b" : "#f8fafc",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 4,
                cursor: !newMemory.trim() ? "not-allowed" : "pointer",
                transition: "all 0.12s ease",
                flexShrink: 0,
              }}
            >
              <Plus size={11} />
              <span>Add</span>
            </button>
          </form>

          {memories.length === 0 ? (
            <div style={{ color: "#64748b", fontSize: "11px", fontStyle: "italic", padding: "2px 0" }}>
              No custom guidelines persisted.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 180, overflowY: "auto" }}>
              {memories.map((m) => (
                <div
                  key={m.id}
                  style={{
                    position: "relative",
                    background: "#07080c",
                    border: "1px solid rgba(255, 255, 255, 0.05)",
                    borderRadius: 4,
                    padding: "6px 8px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                    transition: "all 0.12s ease",
                  }}
                  className="memory-item-hover"
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span
                      style={{
                        fontSize: "9px",
                        fontWeight: 600,
                        padding: "1px 5px",
                        borderRadius: 3,
                        background: "rgba(255, 255, 255, 0.04)",
                        border: "1px solid rgba(255, 255, 255, 0.06)",
                        color: "#94a3b8",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {m.category || "Guideline"}
                    </span>
                    <button
                      onClick={() => handleDeleteMemory(m.id)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#64748b",
                        cursor: "pointer",
                        padding: 2,
                        display: "flex",
                        alignItems: "center",
                        transition: "color 0.12s ease",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#f87171")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "#64748b")}
                      title="Delete rule"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                  <div style={{ color: "#cbd5e1", fontSize: "11px", lineHeight: 1.35 }}>
                    {m.summary}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ModernCard>

        {/* 4. Project Truth Index */}
        <ModernCard icon={<Database size={12} style={{ color: "#94a3b8" }} />} title="Project Index">
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                <FolderGit2 size={12} style={{ color: "#64748b", flexShrink: 0 }} />
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 500,
                    color: "#cbd5e1",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {activeProject?.name || "No Project Open"}
                </span>
              </div>

              <button
                disabled={indexingInProgress || !activeProject}
                onClick={async () => {
                  const path = activeProject?.path;
                  if (!path) return;
                  setIndexingInProgress(true);
                  setIndexMessage("Indexing project files…");
                  try {
                    const res = await indexing.start(path);
                    if (res.success) {
                      const indexedCount = (res.data as any)?.indexed_files ?? "all";
                      setIndexMessage(`✓ Indexed ${indexedCount} files.`);
                      const sumRes = await indexing.getSummary(path);
                      if (sumRes.success && sumRes.data && (sumRes.data as any).summary) {
                        setIndexSummary((sumRes.data as any).summary);
                      }
                    } else {
                      setIndexMessage(res.error?.message || "Could not index project.");
                    }
                  } catch (err: any) {
                    setIndexMessage(String(err));
                  } finally {
                    setIndexingInProgress(false);
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: "10.5px",
                  fontWeight: 500,
                  padding: "2px 7px",
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 4,
                  color: "#cbd5e1",
                  cursor: indexingInProgress || !activeProject ? "not-allowed" : "pointer",
                  transition: "all 0.12s ease",
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  if (!indexingInProgress && activeProject) {
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
                    e.currentTarget.style.color = "#f8fafc";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
                  e.currentTarget.style.color = "#cbd5e1";
                }}
              >
                <RefreshCw size={10} className={indexingInProgress ? "animate-spin" : ""} />
                <span>{indexingInProgress ? "Indexing…" : "Re-Index"}</span>
              </button>
            </div>

            <div
              style={{
                fontSize: "10.5px",
                fontFamily: "var(--font-mono, monospace)",
                color: "#94a3b8",
                lineHeight: 1.4,
                background: "#07080c",
                padding: "6px 8px",
                borderRadius: 4,
                border: "1px solid rgba(255, 255, 255, 0.05)",
              }}
            >
              {indexMessage || (indexSummary ? indexSummary.split("\n")[0] : "AST symbols & workspace index ready.")}
            </div>
          </div>
        </ModernCard>

        {/* 5. Files Changed Card */}
        {(() => {
          const combinedMap = new Map<string, { path: string; basename: string; dir: string; added: number; removed: number }>();
          if (numstat?.files) {
            numstat.files.forEach((f) => combinedMap.set(f.path, f));
          }
          sessionFiles.forEach((f) => combinedMap.set(f.path, f));
          const displayFiles = Array.from(combinedMap.values());
          if (displayFiles.length === 0) return null;

          const totalAdded = displayFiles.reduce((acc, f) => acc + f.added, 0);
          const totalRemoved = displayFiles.reduce((acc, f) => acc + f.removed, 0);

          return (
            <ModernCard
              icon={<FileCode size={12} style={{ color: "#94a3b8" }} />}
              title="File Changes"
              badge={
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "10px", fontFamily: "var(--font-mono, monospace)" }}>
                  <span style={{ color: "#34d399", fontWeight: 600 }}>+{totalAdded}</span>
                  <span style={{ color: "#f87171", fontWeight: 600 }}>-{totalRemoved}</span>
                </div>
              }
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {displayFiles.map((file, idx) => (
                  <div
                    key={idx}
                    onClick={() => onFileClick?.(file.path)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "4px 7px",
                      borderRadius: 4,
                      background: "rgba(255, 255, 255, 0.015)",
                      border: "1px solid rgba(255, 255, 255, 0.04)",
                      cursor: "pointer",
                      transition: "all 0.12s ease",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.015)")}
                    title={file.path}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                      <FileCode size={11} style={{ color: "#64748b", flexShrink: 0 }} />
                      <div style={{ display: "flex", alignItems: "baseline", gap: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        <span style={{ fontSize: "11px", color: "#e2e8f0", fontWeight: 500 }}>
                          {file.basename}
                        </span>
                        <span style={{ fontSize: "9px", color: "#64748b" }}>{file.dir}</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "9.5px", fontFamily: "var(--font-mono, monospace)", flexShrink: 0 }}>
                      <span style={{ color: "#34d399" }}>+{file.added}</span>
                      <span style={{ color: "#f87171" }}>-{file.removed}</span>
                    </div>
                  </div>
                ))}
              </div>
            </ModernCard>
          );
        })()}
      </div>
    </aside>
  );
}

/** Reusable modern precision card container */
function ModernCard({
  icon,
  title,
  badge,
  children,
  isLight = false,
}: {
  icon: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  isLight?: boolean;
}) {
  return (
    <div
      style={{
        background: isLight ? "#f8fafc" : "rgba(255, 255, 255, 0.02)",
        border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.05)",
        borderRadius: 6,
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 7,
        transition: "all 0.12s ease",
      }}
    >
      {/* Card Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {icon}
          <span
            style={{
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.06em",
              color: isLight ? "#475569" : "#94a3b8",
              textTransform: "uppercase",
            }}
          >
            {title}
          </span>
        </div>
        {badge}
      </div>

      {/* Card Body */}
      <div>{children}</div>
    </div>
  );
}
