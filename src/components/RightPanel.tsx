/**
 * RightPanel Component
 * Context Panel for Csotic AI IDE.
 * Displays: Current objective, Live agent execution stepper, 
 * Retrieved memory bank, Project Truth Index, and Live Changed Files.
 */
import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { memory, indexing, git } from "../services/ipc";
import { ProjectInfo } from "../types/ipc";
import * as diff from "diff";
import {
  Layers,
  Target,
  Activity,
  Clock,
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
} from "lucide-react";

interface RightPanelProps {
  visible: boolean;
  onFileClick?: (path: string) => void;
  activeProject: ProjectInfo | null;
  width?: number;
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

export function RightPanel({ visible, onFileClick, activeProject, width }: RightPanelProps) {
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
        background: "rgba(11, 12, 16, 0.95)",
        backdropFilter: "blur(20px)",
        borderLeft: "1px solid rgba(255, 255, 255, 0.07)",
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
          padding: "12px 14px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
          background: "linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0) 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              background: "rgba(239, 68, 68, 0.12)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ef4444",
            }}
          >
            <Layers size={13} />
          </div>
          <span
            style={{
              fontSize: "12px",
              fontWeight: 700,
              letterSpacing: "0.4px",
              color: "#ffffff",
              textTransform: "uppercase",
            }}
          >
            Context Panel
          </span>
        </div>

        {/* Live Status Beacon */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "2px 8px",
            borderRadius: 12,
            background: isBusy
              ? "rgba(16, 185, 129, 0.12)"
              : agentState.status === "completed"
              ? "rgba(59, 130, 246, 0.12)"
              : "rgba(255, 255, 255, 0.04)",
            border: isBusy
              ? "1px solid rgba(16, 185, 129, 0.3)"
              : agentState.status === "completed"
              ? "1px solid rgba(59, 130, 246, 0.3)"
              : "1px solid rgba(255, 255, 255, 0.08)",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              backgroundColor: isBusy ? "#10b981" : agentState.status === "completed" ? "#3b82f6" : "#64748b",
              boxShadow: isBusy ? "0 0 8px #10b981" : "none",
            }}
          />
          <span
            style={{
              fontSize: "10px",
              fontWeight: 700,
              letterSpacing: "0.5px",
              color: isBusy ? "#34d399" : agentState.status === "completed" ? "#60a5fa" : "var(--color-text-tertiary)",
              textTransform: "uppercase",
            }}
          >
            {agentState.status}
          </span>
        </div>
      </div>

      {/* Main Scrollable Body */}
      <div
        className="right-panel__content"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* 1. Live Agent Execution Card */}
        <ModernCard
          icon={<Activity size={13} style={{ color: isBusy ? "#34d399" : "#ef4444" }} />}
          title="Agent Runtime"
          badge={
            agentState.status !== "idle" ? (
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "10px", color: "var(--color-text-tertiary)" }}>
                <Clock size={11} />
                <span>{(agentState.elapsed_ms / 1000).toFixed(1)}s</span>
              </div>
            ) : null
          }
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "11.5px", color: "var(--color-text-secondary)" }}>
            {isBusy ? (
              <Loader2 size={13} className="animate-spin" style={{ color: "#34d399", flexShrink: 0 }} />
            ) : agentState.status === "completed" ? (
              <CheckCircle2 size={13} style={{ color: "#3b82f6", flexShrink: 0 }} />
            ) : (
              <Circle size={13} style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }} />
            )}
            <span style={{ fontWeight: 500 }}>
              {agentState.status === "idle" && "Idle — waiting for command"}
              {agentState.status === "planning" && "Formulating execution plan…"}
              {agentState.status === "executing" &&
                `Running step ${agentState.current_step_idx !== null ? agentState.current_step_idx + 1 : ""}…`}
              {agentState.status === "verifying" && "Verifying outputs & syntax…"}
              {agentState.status === "completed" && "Task executed successfully!"}
            </span>
          </div>
        </ModernCard>

        {/* 2. Objective Card */}
        <ModernCard icon={<Target size={13} style={{ color: "#f59e0b" }} />} title="Objective">
          <div
            style={{
              fontSize: "12px",
              lineHeight: 1.45,
              color: agentState.status !== "idle" ? "#ffffff" : "var(--color-text-tertiary)",
              fontWeight: agentState.status !== "idle" ? 500 : 400,
              background: "rgba(255, 255, 255, 0.02)",
              border: "1px solid rgba(255, 255, 255, 0.05)",
              borderLeft: "2px solid #ef4444",
              borderRadius: "4px 6px 6px 4px",
              padding: "8px 10px",
              wordBreak: "break-word",
            }}
          >
            {agentState.objective || "No active objective"}
          </div>
        </ModernCard>

        {/* 3. Execution Plan Tasks Stepper */}
        <ModernCard
          icon={<Sparkles size={13} style={{ color: "#a855f7" }} />}
          title="Plan Tasks"
          badge={
            agentState.plan_steps.length > 0 ? (
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  padding: "1px 6px",
                  borderRadius: 8,
                  background: "rgba(168, 85, 247, 0.15)",
                  color: "#c084fc",
                }}
              >
                {agentState.plan_steps.filter((s) => s.status === "completed").length} / {agentState.plan_steps.length}
              </span>
            ) : null
          }
        >
          {agentState.plan_steps.length === 0 ? (
            <div style={{ color: "var(--color-text-tertiary)", fontSize: "11px", fontStyle: "italic", padding: "4px 0" }}>
              No execution plan loaded
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {agentState.plan_steps.map((step, idx) => {
                const isCurrent = step.status === "running";
                const isDone = step.status === "completed";

                return (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      padding: "6px 8px",
                      borderRadius: 6,
                      background: isCurrent
                        ? "rgba(239, 68, 68, 0.08)"
                        : isDone
                        ? "rgba(16, 185, 129, 0.04)"
                        : "rgba(255, 255, 255, 0.02)",
                      border: isCurrent
                        ? "1px solid rgba(239, 68, 68, 0.25)"
                        : "1px solid rgba(255, 255, 255, 0.04)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {/* Stepper Indicator */}
                    <div style={{ marginTop: 2, flexShrink: 0 }}>
                      {isDone && <CheckCircle2 size={13} style={{ color: "#10b981" }} />}
                      {isCurrent && <Loader2 size={13} className="animate-spin" style={{ color: "#ef4444" }} />}
                      {!isDone && !isCurrent && <Circle size={13} style={{ color: "rgba(255, 255, 255, 0.2)" }} />}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", flex: 1 }}>
                      <span
                        style={{
                          fontSize: "11.5px",
                          fontWeight: isCurrent ? 600 : 400,
                          color: isDone
                            ? "var(--color-text-tertiary)"
                            : isCurrent
                            ? "#ffffff"
                            : "var(--color-text-secondary)",
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

        {/* 4. Memory Bank Card */}
        <ModernCard
          icon={<Brain size={13} style={{ color: "#38bdf8" }} />}
          title="Memory Bank"
          badge={
            memories.length > 0 ? (
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  padding: "1px 5px",
                  borderRadius: 6,
                  background: "rgba(56, 189, 248, 0.15)",
                  color: "#38bdf8",
                }}
              >
                {memories.length}
              </span>
            ) : null
          }
        >
          {/* Quick Add Memory Input */}
          <form onSubmit={handleAddMemory} style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input
              type="text"
              placeholder="Add project guideline or rule…"
              value={newMemory}
              onChange={(e) => setNewMemory(e.target.value)}
              style={{
                flex: 1,
                fontSize: "11px",
                padding: "5px 9px",
                background: "rgba(0, 0, 0, 0.4)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 5,
                color: "#ffffff",
                outline: "none",
                transition: "border 0.15s ease",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.4)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.08)")}
            />
            <button
              type="submit"
              disabled={!newMemory.trim()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                height: 26,
                fontSize: "11px",
                fontWeight: 600,
                padding: "0 9px",
                background: !newMemory.trim() ? "rgba(239, 68, 68, 0.2)" : "#ef4444",
                color: "#ffffff",
                border: "none",
                borderRadius: 5,
                cursor: !newMemory.trim() ? "not-allowed" : "pointer",
                transition: "all 0.15s ease",
                flexShrink: 0,
              }}
            >
              <Plus size={12} />
              <span>Add</span>
            </button>
          </form>

          {memories.length === 0 ? (
            <div style={{ color: "var(--color-text-tertiary)", fontSize: "11px", fontStyle: "italic", padding: "4px 0" }}>
              No custom memories persisted yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto" }}>
              {memories.map((m) => (
                <div
                  key={m.id}
                  style={{
                    position: "relative",
                    background: "rgba(255, 255, 255, 0.02)",
                    border: "1px solid rgba(255, 255, 255, 0.05)",
                    borderRadius: 6,
                    padding: "7px 10px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    transition: "all 0.15s ease",
                  }}
                  className="memory-item-hover"
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span
                      style={{
                        fontSize: "9px",
                        fontWeight: 700,
                        padding: "1px 5px",
                        borderRadius: 4,
                        background: "rgba(56, 189, 248, 0.12)",
                        color: "#38bdf8",
                        textTransform: "uppercase",
                      }}
                    >
                      {m.category || "Guideline"}
                    </span>
                    <button
                      onClick={() => handleDeleteMemory(m.id)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--color-text-tertiary)",
                        cursor: "pointer",
                        padding: 2,
                        display: "flex",
                        alignItems: "center",
                      }}
                      title="Delete rule"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                  <div style={{ color: "var(--color-text-primary)", fontSize: "11.5px", lineHeight: 1.35 }}>
                    {m.summary}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ModernCard>

        {/* 5. Project Index Card */}
        <ModernCard icon={<Database size={13} style={{ color: "#10b981" }} />} title="Project Truth Index">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                <FolderGit2 size={13} style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }} />
                <span
                  style={{
                    fontSize: "11.5px",
                    fontWeight: 600,
                    color: "#ffffff",
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
                  fontWeight: 600,
                  padding: "3px 8px",
                  background: "rgba(239, 68, 68, 0.12)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  borderRadius: 5,
                  color: "#f87171",
                  cursor: indexingInProgress || !activeProject ? "not-allowed" : "pointer",
                  transition: "all 0.15s ease",
                  flexShrink: 0,
                }}
              >
                <RefreshCw size={10} className={indexingInProgress ? "animate-spin" : ""} />
                <span>{indexingInProgress ? "Indexing…" : "Re-Index"}</span>
              </button>
            </div>

            <div
              style={{
                fontSize: "11px",
                color: "var(--color-text-tertiary)",
                lineHeight: 1.4,
                background: "rgba(0, 0, 0, 0.3)",
                padding: "6px 8px",
                borderRadius: 5,
                border: "1px solid rgba(255, 255, 255, 0.04)",
              }}
            >
              {indexMessage || (indexSummary ? indexSummary.split("\n")[0] : "AST symbols & workspace index ready.")}
            </div>
          </div>
        </ModernCard>

        {/* 6. Files Changed Card */}
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
              icon={<FileCode size={13} style={{ color: "#ec4899" }} />}
              title="Files Changed"
              badge={
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "10.5px", fontFamily: "var(--font-mono)" }}>
                  <span style={{ color: "#34d399", fontWeight: 700 }}>+{totalAdded}</span>
                  <span style={{ color: "#f87171", fontWeight: 700 }}>-{totalRemoved}</span>
                </div>
              }
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {displayFiles.map((file, idx) => (
                  <div
                    key={idx}
                    onClick={() => onFileClick?.(file.path)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "5px 8px",
                      borderRadius: 5,
                      background: "rgba(255, 255, 255, 0.02)",
                      border: "1px solid rgba(255, 255, 255, 0.04)",
                      cursor: "pointer",
                      transition: "all 0.12s ease",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.02)")}
                    title={file.path}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 7, overflow: "hidden" }}>
                      <FileCode size={12} style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }} />
                      <div style={{ display: "flex", alignItems: "baseline", gap: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        <span style={{ fontSize: "11.5px", color: "var(--color-text-primary)", fontWeight: 500 }}>
                          {file.basename}
                        </span>
                        <span style={{ fontSize: "9.5px", color: "var(--color-text-tertiary)" }}>{file.dir}</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "10px", fontFamily: "var(--font-mono)", flexShrink: 0 }}>
                      <span style={{ color: "#34d399", fontWeight: 600 }}>+{file.added}</span>
                      <span style={{ color: "#f87171", fontWeight: 600 }}>-{file.removed}</span>
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

/** Reusable modern glassmorphic card container */
function ModernCard({
  icon,
  title,
  badge,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "rgba(255, 255, 255, 0.025)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
        borderRadius: 8,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        transition: "all 0.15s ease",
      }}
    >
      {/* Card Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {icon}
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.5px",
              color: "var(--color-text-tertiary)",
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
