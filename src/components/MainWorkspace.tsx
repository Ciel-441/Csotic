import { useEffect, useMemo, useState, useCallback, lazy, Suspense } from "react";
import { listen } from "../services/events";
import { ProjectInfo, EditorTab, ModelMetadata } from "../types/ipc";
import { EditorTabBar } from "./editor/EditorTabBar";
import { Breadcrumbs } from "./editor/Breadcrumbs";
import { getLanguageFromPath } from "./editor/languages";

// Lazy-loaded heavy modules for instant startup & low RAM consumption
const DiffViewer = lazy(() => import("./DiffViewer").then((m) => ({ default: m.DiffViewer })));
const MonacoCodeEditor = lazy(() => import("./editor/MonacoCodeEditor").then((m) => ({ default: m.MonacoCodeEditor })));
const InlineAICopilot = lazy(() => import("./editor/InlineAICopilot").then((m) => ({ default: m.InlineAICopilot })));
const LiveWebPreview = lazy(() => import("./editor/LiveWebPreview").then((m) => ({ default: m.LiveWebPreview })));
const MarkdownPreview = lazy(() => import("./editor/MarkdownPreview").then((m) => ({ default: m.MarkdownPreview })));
const BrainGraphView = lazy(() => import("./brain/BrainGraphView").then((m) => ({ default: m.BrainGraphView })));
const ExtensionDetailView = lazy(() => import("./ExtensionDetailView").then((m) => ({ default: m.ExtensionDetailView })));
const ClaudeCodeSessionView = lazy(() => import("./ClaudeCodeSessionView").then((m) => ({ default: m.ClaudeCodeSessionView })));
const AiCoderSlidePanel = lazy(() => import("../features/chat").then((m) => ({ default: m.AiCoderSlidePanel })));
import { getSessionById, getStoredSessions } from "../services/claudeCodeSessions";
import { WelcomeView } from "./WelcomeView";

