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
  Columns,
  Sparkles,
  FilePlus2,
  Sun,
  Moon,
  Hammer,
  Minus,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { terminal, windowService } from "../services/ipc";
import { ModelSelectorDropdown } from "./ModelSelectorDropdown";

interface TopBarProps {
  activeProject: ProjectInfo | null;
  activeFile?: string | null;
  onToggleSidebar: () => void;
  onToggleRightPanel: () => void;
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
}

function sanitizeArg(name: string): string {
  if (name.includes(" ")) {
    return `"${name}"`;
  }
  return name;
}

function getSmartTaskActions(activeFile?: string | null, _activeProject?: ProjectInfo | null) {
  if (!activeFile) {
    return {
      runLabel: "Dev",
      runCmd: "npm run dev",
      runTitle: "Run Dev Server (npm run dev)",
      buildLabel: "Build",
      buildCmd: "npm run build",
      buildTitle: "Build Project (npm run build)",
      hasBuild: true,
    };
  }

  const cleanPath = activeFile.replace(/\\/g, "/");
  const fileName = cleanPath.split("/").pop() || "";
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase() : "";
  const baseName = fileName.replace(/\.[^/.]+$/, "");
  const fileArg = sanitizeArg(fileName);
  const outArg = sanitizeArg(`${baseName}.exe`);

  switch (ext) {
    case ".c":
      return {
        runLabel: `Run`,
        runCmd: `gcc ${fileArg} -o ${outArg} && ${outArg}`,
        runTitle: `Compile & Run ${fileName} (gcc ${fileArg} -o ${outArg} && ${outArg})`,
        buildLabel: `Build`,
        buildCmd: `gcc ${fileArg} -o ${outArg}`,
        buildTitle: `Compile ${fileName} (gcc ${fileArg} -o ${outArg})`,
        hasBuild: true,
      };
    case ".cpp":
    case ".cc":
    case ".cxx":
      return {
        runLabel: `Run`,
        runCmd: `g++ ${fileArg} -o ${outArg} && ${outArg}`,
        runTitle: `Compile & Run ${fileName} (g++ ${fileArg} -o ${outArg} && ${outArg})`,
        buildLabel: `Build`,
        buildCmd: `g++ ${fileArg} -o ${outArg}`,
        buildTitle: `Compile ${fileName} (g++ ${fileArg} -o ${outArg})`,
        hasBuild: true,
      };
    case ".py":
      return {
        runLabel: `Run`,
        runCmd: `python ${fileArg}`,
        runTitle: `Run Python Script (python ${fileArg})`,
        buildLabel: `Build`,
        buildCmd: `python -m py_compile ${fileArg}`,
        buildTitle: `Bytecode Compile ${fileArg}`,
        hasBuild: false,
      };
    case ".rs":
      return {
        runLabel: `Run`,
        runCmd: `cargo run`,
        runTitle: `Run Rust (cargo run)`,
        buildLabel: `Build`,
        buildCmd: `cargo build`,
        buildTitle: `Build Rust (cargo build)`,
        hasBuild: true,
      };
    case ".go":
      return {
        runLabel: `Run`,
        runCmd: `go run ${fileArg}`,
        runTitle: `Run Go file (go run ${fileArg})`,
        buildLabel: `Build`,
        buildCmd: `go build ${fileArg}`,
        buildTitle: `Build Go binary (go build ${fileArg})`,
        hasBuild: true,
      };
    case ".java":
      return {
        runLabel: `Run`,
        runCmd: `java ${fileArg}`,
        runTitle: `Run Java class (java ${fileArg})`,
        buildLabel: `Build`,
        buildCmd: `javac ${fileArg}`,
        buildTitle: `Compile Java (javac ${fileArg})`,
        hasBuild: true,
      };
    case ".js":
    case ".mjs":
    case ".cjs":
      return {
        runLabel: `Run`,
        runCmd: `node ${fileArg}`,
        runTitle: `Run JavaScript with Node (node ${fileArg})`,
        buildLabel: `Build`,
        buildCmd: `npm run build`,
        buildTitle: `Build Project (npm run build)`,
        hasBuild: true,
      };
    case ".ts":
      return {
        runLabel: `Run`,
        runCmd: `npx tsx ${fileArg}`,
        runTitle: `Run TypeScript file (npx tsx ${fileArg})`,
        buildLabel: `Build`,
        buildCmd: `npm run build`,
        buildTitle: `Build Project (npm run build)`,
        hasBuild: true,
      };
    case ".sh":
      return {
        runLabel: `Run`,
        runCmd: `bash ${fileArg}`,
        runTitle: `Run Shell Script (bash ${fileArg})`,
        buildLabel: `Build`,
        buildCmd: ``,
        buildTitle: ``,
        hasBuild: false,
      };
    case ".ps1":
      return {
        runLabel: `Run`,
        runCmd: `powershell -ExecutionPolicy Bypass -File ${fileArg}`,
        runTitle: `Run PowerShell Script`,
        buildLabel: `Build`,
        buildCmd: ``,
        buildTitle: ``,
        hasBuild: false,
      };
    default:
      return {
        runLabel: "Dev",
        runCmd: "npm run dev",
        runTitle: "Run Dev Server (npm run dev)",
        buildLabel: "Build",
        buildCmd: "npm run build",
        buildTitle: "Build Project (npm run build)",
        hasBuild: true,
      };
  }
}

