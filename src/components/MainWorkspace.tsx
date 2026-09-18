import { useEffect, useMemo, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { terminal } from "../services/ipc";
import { ProjectInfo, EditorTab } from "../types/ipc";
import { DiffViewer } from "./DiffViewer";
import { MonacoCodeEditor, getLanguageFromPath } from "./editor/MonacoCodeEditor";
import { EditorTabBar } from "./editor/EditorTabBar";
import { Breadcrumbs } from "./editor/Breadcrumbs";
import { InlineAICopilot } from "./editor/InlineAICopilot";
import { LiveWebPreview } from "./editor/LiveWebPreview";
import { MarkdownPreview } from "./editor/MarkdownPreview";
import { BrainGraphView } from "./brain/BrainGraphView";
import { ExtensionDetailView } from "./ExtensionDetailView";
import { AiCoderSlidePanel } from "../features/chat";
import { 
  Sparkles, 
  Search, 
  Terminal, 
  Code2, 
  X, 
  ArrowLeftRight, 
  Eye, 
} from "lucide-react";

export interface FileDiff {
  request_id?: string;
  path: string;
  oldContent: string;
  newContent: string;
}

interface MainWorkspaceProps {
  activeView: string;
  onViewChange: (view: string) => void;
  activeProject: ProjectInfo | null;
  activeModel: string | null;
  activeFile: string | null;
  openTabs?: EditorTab[];
  activeTabId?: string | null;
  onSelectTab?: (tabId: string) => void;
  onCloseTab?: (tabId: string, e: React.MouseEvent) => void;
  onCloseOthers?: (tabId: string) => void;
  onCloseAll?: () => void;
  onCloseSaved?: () => void;
  onTabContentChange?: (tabId: string, content: string) => void;
  onSaveTab?: (tabId: string) => void;
  onSaveAsTab?: (tabId: string) => void;
  isSplit?: boolean;
  onToggleSplit?: () => void;
  onOpenProject: (path: string) => void;
  conversationId: number;
  onConversationTitleChange: (conversationId: number, title: string) => void;
  permissionProfile: "read_only" | "edit" | "developer" | "full_automation";
  attachedProjectPaths: string[];
  onDetachProject: (path: string) => void;
  onPermissionProfileChange: (profile: "read_only" | "edit" | "developer" | "full_automation") => void;
  currentDiff: FileDiff | null;
  setCurrentDiff: (diff: FileDiff | null) => void;
  activeRightTab: "overview" | "editor" | "review";
  setActiveRightTab: (tab: "overview" | "editor" | "review") => void;
  onOpenSearch?: () => void;
  // ── Manual Coder Slide props ──
  aiSlideVisible?: boolean;
  onToggleAiSlide?: () => void;
  conversations?: Array<{ id: number; title: string }>;
  onSelectConversation?: (id: number) => void;
  onNewConversation?: () => void;
  onDeleteConversation?: (id: number) => void;
  onOpenFile?: (path: string) => void;
  theme?: "dark" | "light";
}

export function MainWorkspace(props: MainWorkspaceProps) {
  const {
    activeProject, activeModel,
    openTabs = [], activeTabId = null, onSelectTab, onCloseTab, onCloseOthers, onCloseAll, onCloseSaved, onTabContentChange, onSaveTab, onSaveAsTab,
    isSplit = false, onToggleSplit,
    onOpenProject: _onOpenProject, conversationId, onConversationTitleChange, permissionProfile, attachedProjectPaths, onDetachProject: _onDetachProject, onPermissionProfileChange: _onPermissionProfileChange,
    currentDiff, setCurrentDiff, setActiveRightTab, onOpenSearch,
    aiSlideVisible = false, onToggleAiSlide,
    conversations = [], onSelectConversation, onNewConversation, onDeleteConversation,
    onOpenFile,
    theme = "dark",
    onViewChange,
  } = props;

  const [cursorPos, setCursorPos] = useState({ line: 1, column: 1 });
  const [inlineAIState, setInlineAIState] = useState<{ open: boolean; selectedText: string; range: any | null }>({
    open: false,
    selectedText: "",
    range: null,
  });
  const [viewMode, setViewMode] = useState<"code" | "split" | "preview" | "diff">("code");
  const [splitActiveTabId, setSplitActiveTabId] = useState<string | null>(null);
  const [rightViewMode, setRightViewMode] = useState<"code" | "preview">("code");

  const [aiSlideWidth, setAiSlideWidth] = useState<number>(() => {
    const saved = localStorage.getItem("forge.ai_slide_width");
    return saved ? Math.max(300, Math.min(1100, Number(saved))) : 430;
  });
  const [isDraggingAiSlide, setIsDraggingAiSlide] = useState(false);

  const handleAiSlideResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingAiSlide(true);
    const startX = e.clientX;
    const startWidth = aiSlideWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.max(280, Math.min(window.innerWidth - 320, startWidth + delta));
      setAiSlideWidth(newWidth);
      localStorage.setItem("forge.ai_slide_width", String(newWidth));
    };

    const onMouseUp = () => {
      setIsDraggingAiSlide(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [aiSlideWidth]);

  const activeTab = openTabs.find((t) => t.id === activeTabId) || null;
  const isMarkdown = activeTab?.path.endsWith(".md") || false;
  const isHtml = activeTab?.path.endsWith(".html") || activeTab?.path.endsWith(".htm") || false;

  // Compute right secondary pane tab for double panel side-by-side editing
  const rightTab = useMemo(() => {
    if (splitActiveTabId) {
      const found = openTabs.find((t) => t.id === splitActiveTabId);
      if (found) return found;
    }
    // Default to the first open tab that is not the activeTab
    const otherTab = openTabs.find((t) => t.id !== activeTabId);
    if (otherTab) return otherTab;
    return activeTab;
  }, [splitActiveTabId, openTabs, activeTabId, activeTab]);

  const handleSwapPanes = () => {
    if (activeTab && rightTab && onSelectTab) {
      const prevLeft = activeTab.id;
      const prevRight = rightTab.id;
      onSelectTab(prevRight);
      setSplitActiveTabId(prevLeft);
    }
  };

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen<FileDiff>("agent-file-edited", (event) => {
      setCurrentDiff(event.payload);
      setActiveRightTab("review");
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [setCurrentDiff, setActiveRightTab]);

  const handleInlineAIAccept = (newCode: string) => {
    if (activeTab && onTabContentChange) {
      if (inlineAIState.selectedText && activeTab.content) {
        const updated = activeTab.content.replace(inlineAIState.selectedText, newCode);
        onTabContentChange(activeTab.id, updated);
      } else {
        onTabContentChange(activeTab.id, newCode);
      }
    }
    setInlineAIState({ open: false, selectedText: "", range: null });
  };

  // Handle AI slide "Apply to Active Tab" action
  const handleApplyToActiveTab = (code: string) => {
    if (activeTab && onTabContentChange) {
      onTabContentChange(activeTab.id, code);
    }
  };

  // Handle AI slide "Insert at Cursor" action
  const handleInsertAtCursor = (code: string) => {
    if (activeTab && onTabContentChange) {
      const content = activeTab.content || "";
      // Simple append at cursor position (end of content as fallback)
      const lines = content.split("\n");
      const insertLine = Math.min(cursorPos.line - 1, lines.length);
      lines.splice(insertLine, 0, code);
      onTabContentChange(activeTab.id, lines.join("\n"));
    }
  };

  const handleRunActiveFile = useCallback(async () => {
    if (!activeTab) return;
    const cleanPath = activeTab.path.replace(/\\/g, "/");
    const fileName = cleanPath.split("/").pop() || "";
    const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase() : "";
    const baseName = fileName.replace(/\.[^/.]+$/, "");
    const cwd = activeProject?.path || ".";
    const fileArg = fileName.includes(" ") ? `"${fileName}"` : fileName;
    const outArg = baseName.includes(" ") ? `"${baseName}.exe"` : `${baseName}.exe`;

    let runCmd = `node ${fileArg}`;
    if (ext === ".c") {
      runCmd = `gcc ${fileArg} -o ${outArg} && ${outArg}`;
    } else if (ext === ".cpp" || ext === ".cc" || ext === ".cxx") {
      runCmd = `g++ ${fileArg} -o ${outArg} && ${outArg}`;
    } else if (ext === ".py") {
      runCmd = `python ${fileArg}`;
    } else if (ext === ".rs") {
      runCmd = "cargo run";
    } else if (ext === ".go") {
      runCmd = `go run ${fileArg}`;
    } else if (ext === ".java") {
      runCmd = `java ${fileArg}`;
    } else if (ext === ".ts") {
      runCmd = `npx tsx ${fileArg}`;
    } else if (ext === ".sh") {
      runCmd = `bash ${fileArg}`;
    } else if (ext === ".ps1") {
      runCmd = `powershell -ExecutionPolicy Bypass -File ${fileArg}`;
    }

    // Toggle/open terminal bottom dock
    const event = new KeyboardEvent("keydown", { ctrlKey: true, key: "`" });
    window.dispatchEvent(event);

    try {
      await terminal.executeCommand(cwd, runCmd, true);
    } catch (e) {
      console.error("Run active file error:", e);
    }
  }, [activeTab, activeProject]);

  return (
    <main className="main-workspace" style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", overflow: "hidden", background: "var(--color-bg-base)", position: "relative" }}>
      {/* Top Tab Bar */}
      {openTabs.length > 0 && onSelectTab && onCloseTab && (
        <EditorTabBar
          tabs={openTabs}
          activeTabId={activeTabId}
          onSelectTab={onSelectTab}
          onCloseTab={onCloseTab}
          onCloseOthers={onCloseOthers}
          onCloseAll={onCloseAll}
          onCloseSaved={onCloseSaved}
          onSplitEditor={onToggleSplit}
          isSplit={isSplit}
          activeViewMode={viewMode}
          onViewModeChange={setViewMode}
          hasPreviewableFile={isMarkdown || isHtml}
          onRunCode={handleRunActiveFile}
        />
      )}

      {/* Breadcrumbs Navigation */}
      {activeTab && (
        <Breadcrumbs
          filePath={activeTab.path}
          projectPath={activeProject?.path}
        />
      )}

      {/* Central Editor + AI Slide Layout */}
      <div style={{ flex: 1, display: "flex", width: "100%", height: "100%", overflow: "hidden", position: "relative" }}>
        {openTabs.length === 0 ? (
          /* IDE Welcome / Quick Action Dashboard */
          <div className="ide-welcome-screen" style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "40px 20px",
            color: "var(--color-text-secondary)",
            userSelect: "none",
          }}>
            <img
              src="/forge-logo.png"
              alt="Csotic Logo"
              style={{
                width: 68,
                height: 68,
                borderRadius: "12px",
                objectFit: "cover",
                boxShadow: "0 0 30px rgba(239, 68, 68, 0.45)",
                border: "2px solid rgba(239, 68, 68, 0.5)",
                marginBottom: 16,
              }}
            />
            <h2 style={{ fontSize: "20px", fontWeight: 800, color: "var(--color-text-primary)", marginBottom: 8, letterSpacing: "1px" }}>
              CSOTIC ENGINEERING IDE
            </h2>
            <p style={{ fontSize: "13px", color: "var(--color-text-tertiary)", maxWidth: 440, textAlign: "center", lineHeight: 1.5, marginBottom: 24 }}>
              Open files from the Explorer on the left, press Ctrl+N for a new file, or toggle the AI Coder Slide with Ctrl+L.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, width: "100%", maxWidth: 460 }}>
              <button
                className="btn btn--secondary"
                onClick={onOpenSearch}
                style={{ padding: "12px 14px", justifyContent: "flex-start", gap: 10, fontSize: "12.5px" }}
              >
                <Search size={16} style={{ color: "#ef4444" }} />
                <span>Quick Open File</span>
                <span style={{ marginLeft: "auto", fontSize: "10.5px", opacity: 0.6 }}>Ctrl+P</span>
              </button>

              <button
                className="btn btn--secondary"
                onClick={onToggleAiSlide}
                style={{ padding: "12px 14px", justifyContent: "flex-start", gap: 10, fontSize: "12.5px" }}
              >
                <Sparkles size={16} style={{ color: "#ef4444" }} />
                <span>AI Coder Slide</span>
                <span style={{ marginLeft: "auto", fontSize: "10.5px", opacity: 0.6 }}>Ctrl+L</span>
              </button>

              <button
                className="btn btn--secondary"
                onClick={() => onViewChange?.("git")}
                style={{ padding: "12px 14px", justifyContent: "flex-start", gap: 10, fontSize: "12.5px" }}
              >
                <Code2 size={16} style={{ color: "#34d399" }} />
                <span>Source Control</span>
                <span style={{ marginLeft: "auto", fontSize: "10.5px", opacity: 0.6 }}>Git</span>
              </button>

              <button
                className="btn btn--secondary"
                onClick={() => {
                  const event = new KeyboardEvent("keydown", { ctrlKey: true, key: "`" });
                  window.dispatchEvent(event);
                }}
                style={{ padding: "12px 14px", justifyContent: "flex-start", gap: 10, fontSize: "12.5px" }}
              >
                <Terminal size={16} style={{ color: "#f59e0b" }} />
                <span>Terminal & Output</span>
                <span style={{ marginLeft: "auto", fontSize: "10.5px", opacity: 0.6 }}>Ctrl+`</span>
              </button>
            </div>
          </div>
        ) : (
          /* Main Editor Canvas / Split Panes */
          <div style={{ flex: 1, display: "flex", width: "100%", height: "100%", overflow: "hidden", position: "relative" }}>
            {/* Primary (Left) Editor Pane */}
            <div style={{ flex: 1, height: "100%", overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0 }}>
              {isSplit && (
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  height: 34,
                  background: "var(--color-panel-header-bg, var(--color-bg-surface))",
                  borderBottom: "1px solid var(--color-border-subtle)",
                  padding: "0 10px",
                  fontSize: "11.5px",
                  userSelect: "none",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden" }}>
                    <span style={{ fontSize: "10px", padding: "1px 5px", background: "rgba(239, 68, 68, 0.15)", color: "#ef4444", borderRadius: 3, fontWeight: 700 }}>
                      LEFT
                    </span>
                    {openTabs.length > 0 ? (
                      <select
                        value={activeTab?.id || ""}
                        onChange={(e) => onSelectTab?.(e.target.value)}
                        style={{
                          background: "var(--color-input-bg, var(--color-bg-base))",
                          border: "1px solid var(--color-border-subtle)",
                          color: "var(--color-text-primary)",
                          fontSize: "11.5px",
                          fontWeight: 600,
                          borderRadius: 4,
                          padding: "2px 8px",
                          cursor: "pointer",
                          maxWidth: 200,
                          outline: "none",
                        }}
                        title="Switch left panel file"
                      >
                        {openTabs.map((t) => (
                          <option key={t.id} value={t.id} style={{ background: "var(--color-bg-surface)", color: "var(--color-text-primary)" }}>
                            {t.title || t.path.split(/[/\\]/).pop()} {t.isDirty ? "•" : ""}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>
                        {activeTab?.title || activeTab?.path.split(/[/\\]/).pop() || "untitled"}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div style={{ flex: 1, height: isSplit ? "calc(100% - 34px)" : "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                {activeTab?.path?.startsWith("extension:") ? (
                  <ExtensionDetailView 
                    extension={activeTab.extensionData || { 
                      id: activeTab.path.replace("extension:", ""), 
                      displayName: activeTab.title.replace("Extension: ", ""), 
                      namespace: activeTab.path.replace("extension:", "").split(".")[0] || "", 
                      name: activeTab.path.replace("extension:", "").split(".")[1] || "" 
                    }} 
                  />
                ) : activeTab?.path === "forge://brain-graph" ? (
                  <BrainGraphView
                    projectPath={activeProject?.path || ""}
                    projectName={activeProject?.name}
                    onOpenNode={onOpenFile}
                    activeFilePath={activeTab?.path}
                    theme={theme}
                  />
                ) : viewMode === "preview" && isMarkdown ? (
                  <MarkdownPreview content={activeTab?.content || ""} onClose={() => setViewMode("code")} onOpenFile={onOpenFile} />
                ) : viewMode === "preview" ? (
                  <LiveWebPreview
                    htmlContent={activeTab?.content || ""}
                    defaultUrl={activeTab?.path ? `file://${activeTab.path}` : "http://localhost:5173"}
                    onClose={() => setViewMode("code")}
                  />
                ) : (
                  <MonacoCodeEditor
                    filePath={activeTab?.path || "untitled.txt"}
                    content={activeTab?.content || ""}
                    isDirty={activeTab?.isDirty}
                    theme={theme}
                    onChange={(val) => activeTab && onTabContentChange?.(activeTab.id, val)}
                    onSave={() => activeTab && onSaveTab?.(activeTab.id)}
                    onSaveAs={() => activeTab && onSaveAsTab?.(activeTab.id)}
                    onCursorChange={(line, column) => setCursorPos({ line, column })}
                    onTriggerInlineAI={(selectedText, range) => setInlineAIState({ open: true, selectedText, range })}
                  />
                )}
              </div>
            </div>

            {/* Split (Right) Editor Pane — Dual Code Editing */}
            {isSplit && (
              <div style={{
                flex: 1,
                borderLeft: "1px solid var(--color-border-default)",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                background: "var(--color-bg-base)",
                position: "relative",
                minWidth: 0,
              }}>
                {/* Secondary Pane Header Bar */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  height: 34,
                  background: "var(--color-panel-header-bg, var(--color-bg-surface))",
                  borderBottom: "1px solid var(--color-border-subtle)",
                  padding: "0 8px 0 10px",
                  fontSize: "11.5px",
                  userSelect: "none",
                  gap: 8,
                }}>
                  {/* Active tab selector for Right Pane */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1, overflow: "hidden" }}>
                    <span style={{ fontSize: "10px", padding: "1px 5px", background: "rgba(239, 68, 68, 0.2)", color: "#ef4444", borderRadius: 3, fontWeight: 700 }}>
                      RIGHT
                    </span>

                    {/* Quick tab switcher dropdown for right pane */}
                    {openTabs.length > 0 && (
                      <select
                        value={rightTab?.id || ""}
                        onChange={(e) => setSplitActiveTabId(e.target.value)}
                        style={{
                          background: "var(--color-input-bg, var(--color-bg-base))",
                          border: "1px solid var(--color-border-subtle)",
                          color: "var(--color-text-primary)",
                          fontSize: "11.5px",
                          fontWeight: 600,
                          borderRadius: 4,
                          padding: "2px 8px",
                          cursor: "pointer",
                          maxWidth: 200,
                          outline: "none",
                        }}
                        title="Switch right panel file"
                      >
                        {openTabs.map((t) => (
                          <option key={t.id} value={t.id} style={{ background: "var(--color-bg-surface)", color: "var(--color-text-primary)" }}>
                            {t.title || t.path.split(/[/\\]/).pop()} {t.isDirty ? "•" : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Actions: Preview toggle (if applicable), Swap Panes, Close Split */}
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {(rightTab?.path.endsWith(".md") || rightTab?.path.endsWith(".html")) && (
                      <button
                        className="btn btn--icon"
                        onClick={() => setRightViewMode((prev) => (prev === "preview" ? "code" : "preview"))}
                        title={rightViewMode === "preview" ? "Switch to Code Editor" : "Toggle Preview"}
                        style={{ width: 24, height: 24, padding: 0 }}
                      >
                        <Eye size={13} />
                      </button>
                    )}

                    <button
                      className="btn btn--icon"
                      onClick={handleSwapPanes}
                      title="Swap Left and Right Panes"
                      style={{ width: 24, height: 24, padding: 0 }}
                    >
                      <ArrowLeftRight size={13} />
                    </button>

                    <button
                      className="btn btn--icon"
                      onClick={() => onToggleSplit?.()}
                      title="Close Split Pane (Ctrl+\)"
                      style={{ width: 24, height: 24, padding: 0, color: "var(--color-text-tertiary)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-text-tertiary)")}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                {/* Right Pane Body (Monaco Editor or Preview or Diff) */}
                <div style={{ flex: 1, height: "calc(100% - 34px)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                  {rightTab?.path?.startsWith("extension:") ? (
                    <ExtensionDetailView 
                      extension={rightTab.extensionData || { 
                        id: rightTab.path.replace("extension:", ""), 
                        displayName: rightTab.title.replace("Extension: ", ""), 
                        namespace: rightTab.path.replace("extension:", "").split(".")[0] || "", 
                        name: rightTab.path.replace("extension:", "").split(".")[1] || "" 
                      }} 
                    />
                  ) : rightTab?.path === "forge://brain-graph" ? (
                    <BrainGraphView
                      projectPath={activeProject?.path || ""}
                      projectName={activeProject?.name}
                      onOpenNode={onOpenFile}
                      activeFilePath={activeTab?.path}
                      theme={theme}
                    />
                  ) : rightViewMode === "preview" && rightTab?.path.endsWith(".md") ? (
                    <MarkdownPreview content={rightTab?.content || ""} onClose={() => setRightViewMode("code")} onOpenFile={onOpenFile} />
                  ) : rightViewMode === "preview" && rightTab?.path.endsWith(".html") ? (
                    <LiveWebPreview htmlContent={rightTab?.content || ""} onClose={() => setRightViewMode("code")} />
                  ) : currentDiff ? (
                    <DiffViewer
                      oldContent={currentDiff.oldContent}
                      newContent={currentDiff.newContent}
                      onClose={() => {
                        setCurrentDiff(null);
                        onToggleSplit?.();
                      }}
                    />
                  ) : (
                    <MonacoCodeEditor
                      filePath={rightTab?.path || "untitled.txt"}
                      content={rightTab?.content || ""}
                      isDirty={rightTab?.isDirty}
                      theme={theme}
                      onChange={(val) => rightTab && onTabContentChange?.(rightTab.id, val)}
                      onSave={() => rightTab && onSaveTab?.(rightTab.id)}
                      onSaveAs={() => rightTab && onSaveAsTab?.(rightTab.id)}
                      onCursorChange={() => {}}
                      onTriggerInlineAI={(selectedText, range) => setInlineAIState({ open: true, selectedText, range })}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Floating Cursor-style Inline AI Copilot */}
            {inlineAIState.open && (
              <InlineAICopilot
                filePath={activeTab?.path || ""}
                selectedText={inlineAIState.selectedText}
                activeModel={activeModel}
                onAccept={handleInlineAIAccept}
                onClose={() => setInlineAIState({ open: false, selectedText: "", range: null })}
              />
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════ */}
        {/* ★ MANUAL CODER SLIDE — AI Assistant Sliding Drawer ★ */}
        {/* ═══════════════════════════════════════════════════════ */}
        {aiSlideVisible && (
          <div
            className={`panel-resizer ${isDraggingAiSlide ? "is-dragging" : ""}`}
            onMouseDown={handleAiSlideResizeStart}
            onDoubleClick={() => {
              setAiSlideWidth(430);
              localStorage.setItem("forge.ai_slide_width", "430");
            }}
            title="Drag to resize AI Assistant · Double click to reset width"
          />
        )}
        <div
          className="ai-coder-slide"
          style={{
            width: aiSlideVisible ? aiSlideWidth : 0,
            minWidth: aiSlideVisible ? Math.min(aiSlideWidth, 280) : 0,
            maxWidth: aiSlideVisible ? Math.max(aiSlideWidth, 1200) : 0,
            height: "100%",
            boxSizing: "border-box",
            borderLeft: aiSlideVisible ? "1px solid var(--color-border-default)" : "none",
            background: "var(--color-bg-surface)",
            transition: isDraggingAiSlide ? "none" : "width 0.22s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.22s cubic-bezier(0.4, 0, 0.2, 1), max-width 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {aiSlideVisible && (
            <AiCoderSlidePanel
              activeProject={activeProject}
              activeModel={activeModel}
              conversationId={conversationId}
              onConversationTitleChange={onConversationTitleChange}
              permissionProfile={permissionProfile}
              attachedProjectPaths={attachedProjectPaths}
              onClose={() => onToggleAiSlide?.()}
              onApplyToActiveTab={handleApplyToActiveTab}
              onInsertAtCursor={handleInsertAtCursor}
              activeFileName={activeTab?.title || null}
              activeFileContent={activeTab?.content || null}
              activeFilePath={activeTab?.path || null}
              conversations={conversations}
              onSelectConversation={onSelectConversation}
              onNewConversation={onNewConversation}
              onDeleteConversation={onDeleteConversation}
              onOpenFile={onOpenFile}
              onTabContentChange={onTabContentChange}
            />
          )}
        </div>
      </div>

      {/* Editor Status Bar */}
      {activeTab && (
        <div className="editor-status-bar" style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 12px",
          height: 24,
          background: "var(--color-bg-surface)",
          borderTop: "1px solid var(--color-border-subtle)",
          fontSize: "11px",
          color: "var(--color-text-tertiary)",
          userSelect: "none",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ color: "var(--color-text-secondary)" }}>
              Ln {cursorPos.line}, Col {cursorPos.column}
            </span>
            <span>Spaces: 2</span>
            <span>UTF-8</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={onToggleAiSlide}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: aiSlideVisible ? "var(--color-accent-primary)" : "var(--color-text-tertiary)",
                display: "flex", alignItems: "center", gap: 4, fontSize: "11px",
                padding: "0 4px",
              }}
            >
              <Sparkles size={11} />
              <span>AI Slide (Ctrl+L)</span>
            </button>
            <span style={{ textTransform: "capitalize", color: "var(--color-text-secondary)" }}>
              {getLanguageFromPath(activeTab.path)}
            </span>
          </div>
        </div>
      )}
    </main>
  );
}