const EditorLoadingFallback = () => (
  <div style={{
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "var(--color-bg-base, #070203)",
    color: "var(--color-text-muted, #71717a)",
    fontSize: "12px",
    gap: 8,
  }}>
    <div style={{ width: 14, height: 14, border: "2px solid #ef4444", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
    <span>Loading editor...</span>
  </div>
);

export { getLanguageFromPath };
import {
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
  modelsList?: ModelMetadata[];
  onSelectModel?: (modelId: string) => void;
  onOpenSettings?: () => void;
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
  recentProjects?: ProjectInfo[];
  onOpenFolder?: () => void;
  onRevealInExplorer?: () => void;
  onOpenTerminal?: () => void;
  onNewFile?: () => void;
  onOpenFilePicker?: () => void;
  onCursorChangeGlobal?: (line: number, col: number) => void;
}

export function MainWorkspace(props: MainWorkspaceProps) {
  const {
    activeProject, activeModel, modelsList, onSelectModel, onOpenSettings,
    openTabs = [], activeTabId = null, onSelectTab, onCloseTab, onCloseOthers, onCloseAll, onCloseSaved, onTabContentChange, onSaveTab, onSaveAsTab,
    isSplit = false, onToggleSplit,
    onOpenProject: _onOpenProject, conversationId, onConversationTitleChange, permissionProfile, attachedProjectPaths, onDetachProject: _onDetachProject, onPermissionProfileChange: _onPermissionProfileChange,
    currentDiff, setCurrentDiff, setActiveRightTab, onOpenSearch,
    aiSlideVisible = false, onToggleAiSlide,
    conversations = [], onSelectConversation, onNewConversation, onDeleteConversation,
    onOpenFile,
    theme = "dark",
    onViewChange: _onViewChange,
    recentProjects = [],
    onOpenFolder,
    onRevealInExplorer,
    onOpenTerminal,
    onNewFile,
    onOpenFilePicker,
    onCursorChangeGlobal,
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
  // Preview only applies to previewable files; switching to a .ts tab must show code, not an HTML preview of it.
  const showPreview = viewMode === "preview" && (isMarkdown || isHtml);

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

    const handleTogglePreview = () => {
      setViewMode((cur) => (cur === "preview" ? "code" : "preview"));
    };
    window.addEventListener("csotic:toggle-preview", handleTogglePreview);

    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("csotic:toggle-preview", handleTogglePreview);
    };
  }, [setCurrentDiff, setActiveRightTab]);

  const handleInlineAIAccept = (newCode: string) => {
    if (activeTab && onTabContentChange) {
      const content = activeTab.content || "";
      const range = inlineAIState.range;
      if (inlineAIState.selectedText && range) {
        // Replace exactly the selected range (string.replace would hit the first identical snippet).
        const lines = content.split("\n");
        const offsetOf = (line: number, col: number) =>
          lines.slice(0, line - 1).reduce((sum, l) => sum + l.length + 1, 0) + col - 1;
        const start = offsetOf(range.startLineNumber, range.startColumn);
        const end = offsetOf(range.endLineNumber, range.endColumn);
        onTabContentChange(activeTab.id, content.slice(0, start) + newCode + content.slice(end));
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
        />
      )}

      {/* Breadcrumbs Navigation */}
      {activeTab && activeTab.id !== "welcome" && activeTab.path !== "csotic://welcome" && (
        <Breadcrumbs
          filePath={activeTab.path}
          projectPath={activeProject?.path}
        />
      )}

      {/* Central Editor + AI Slide Layout */}
      <div style={{ flex: 1, display: "flex", width: "100%", height: "100%", overflow: "hidden", position: "relative" }}>
        {(!activeTab || activeTab.id === "welcome" || activeTab.path === "csotic://welcome") ? (
          <WelcomeView
            onNewFile={onNewFile || (() => {})}
            onOpenFile={onOpenFilePicker || (() => {})}
            onOpenFolder={onOpenFolder || (() => {})}
            onRevealInExplorer={onRevealInExplorer || (() => {})}
            onOpenTerminal={onOpenTerminal || (() => {})}
            onOpenSearch={onOpenSearch || (() => {})}
            recentProjects={recentProjects}
            onOpenProject={_onOpenProject}
            activeProject={activeProject}
            onOpenFileByPath={onOpenFile || (() => {})}
            theme={theme}
          />
        ) : (
          /* Main Editor Canvas / Split Panes */
          <div style={{ flex: 1, display: "flex", width: "100%", height: "100%", overflow: "hidden", position: "relative" }}>
            {/* Primary (Left) Editor Pane */}
            {/* The tab bar drives the left pane; only the right pane needs its own file picker. */}
            <div style={{ flex: 1, height: "100%", overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0 }}>
              <div style={{ flex: 1, height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                <Suspense fallback={<EditorLoadingFallback />}>
                  {activeTab?.path?.startsWith("extension:") ? (
                    <ExtensionDetailView 
                      extension={activeTab.extensionData || { 
                        id: activeTab.path.replace("extension:", ""), 
                        displayName: activeTab.title.replace("Extension: ", ""), 
                        namespace: activeTab.path.replace("extension:", "").split(".")[0] || "", 
                        name: activeTab.path.replace("extension:", "").split(".")[1] || "" 
                      }} 
                    />
                  ) : activeTab?.path?.startsWith("claude-code:") ? (
                    <ClaudeCodeSessionView
                      session={activeTab.claudeSessionData || getSessionById(activeTab.path.replace("claude-code:", "")) || getStoredSessions()[0]}
                      activeProject={activeProject}
                      activeFilePath={activeTab?.path}
                      onOpenFile={onOpenFile}
                      onOpenTerminal={(cmd) => window.dispatchEvent(new CustomEvent("csotic:open-terminal", { detail: { cmd: cmd || "claude" } }))}
                    />
                  ) : activeTab?.path === "forge://brain-graph" ? (
                    <BrainGraphView
                      projectPath={activeProject?.path || ""}
                      projectName={activeProject?.name}
                      onOpenNode={onOpenFile}
                      activeFilePath={activeTab?.path}
                      theme={theme}
                    />
                  ) : showPreview && isMarkdown ? (
                    <MarkdownPreview content={activeTab?.content || ""} onClose={() => setViewMode("code")} onOpenFile={onOpenFile} />
                  ) : showPreview ? (
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
                      onCursorChange={(line, column) => {
                        setCursorPos({ line, column });
                        onCursorChangeGlobal?.(line, column);
                      }}
                      onTriggerInlineAI={(selectedText, range) => setInlineAIState({ open: true, selectedText, range })}
                    />
                  )}
                </Suspense>
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
                  <Suspense fallback={<EditorLoadingFallback />}>
                    {rightTab?.path?.startsWith("extension:") ? (
                    <ExtensionDetailView 
                      extension={rightTab.extensionData || { 
                        id: rightTab.path.replace("extension:", ""), 
                        displayName: rightTab.title.replace("Extension: ", ""), 
                        namespace: rightTab.path.replace("extension:", "").split(".")[0] || "", 
                        name: rightTab.path.replace("extension:", "").split(".")[1] || "" 
                      }} 
                    />
                  ) : rightTab?.path?.startsWith("claude-code:") ? (
                    <ClaudeCodeSessionView
                      session={rightTab.claudeSessionData || getSessionById(rightTab.path.replace("claude-code:", "")) || getStoredSessions()[0]}
                      activeProject={activeProject}
                      activeFilePath={rightTab?.path}
                      onOpenFile={onOpenFile}
                      onOpenTerminal={(cmd) => window.dispatchEvent(new CustomEvent("csotic:open-terminal", { detail: { cmd: cmd || "claude" } }))}
                    />
                  ) : rightTab?.path === "forge://brain-graph" ? (
                    <BrainGraphView
                      projectPath={activeProject?.path || ""}
                      projectName={activeProject?.name}
                      onOpenNode={onOpenFile}
                      activeFilePath={activeTab?.path}
                      theme={theme}
                    />
                  ) : rightViewMode === "preview" && rightTab?.path?.endsWith(".md") ? (
                    <MarkdownPreview content={rightTab?.content || ""} onClose={() => setRightViewMode("code")} onOpenFile={onOpenFile} />
                  ) : rightViewMode === "preview" && /\.html?$/.test(rightTab?.path || "") ? (
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
                  </Suspense>
                </div>
              </div>
            )}

            {/* Floating Cursor-style Inline AI Copilot */}
            {inlineAIState.open && (
              <Suspense fallback={null}>
                <InlineAICopilot
                  filePath={activeTab?.path || ""}
                  selectedText={inlineAIState.selectedText}
                  activeModel={activeModel}
                  onAccept={handleInlineAIAccept}
                  onClose={() => setInlineAIState({ open: false, selectedText: "", range: null })}
                />
              </Suspense>
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
            <Suspense fallback={<div style={{ flex: 1, background: "var(--color-bg-surface)" }} />}>
              <AiCoderSlidePanel
                activeProject={activeProject}
                activeModel={activeModel}
                modelsList={modelsList}
                onSelectModel={onSelectModel}
                onOpenSettings={onOpenSettings}
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
            </Suspense>
          )}
        </div>
      </div>

    </main>
  );
}