export function TopBar({
  activeProject,
  activeFile,
  onToggleSidebar,
  onToggleRightPanel,
  onToggleBottomDock,
  onOpenTerminal,
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
  isSplit = false,
  activeModel,
  modelsList = [],
  onSelectModel,
  onOpenSettings,
  onToggleAiSlide,
  aiSlideVisible = false,
  onNewFile,
  theme = "dark",
  onToggleTheme,
}: TopBarProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [activeTaskName, setActiveTaskName] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<"file" | "edit" | "view" | "terminal" | null>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);

  const smartTask = getSmartTaskActions(activeFile, activeProject);

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

  const handleRunCommand = async (command: string, taskName: string) => {
    const cwd = activeProject?.path || ".";
    // Always open terminal, never toggle closed
    if (onOpenTerminal) {
      onOpenTerminal();
    }
    setIsRunning(true);
    setActiveTaskName(taskName);
    try {
      await terminal.executeCommand(cwd, command, true);
    } catch (err) {
      console.error(`Execution failed for ${command}:`, err);
    } finally {
      setIsRunning(false);
      setActiveTaskName(null);
    }
  };

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
    gap: 16,
  };

  const shortcutStyle: React.CSSProperties = {
    fontSize: "10px",
    color: "var(--color-text-tertiary)",
    marginLeft: "auto",
    fontFamily: "var(--font-mono, monospace)",
  };

  const dropdownStyle: React.CSSProperties = {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    background: "rgba(18, 4, 8, 0.98)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    border: "1px solid rgba(239, 68, 68, 0.35)",
    borderRadius: "var(--radius-md)",
    boxShadow: "0 16px 40px rgba(0, 0, 0, 0.8), 0 0 20px rgba(239, 68, 68, 0.2)",
    minWidth: 200,
    padding: "5px",
    zIndex: 99999,
    display: "flex",
    flexDirection: "column",
    gap: 2,
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
        backdropFilter: "blur(12px)",
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

        <div style={{ display: "flex", alignItems: "center", gap: 7, userSelect: "none" }}>
          <img
            src="/forge-logo.png"
            alt="Csotic Logo"
            style={{
              width: 22,
              height: 22,
              borderRadius: "4px",
              objectFit: "cover",
              boxShadow: "0 0 10px rgba(239, 68, 68, 0.4)",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              display: "block",
            }}
          />
          <span style={{ fontWeight: 800, fontSize: "13.5px", letterSpacing: "1px", color: "var(--color-text-primary)", fontFamily: "var(--font-heading, sans-serif)" }}>
            CSOTIC
          </span>
          <span style={{ fontSize: "9.5px", padding: "1px 5px", background: "rgba(239, 68, 68, 0.18)", color: "#f87171", borderRadius: 3, fontWeight: 700, border: "1px solid rgba(239, 68, 68, 0.35)", letterSpacing: "0.5px" }}>
            IDE
          </span>
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
                <div style={{ height: 1, background: "var(--color-border-subtle)", margin: "3px 0" }} />
                <button
                  style={menuItemStyle}
                  className="dropdown-item"
                  onClick={() => { setOpenMenu(null); onOpenSettings?.(); }}
                >
                  <span>Settings & API Keys</span>
                </button>
              </div>
            )}
          </div>

          {/* TERMINAL / RUN MENU */}
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
                      onClick={() => { setOpenMenu(null); handleRunCommand("npm run dev", "dev"); }}
                    >
                      <span>Run Dev Server</span>
                      <span style={shortcutStyle}>npm run dev</span>
                    </button>
                    <button
                      style={menuItemStyle}
                      className="dropdown-item"
                      onClick={() => { setOpenMenu(null); handleRunCommand("npm run build", "build"); }}
                    >
                      <span>Run Build</span>
                      <span style={shortcutStyle}>npm run build</span>
                    </button>
                    <button
                      style={menuItemStyle}
                      className="dropdown-item"
                      onClick={() => { setOpenMenu(null); handleRunCommand("npm test", "test"); }}
                    >
                      <span>Run Tests</span>
                      <span style={shortcutStyle}>npm test</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div style={{ width: 1, height: 18, background: "var(--color-border-subtle)", margin: "0 4px" }} />

        {/* Project Name Indicator */}
        {activeProject && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: "12px", color: "var(--color-text-primary)", fontWeight: 600 }}>
              {activeProject.name}
            </span>
            <span
              style={{
                fontSize: "10.5px",
                color: "var(--color-text-tertiary)",
                maxWidth: 180,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                opacity: 0.7,
              }}
              title={activeProject.path}
            >
              {activeProject.path.replace(/^[\\/]+/, "")}
            </span>
          </div>
        )}
      </div>

      {/* Center Section: Quick Open & Project Runner */}
      <div className="topbar__section topbar__section--center" style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0, justifyContent: "center", overflow: "hidden" }}>
        {/* Quick Open bar */}
        <button
          className="btn btn--secondary"
          onClick={onOpenSearch}
          style={{
            width: 200,
            justifyContent: "flex-start",
            gap: 6,
            color: "var(--color-text-tertiary)",
            fontSize: "12px",
            height: 28,
            padding: "0 10px",
            background: "var(--color-input-bg, var(--color-bg-surface))",
            border: "1px solid var(--color-border-subtle)",
          }}
          title="Quick Open File (Ctrl+P)"
        >
          <Search size={13} style={{ opacity: 0.7 }} />
          <span>Quick Open...</span>
          <span style={{ marginLeft: "auto", fontSize: "10px", opacity: 0.6, background: "var(--color-item-hover)", padding: "1px 4px", borderRadius: 3 }}>
            Ctrl+P
          </span>
        </button>

        {onOpenCommandPalette && (
          <button
            className="btn btn--secondary"
            onClick={onOpenCommandPalette}
            style={{
              padding: "0 8px",
              height: 28,
              fontSize: "11.5px",
              gap: 5,
              background: "var(--color-input-bg, var(--color-bg-surface))",
              border: "1px solid var(--color-border-subtle)",
            }}
            title="Command Palette (Ctrl+Shift+P)"
          >
            <span>⌘</span>
            <span style={{ fontSize: "10px", opacity: 0.6 }}>Ctrl+Shift+P</span>
          </button>
        )}

        {/* Preset Task Buttons — Dynamic based on Active File / Project */}
        {(activeProject || activeFile) && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              className="btn btn--secondary"
              onClick={() => handleRunCommand(smartTask.runCmd, "run")}
              disabled={isRunning}
              title={smartTask.runTitle}
              style={{
                height: 28,
                fontSize: "11.5px",
                padding: "0 9px",
                gap: 5,
                color: activeTaskName === "run" ? "#34d399" : "#ffffff",
                background: activeTaskName === "run" ? "rgba(52, 211, 153, 0.2)" : "rgba(255, 255, 255, 0.06)",
                border: "1px solid rgba(255, 255, 255, 0.14)",
                borderRadius: 5,
                display: "flex",
                alignItems: "center",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              {isRunning && activeTaskName === "run" ? (
                <Square size={12} fill="#34d399" />
              ) : (
                <Play size={12} fill="#34d399" style={{ color: "#34d399" }} />
              )}
              <span>{smartTask.runLabel}</span>
            </button>

            {smartTask.hasBuild && (
              <button
                className="btn btn--secondary"
                onClick={() => handleRunCommand(smartTask.buildCmd, "build")}
                disabled={isRunning}
                title={smartTask.buildTitle}
                style={{
                  height: 28,
                  fontSize: "11.5px",
                  padding: "0 9px",
                  gap: 5,
                  color: activeTaskName === "build" ? "#ef4444" : "var(--color-text-secondary)",
                  background: activeTaskName === "build" ? "rgba(239, 68, 68, 0.2)" : "rgba(255, 255, 255, 0.06)",
                  border: "1px solid rgba(255, 255, 255, 0.14)",
                  borderRadius: 5,
                  display: "flex",
                  alignItems: "center",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
              >
                <Hammer size={12} style={{ color: "#f87171" }} />
                <span>{smartTask.buildLabel}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Right Section: Model Selector, Quick Actions & Settings */}
      <div className="topbar__section topbar__section--right" style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
        {/* Sleek Custom Model Selector Dropdown */}
        {modelsList.length > 0 && onSelectModel && (
          <ModelSelectorDropdown
            modelsList={modelsList}
            activeModel={activeModel ?? null}
            onSelectModel={onSelectModel}
            onOpenSettings={onOpenSettings}
          />
        )}

        {onNewFile && (
          <button
            className="btn btn--icon"
            onClick={onNewFile}
            title="New File (Ctrl+N)"
            style={{ width: 28, height: 28, padding: 0 }}
          >
            <FilePlus2 size={15} />
          </button>
        )}

        {onToggleAiSlide && (
          <button
            className={`btn btn--icon ${aiSlideVisible ? "btn--active" : ""}`}
            onClick={onToggleAiSlide}
            title="Toggle AI Coder Slide (Ctrl+L)"
            style={{
              width: 28, height: 28, padding: 0,
              color: aiSlideVisible ? "#ef4444" : undefined,
              background: aiSlideVisible ? "rgba(239, 68, 68, 0.18)" : undefined,
            }}
          >
            <Sparkles size={15} />
          </button>
        )}

        {onToggleSplit && (
          <button
            className={`btn btn--icon ${isSplit ? "btn--active" : ""}`}
            onClick={onToggleSplit}
            title="Toggle Split Editor (Ctrl+\)"
            style={{ width: 28, height: 28, padding: 0 }}
          >
            <Columns size={15} />
          </button>
        )}

        <button
          className="btn btn--icon"
          onClick={onToggleBottomDock}
          title="Toggle Terminal & Output (Ctrl+`)"
          style={{ width: 28, height: 28, padding: 0 }}
        >
          <TerminalIcon size={15} />
        </button>

        <button
          className="btn btn--icon"
          onClick={onToggleRightPanel}
          title="Toggle AI Context Panel"
          style={{ width: 28, height: 28, padding: 0 }}
        >
          <Bot size={15} />
        </button>

        {onOpenSettings && (
          <button
            className="btn btn--icon"
            onClick={onOpenSettings}
            title="Settings & API Keys"
            style={{ width: 28, height: 28, padding: 0 }}
          >
            <Sliders size={15} />
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
            {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
          </button>
        )}
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
