import { useState, useEffect, useRef } from "react";
import { ProjectInfo, ModelMetadata } from "../types/ipc";
import { 
  Play, 
  Square, 
  Search, 
  Terminal as TerminalIcon, 
  PanelLeft, 
  Bot, 
  Sliders, 
  Sparkles,
  Sun,
  Moon,
  Hammer,
  Minus,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { windowService } from "../services/ipc";
import { CsoticLogoIcon } from "./WelcomeView";
import { getSmartTaskActions, runTask } from "../services/runTasks";
import { runEditorCommand } from "./editor/activeEditor";

interface TopBarProps {
  activeProject: ProjectInfo | null;
  activeFile?: string | null;
  onToggleSidebar: () => void;
  onToggleRightPanel: () => void;
  rightPanelVisible?: boolean;
  onToggleBottomDock: () => void;
  onOpenTerminal?: () => void;
  onOpenSearch: () => void;
  onOpenCommandPalette?: () => void;
  onOpenFolder?: () => void;
  onOpenFile?: () => void;
  onSave?: () => void;
  onSaveAs?: () => void;
  onSaveAll?: () => void;
  onCloseFile?: () => void;
  onCloseProject?: () => void;
  onToggleSplit?: () => void;
  isSplit?: boolean;
  activeModel?: string | null;
  modelsList?: ModelMetadata[];
  onSelectModel?: (modelId: string) => void;
  onOpenSettings?: () => void;
  onToggleAiSlide?: () => void;
  aiSlideVisible?: boolean;
  onNewFile?: () => void;
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
  onOpenWelcomeTab?: () => void;
  onOpenShortcuts?: () => void;
}

export function TopBar({
  activeProject,
  activeFile,
  onToggleSidebar,
  onToggleRightPanel,
  rightPanelVisible = false,
  onToggleBottomDock,
  onOpenTerminal: _onOpenTerminal,
  onOpenSearch,
  onOpenCommandPalette,
  onOpenFolder,
  onOpenFile,
  onSave,
  onSaveAs,
  onSaveAll,
  onCloseFile,
  onCloseProject,
  onToggleSplit,
  isSplit: _isSplit = false,
  activeModel: _activeModel,
  modelsList: _modelsList = [],
  onSelectModel: _onSelectModel,
  onOpenSettings,
  onToggleAiSlide,
  aiSlideVisible = false,
  onNewFile,
  theme = "dark",
  onToggleTheme,
  onOpenWelcomeTab,
  onOpenShortcuts,
}: TopBarProps) {
  const isLight = theme === "light";
  const [openMenu, setOpenMenu] = useState<"file" | "edit" | "selection" | "view" | "go" | "run" | "terminal" | "help" | null>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);

  const smartTask = getSmartTaskActions(activeFile);

  // Close menus on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener("mousedown", handleOutsideClick);
    return () => window.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const menuItemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 12px",
    fontSize: "12px",
    color: "var(--color-text-primary)",
    background: "none",
    border: "none",
    borderRadius: "var(--radius-sm)",
    width: "100%",
    cursor: "pointer",
    textAlign: "left",
    whiteSpace: "nowrap",
    gap: 24,
    boxSizing: "border-box",
  };

  const shortcutStyle: React.CSSProperties = {
    fontSize: "10px",
    color: "var(--color-text-tertiary)",
    marginLeft: "auto",
    fontFamily: "var(--font-mono, monospace)",
    whiteSpace: "nowrap",
    flexShrink: 0,
  };

  const dropdownStyle: React.CSSProperties = {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    background: isLight ? "#ffffff" : "#202024",
    border: isLight ? "1px solid #e2e8f0" : "1px solid #2e2e34",
    borderRadius: "var(--radius-md)",
    boxShadow: isLight ? "0 8px 24px rgba(0, 0, 0, 0.12)" : "0 8px 24px rgba(0, 0, 0, 0.5)",
    minWidth: 240,
    width: "max-content",
    maxWidth: 340,
    padding: "5px",
    zIndex: 99999,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    boxSizing: "border-box",
  };

  const menuBtnStyle = (menuName: string): React.CSSProperties => ({
    background: openMenu === menuName ? "rgba(239, 68, 68, 0.2)" : "transparent",
    border: openMenu === menuName ? "1px solid rgba(239, 68, 68, 0.4)" : "1px solid transparent",
    color: openMenu === menuName ? "#ffffff" : "var(--color-text-secondary)",
    fontSize: "12px",
    fontWeight: 500,
    padding: "3px 8px",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    transition: "all 0.12s ease",
  });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.tagName === "BUTTON" ||
      target.tagName === "INPUT" ||
      target.tagName === "SELECT" ||
      target.closest("button") ||
      target.closest("input") ||
      target.closest("select") ||
      target.closest(".dropdown-item") ||
      target.closest(".model-selector-dropdown") ||
      target.closest(".topbar__section--left") ||
      target.closest(".topbar__section--right") ||
      target.closest(".topbar__window-controls")
    ) {
      return;
    }
    windowService.startDragging().catch(() => {
      try {
        getCurrentWindow().startDragging();
      } catch {}
    });
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.tagName === "BUTTON" ||
      target.tagName === "INPUT" ||
      target.tagName === "SELECT" ||
      target.closest("button")
    ) {
      return;
    }
    windowService.toggleMaximize().catch(() => {
      try {
        getCurrentWindow().toggleMaximize();
      } catch {}
    });
  };

  return (
    <header
      className="topbar"
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 142px 0 10px",
        height: 44,
        width: "100%",
        minWidth: 0,
        overflow: "visible",
        background: "var(--color-topbar-bg)",
        borderBottom: "1px solid var(--color-border-default)",
        userSelect: "none",
        zIndex: 1000,
      }}
    >
      {/* Left Section: Explorer toggle, Brand, Menu Bar, Project info */}
      <div
        className="topbar__section topbar__section--left"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
      >
        <button
          className="btn btn--icon"
          onClick={onToggleSidebar}
          title="Toggle Explorer Sidebar (Ctrl+B)"
          style={{ width: 28, height: 28, padding: 0 }}
        >
          <PanelLeft size={16} />
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 6, userSelect: "none" }}>
          <CsoticLogoIcon size={19} />
          {activeFile && activeFile !== "csotic://welcome" && !activeFile.startsWith("untitled://") && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid rgba(255, 255, 255, 0.09)",
                borderRadius: 6,
                padding: 1,
                gap: 2,
              }}
            >
              <button
                className="topbar__run-btn"
                onClick={() => runTask("run", activeFile, activeProject?.path)}
                title={smartTask.runTitle}
                aria-label={smartTask.runTitle}
                style={{ width: 24, height: 24, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <Play size={11} fill="#34d399" style={{ color: "#34d399" }} />
              </button>

              {smartTask.hasBuild && (
                <button
                  className="topbar__run-btn"
                  onClick={() => runTask("build", activeFile, activeProject?.path)}
                  title={smartTask.buildTitle}
                  aria-label={smartTask.buildTitle}
                  style={{ width: 24, height: 24, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  <Hammer size={11} style={{ color: "#f87171" }} />
                </button>
              )}
            </div>
          )}
        </div>

        <div style={{ width: 1, height: 18, background: "var(--color-border-subtle)", margin: "0 4px" }} />

        {/* ═══════════════════════════════════════════════════════ */}
        {/* ★ TOPBAR FILE MENU BAR (File, Edit, View, Terminal) ★ */}
        {/* ═══════════════════════════════════════════════════════ */}
        <div
          ref={menuBarRef}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ display: "flex", alignItems: "center", gap: 2, position: "relative" }}
        >
          {/* FILE MENU */}
          <div style={{ position: "relative" }}>
            <button
              style={menuBtnStyle("file")}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenu(openMenu === "file" ? null : "file");
              }}
              onMouseEnter={() => openMenu && setOpenMenu("file")}
            >
              File
            </button>
            {openMenu === "file" && (
              <div style={dropdownStyle} className="animate-pop-in">
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); onNewFile?.(); }}
                >
                  <span>New File</span>
                  <span style={shortcutStyle}>Ctrl+N</span>
                </button>
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); onOpenFile?.(); }}
                >
                  <span>Open File...</span>
                  <span style={shortcutStyle}>Ctrl+O</span>
                </button>
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); onOpenFolder?.(); }}
                >
                  <span>Open Folder...</span>
                </button>
                
                <div style={{ height: 1, background: "var(--color-border-subtle)", margin: "3px 0" }} />
                
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); onSave?.(); }}
                >
                  <span>Save</span>
                  <span style={shortcutStyle}>Ctrl+S</span>
                </button>
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); onSaveAs?.(); }}
                >
                  <span>Save As...</span>
                  <span style={shortcutStyle}>Ctrl+Shift+S</span>
                </button>
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); onSaveAll?.(); }}
                >
                  <span>Save All</span>
                </button>

                <div style={{ height: 1, background: "var(--color-border-subtle)", margin: "3px 0" }} />

                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); onCloseFile?.(); }}
                >
                  <span>Close Editor</span>
                  <span style={shortcutStyle}>Ctrl+W</span>
                </button>
                {activeProject && (
                  <button
                    style={{ ...menuItemStyle, color: "#f87171" }}
                    className="dropdown-item"
                    onClick={() => { setOpenMenu(null); onCloseProject?.(); }}
                  >
                    <span>Close Folder</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* EDIT MENU */}
          <div style={{ position: "relative" }}>
            <button
              style={menuBtnStyle("edit")}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenu(openMenu === "edit" ? null : "edit");
              }}
              onMouseEnter={() => openMenu && setOpenMenu("edit")}
            >
              Edit
            </button>
            {openMenu === "edit" && (
              <div style={dropdownStyle} className="animate-pop-in">
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); runEditorCommand("undo"); }}
                >
                  <span>Undo</span>
                  <span style={shortcutStyle}>Ctrl+Z</span>
                </button>
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); runEditorCommand("redo"); }}
                >
                  <span>Redo</span>
                  <span style={shortcutStyle}>Ctrl+Y</span>
                </button>
                <div style={{ height: 1, background: "var(--color-border-subtle)", margin: "3px 0" }} />
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); runEditorCommand("editor.action.clipboardCutAction"); }}
                >
                  <span>Cut</span>
                  <span style={shortcutStyle}>Ctrl+X</span>
                </button>
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); runEditorCommand("editor.action.clipboardCopyAction"); }}
                >
                  <span>Copy</span>
                  <span style={shortcutStyle}>Ctrl+C</span>
                </button>
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); runEditorCommand("editor.action.clipboardPasteAction"); }}
                >
                  <span>Paste</span>
                  <span style={shortcutStyle}>Ctrl+V</span>
                </button>
                <div style={{ height: 1, background: "var(--color-border-subtle)", margin: "3px 0" }} />
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); runEditorCommand("actions.find"); }}
                >
                  <span>Find</span>
                  <span style={shortcutStyle}>Ctrl+F</span>
                </button>
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); runEditorCommand("editor.action.startFindReplaceAction"); }}
                >
                  <span>Replace</span>
                  <span style={shortcutStyle}>Ctrl+H</span>
                </button>
                <div style={{ height: 1, background: "var(--color-border-subtle)", margin: "3px 0" }} />
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); runEditorCommand("editor.action.commentLine"); }}
                >
                  <span>Toggle Line Comment</span>
                  <span style={shortcutStyle}>Ctrl+/</span>
                </button>
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); runEditorCommand("editor.action.formatDocument"); }}
                >
                  <span>Format Document</span>
                  <span style={shortcutStyle}>Shift+Alt+F</span>
                </button>
                <div style={{ height: 1, background: "var(--color-border-subtle)", margin: "3px 0" }} />
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); onOpenSearch(); }}
                >
                  <span>Quick Open File</span>
                  <span style={shortcutStyle}>Ctrl+P</span>
                </button>
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); onOpenCommandPalette?.(); }}
                >
                  <span>Command Palette...</span>
                  <span style={shortcutStyle}>Ctrl+Shift+P</span>
                </button>
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); onToggleAiSlide?.(); }}
                >
                  <span>Toggle AI Coder Slide</span>
                  <span style={shortcutStyle}>Ctrl+L</span>
                </button>
              </div>
            )}
          </div>

          {/* SELECTION MENU */}
          <div style={{ position: "relative" }}>
            <button
              style={menuBtnStyle("selection")}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenu(openMenu === "selection" ? null : "selection");
              }}
              onMouseEnter={() => openMenu && setOpenMenu("selection")}
            >
              Selection
            </button>
            {openMenu === "selection" && (
              <div style={dropdownStyle} className="animate-pop-in">
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => {
                    setOpenMenu(null);
                    runEditorCommand("editor.action.selectAll");
                  }}
                >
                  <span>Select All</span>
                  <span style={shortcutStyle}>Ctrl+A</span>
                </button>
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => {
                    setOpenMenu(null);
                    runEditorCommand("editor.action.smartSelect.expand");
                  }}
                >
                  <span>Expand Selection</span>
                  <span style={shortcutStyle}>Shift+Alt+Right</span>
                </button>
                <div style={{ height: 1, background: "var(--color-border-subtle)", margin: "3px 0" }} />
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => {
                    setOpenMenu(null);
                    runEditorCommand("editor.action.copyLinesUpAction");
                  }}
                >
                  <span>Copy Line Up</span>
                  <span style={shortcutStyle}>Shift+Alt+Up</span>
                </button>
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => {
                    setOpenMenu(null);
                    runEditorCommand("editor.action.copyLinesDownAction");
                  }}
                >
                  <span>Copy Line Down</span>
                  <span style={shortcutStyle}>Shift+Alt+Down</span>
                </button>
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => {
                    setOpenMenu(null);
                    runEditorCommand("editor.action.moveLinesUpAction");
                  }}
                >
                  <span>Move Line Up</span>
                  <span style={shortcutStyle}>Alt+Up</span>
                </button>
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => {
                    setOpenMenu(null);
                    runEditorCommand("editor.action.moveLinesDownAction");
                  }}
                >
                  <span>Move Line Down</span>
                  <span style={shortcutStyle}>Alt+Down</span>
                </button>
                <div style={{ height: 1, background: "var(--color-border-subtle)", margin: "3px 0" }} />
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => {
                    setOpenMenu(null);
                    runEditorCommand("editor.action.addSelectionToNextFindMatch");
                  }}
                >
                  <span>Add Next Occurrence</span>
                  <span style={shortcutStyle}>Ctrl+D</span>
                </button>
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => {
                    setOpenMenu(null);
                    runEditorCommand("editor.action.insertCursorAbove");
                  }}
                >
                  <span>Add Cursor Above</span>
                  <span style={shortcutStyle}>Ctrl+Alt+Up</span>
                </button>
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => {
                    setOpenMenu(null);
                    runEditorCommand("editor.action.insertCursorBelow");
                  }}
                >
                  <span>Add Cursor Below</span>
                  <span style={shortcutStyle}>Ctrl+Alt+Down</span>
                </button>
                <div style={{ height: 1, background: "var(--color-border-subtle)", margin: "3px 0" }} />
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => {
                    setOpenMenu(null);
                    onToggleSplit?.();
                  }}
                >
                  <span>Split Editor</span>
                  <span style={shortcutStyle}>Ctrl+\</span>
                </button>
              </div>
            )}
          </div>

          {/* VIEW MENU */}
          <div style={{ position: "relative" }}>
            <button
              style={menuBtnStyle("view")}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenu(openMenu === "view" ? null : "view");
              }}
              onMouseEnter={() => openMenu && setOpenMenu("view")}
            >
              View
            </button>
            {openMenu === "view" && (
              <div style={dropdownStyle} className="animate-pop-in">
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); onToggleSidebar(); }}
                >
                  <span>Toggle Sidebar</span>
                  <span style={shortcutStyle}>Ctrl+B</span>
                </button>
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); onToggleBottomDock(); }}
                >
                  <span>Toggle Terminal</span>
                  <span style={shortcutStyle}>Ctrl+`</span>
                </button>
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); onToggleSplit?.(); }}
                >
                  <span>Toggle Split Editor</span>
                  <span style={shortcutStyle}>Ctrl+\</span>
                </button>
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); onToggleRightPanel(); }}
                >
                  <span>Toggle Context Panel</span>
                  <span style={shortcutStyle}>Ctrl+J</span>
                </button>
                <div style={{ height: 1, background: "var(--color-border-subtle)", margin: "3px 0" }} />
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); onOpenSettings?.(); }}
                >
                  <span>Settings &amp; API Keys</span>
                </button>
              </div>
            )}
          </div>

          {/* GO MENU */}
          <div style={{ position: "relative" }}>
            <button
              style={menuBtnStyle("go")}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenu(openMenu === "go" ? null : "go");
              }}
              onMouseEnter={() => openMenu && setOpenMenu("go")}
            >
              Go
            </button>
            {openMenu === "go" && (
              <div style={dropdownStyle} className="animate-pop-in">
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); onOpenSearch(); }}
                >
                  <span>Go to File...</span>
                  <span style={shortcutStyle}>Ctrl+P</span>
                </button>
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); onOpenCommandPalette?.(); }}
                >
                  <span>Command Palette...</span>
                  <span style={shortcutStyle}>Ctrl+Shift+P</span>
                </button>
              </div>
            )}
          </div>

          {/* RUN MENU */}
          <div style={{ position: "relative" }}>
            <button
              style={menuBtnStyle("run")}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenu(openMenu === "run" ? null : "run");
              }}
              onMouseEnter={() => openMenu && setOpenMenu("run")}
            >
              Run
            </button>
            {openMenu === "run" && (
              <div style={dropdownStyle} className="animate-pop-in">
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); runTask("run", activeFile, activeProject?.path); }}
                >
                  <span>Run Without Debugging</span>
                  <span style={shortcutStyle}>Ctrl+F5</span>
                </button>
                {smartTask.hasBuild && (
                  <button
                    style={menuItemStyle}
                    className="dropdown-item"
                    onClick={() => { setOpenMenu(null); runTask("build", activeFile, activeProject?.path); }}
                  >
                    <span>Run Build Task...</span>
                    <span style={shortcutStyle}>Ctrl+Shift+B</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* TERMINAL MENU */}
          <div style={{ position: "relative" }}>
            <button
              style={menuBtnStyle("terminal")}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenu(openMenu === "terminal" ? null : "terminal");
              }}
              onMouseEnter={() => openMenu && setOpenMenu("terminal")}
            >
              Terminal
            </button>
            {openMenu === "terminal" && (
              <div style={dropdownStyle} className="animate-pop-in">
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); onToggleBottomDock(); }}
                >
                  <span>Toggle Terminal</span>
                  <span style={shortcutStyle}>Ctrl+`</span>
                </button>
                {activeProject && (
                  <>
                    <div style={{ height: 1, background: "var(--color-border-subtle)", margin: "3px 0" }} />
                    <button
                      style={menuItemStyle}
                      className="dropdown-item"
                      onClick={() => { setOpenMenu(null); window.dispatchEvent(new CustomEvent("csotic:open-terminal", { detail: { cmd: "npm run dev", cwd: activeProject.path } })); }}
                    >
                      <span>Run Dev Server</span>
                      <span style={shortcutStyle}>npm run dev</span>
                    </button>
                    <button
                      style={menuItemStyle}
                      className="dropdown-item"
                      onClick={() => { setOpenMenu(null); window.dispatchEvent(new CustomEvent("csotic:open-terminal", { detail: { cmd: "npm run build", cwd: activeProject.path } })); }}
                    >
                      <span>Run Build</span>
                      <span style={shortcutStyle}>npm run build</span>
                    </button>
                    <button
                      style={menuItemStyle}
                      className="dropdown-item"
                      onClick={() => { setOpenMenu(null); window.dispatchEvent(new CustomEvent("csotic:open-terminal", { detail: { cmd: "npm test", cwd: activeProject.path } })); }}
                    >
                      <span>Run Tests</span>
                      <span style={shortcutStyle}>npm test</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* HELP MENU */}
          <div style={{ position: "relative" }}>
            <button
              style={menuBtnStyle("help")}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenu(openMenu === "help" ? null : "help");
              }}
              onMouseEnter={() => openMenu && setOpenMenu("help")}
            >
              Help
            </button>
            {openMenu === "help" && (
              <div style={dropdownStyle} className="animate-pop-in">
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); onOpenWelcomeTab?.(); }}
                >
                  <span>Welcome Page</span>
                </button>
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); onOpenShortcuts?.(); }}
                >
                  <span>Keyboard Shortcuts</span>
                </button>
                <div style={{ height: 1, background: "var(--color-border-subtle)", margin: "3px 0" }} />
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); onOpenSettings?.(); }}
                >
                  <span>Settings</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Center Section: Symmetrical Unified Omnibar */}
      <div 
        className="topbar__section topbar__section--center" 
        style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "center", 
          flex: 1, 
          minWidth: 0, 
          padding: "0 16px",
        }}
      >
        <button
          className="topbar__omnibar-btn"
          onClick={onOpenSearch}
          style={{
            width: "100%",
            maxWidth: 420,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 10px",
            background: "rgba(255, 255, 255, 0.04)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: 6,
            color: "var(--color-text-tertiary)",
            fontSize: "12px",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.07)";
            e.currentTarget.style.borderColor = "#ef4444";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
            e.currentTarget.style.borderColor = "var(--color-border-subtle)";
          }}
          title="Quick Open (Ctrl+P)"
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7, overflow: "hidden", minWidth: 0 }}>
            <Search size={13} style={{ opacity: 0.7, flexShrink: 0 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text-secondary)", fontSize: "12px" }}>
              {activeProject?.name ? `${activeProject.name} — Quick Open (Ctrl+P)` : "Quick Open (Ctrl+P)"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <span style={{ 
              fontSize: "10px", 
              fontWeight: 500,
              padding: "1px 5px", 
              borderRadius: 3, 
              background: "rgba(255, 255, 255, 0.06)", 
              border: "1px solid rgba(255, 255, 255, 0.08)",
              color: "var(--color-text-secondary)",
              letterSpacing: "0.2px"
            }}>
              Ctrl+P
            </span>
          </div>
        </button>
      </div>

      {/* Right Section: Symmetrical, Grouped Toolbars */}
      <div 
        className="topbar__section topbar__section--right" 
        style={{ 
          display: "flex", 
          alignItems: "center", 
          gap: 6, 
          flexShrink: 0,
        }}
      >


        <div style={{ width: 1, height: 16, background: "var(--color-border-subtle)" }} />

        {/* Group 2: AI & Layout Tools */}
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {onToggleAiSlide && (
            <button
              className={`btn btn--icon ${aiSlideVisible ? "btn--active" : ""}`}
              onClick={onToggleAiSlide}
              title="Toggle AI Coder Slide (Ctrl+L)"
              style={{
                width: 28,
                height: 28,
                padding: 0,
                color: aiSlideVisible ? "#ef4444" : undefined,
                background: aiSlideVisible ? "rgba(239, 68, 68, 0.18)" : undefined,
              }}
            >
              <Sparkles size={14} />
            </button>
          )}

          {onToggleRightPanel && (
            <button
              className={`btn btn--icon ${rightPanelVisible ? "btn--active" : ""}`}
              onClick={onToggleRightPanel}
              title={rightPanelVisible ? "Hide Context Panel (Ctrl+J)" : "Show Context Panel (Ctrl+J)"}
              style={{
                width: 28,
                height: 28,
                padding: 0,
                color: rightPanelVisible ? "var(--color-accent-primary)" : undefined,
                background: rightPanelVisible ? "rgba(239, 68, 68, 0.15)" : undefined,
                border: rightPanelVisible ? "1px solid rgba(239, 68, 68, 0.3)" : undefined,
              }}
            >
              <Bot size={14} />
            </button>
          )}


          <button
            className="btn btn--icon"
            onClick={onToggleBottomDock}
            title="Toggle Terminal & Output (Ctrl+`)"
            style={{ width: 28, height: 28, padding: 0 }}
          >
            <TerminalIcon size={14} />
          </button>
        </div>

        <div style={{ width: 1, height: 16, background: "var(--color-border-subtle)" }} />

        {/* Group 3: Settings & Theme */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {onOpenSettings && (
            <button
              className="btn btn--icon"
              onClick={onOpenSettings}
              title="Settings & Preferences"
              style={{ width: 28, height: 28, padding: 0 }}
            >
              <Sliders size={14} />
            </button>
          )}

          {onToggleTheme && (
            <button
              className="btn btn--icon"
              onClick={onToggleTheme}
              title={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
              style={{
                width: 28,
                height: 28,
                padding: 0,
                color: theme === "light" ? "#f59e0b" : "#f87171",
              }}
            >
              {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* ══ Native Windows Framing Controls (ALWAYS PINNED TO TOP-RIGHT) ══ */}
      <div
        className="topbar__window-controls"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          height: 44,
          display: "flex",
          alignItems: "center",
          background: "var(--color-topbar-bg)",
          borderLeft: "1px solid var(--color-border-subtle)",
          zIndex: 99,
        }}
      >
        <button
          onClick={() => {
            windowService.minimize().catch(() => {
              try { getCurrentWindow().minimize(); } catch {}
            });
          }}
          title="Minimize"
          style={{
            width: 44,
            height: 44,
            background: "transparent",
            border: "none",
            color: "var(--color-text-secondary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
            transition: "background 0.12s ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <Minus size={14} />
        </button>

        <button
          onClick={() => {
            windowService.toggleMaximize().catch(() => {
              try { getCurrentWindow().toggleMaximize(); } catch {}
            });
          }}
          title="Maximize"
          style={{
            width: 44,
            height: 44,
            background: "transparent",
            border: "none",
            color: "var(--color-text-secondary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
            transition: "background 0.12s ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <Square size={12} />
        </button>

        <button
          onClick={() => {
            windowService.close().catch(() => {
              try { getCurrentWindow().close(); } catch {}
            });
          }}
          title="Close"
          style={{
            width: 48,
            height: 44,
            background: "transparent",
            border: "none",
            color: "var(--color-text-secondary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
            transition: "all 0.12s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#e81123";
            e.currentTarget.style.color = "#ffffff";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--color-text-secondary)";
          }}
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
