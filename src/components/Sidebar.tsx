/**
 * Sidebar Component — Full IDE Sidebar
 * Features: Explorer with Open Editors + File Tree + Context Menu,
 * Global Search & Replace, Source Control (Git) with Staged/Unstaged & AI Commit,
 * Conversations, Memory, Diagnostics, Plugins.
 */
import { useState, useMemo, useEffect } from "react";
import { ProjectInfo, EditorTab, FileSearchMatch, GitCommitItem } from "../types/ipc";
import { CustomDialog } from "./GlobalDialog";
import { 
  filesystem, 
  git, 
  models,
  plugins as ipcPlugins
} from "../services/ipc";
import { BrainSidebarPanel } from "./brain/BrainSidebarPanel";
import { ExtensionsPanel } from "./ExtensionsPanel";
import { ClaudeCodePanel } from "./ClaudeCodePanel";
import { ExtensionWebviewHost } from "./ExtensionWebviewHost";
import { ClaudeIcon } from "./ClaudeIcon";
import { AccountFlyout } from "./AccountFlyout";
import type { AuthSession } from "../types/auth";
import { getFileIcon } from "./editor/EditorTabBar";
import { 
  User as UserIcon,
  Settings as SettingsIcon,
  Folder, 
  FolderPlus, 
  FilePlus, 
  RefreshCw, 
  Search, 
  GitBranch, 
  MessageSquare, 
  Brain, 
  Puzzle, 
  Plus, 
  Sparkles, 
  UploadCloud, 
  DownloadCloud, 
  RotateCcw, 
  Trash2, 
  Copy, 
  Edit3, 
  ChevronRight, 
  ChevronDown,
  FolderOpen,
  Pin,
  MoreHorizontal,
} from "lucide-react";

interface SidebarProps {
  visible: boolean;
  activeView: string;
  width?: number;
  onViewChange: (view: string) => void;
  activeProject: ProjectInfo | null;
  recentProjects: ProjectInfo[];
  conversations: { id: number; title: string; pinned?: boolean; archived?: boolean }[];
  activeConversationId: number;
  onSelectConversation: (id: number) => void;
  onRenameConversation: (id: number, title: string) => void;
  onDeleteConversation: (id: number) => void;
  onDuplicateConversation: (id: number) => void;
  onTogglePinConversation: (id: number) => void;
  onToggleArchiveConversation: (id: number) => void;
  onExportConversation: (id: number) => void;
  onOpenProject: (path: string) => void;
  onOpenFile: (path: string) => void;
  onNewConversation: () => void;
  openTabs?: EditorTab[];
  activeTabId?: string | null;
  onCloseTab?: (tabId: string, e: React.MouseEvent) => void;
  onSelectTab?: (tabId: string) => void;
  activeModel?: string | null;
  onOpenGraph?: () => void;
  onOpenExtension?: (ext: any) => void;
  theme?: "dark" | "light";
  session?: AuthSession | null;
  onOpenAuthModal?: () => void;
  onOpenSettings?: () => void;
  onLogout?: () => void;
}

export function Sidebar({
  visible,
  activeView,
  width,
  onViewChange,
  activeProject,
  recentProjects,
  conversations,
  activeConversationId,
  onSelectConversation,
  onRenameConversation,
  onDeleteConversation,
  onDuplicateConversation,
  onTogglePinConversation,
  onToggleArchiveConversation,
  onExportConversation,
  onOpenProject,
  onOpenFile,
  onNewConversation,
  openTabs = [],
  activeTabId = null,
  onCloseTab: _onCloseTab,
  onSelectTab: _onSelectTab,
  activeModel,
  onOpenGraph,
  onOpenExtension,
  theme = "dark",
  session = null,
  onOpenAuthModal,
  onOpenSettings,
  onLogout,
}: SidebarProps) {
  const activeTab = openTabs.find((t) => t.id === activeTabId) || null;

  const [accountFlyoutOpen, setAccountFlyoutOpen] = useState(false);
  const [installedExtensions, setInstalledExtensions] = useState<any[]>([]);
  const [claudeMode, setClaudeMode] = useState<"extension" | "sessions">("extension");

  useEffect(() => {
    let mounted = true;
    const loadExtensions = async () => {
      try {
        const res: any = await ipcPlugins.getInstalledExtensions();
        if (mounted && res?.data?.extensions && Array.isArray(res.data.extensions)) {
          setInstalledExtensions(res.data.extensions);
        }
      } catch (e) {
        console.warn("Failed to query installed extensions in Sidebar:", e);
      }
    };
    void loadExtensions();
    const handleExtChange = () => { void loadExtensions(); };
    window.addEventListener("csotic:extensions-changed", handleExtChange);
    return () => {
      mounted = false;
      window.removeEventListener("csotic:extensions-changed", handleExtChange);
    };
  }, []);

  const hasClaude = useMemo(() => {
    return installedExtensions.some(
      (ext) =>
        ext.id?.toLowerCase().includes("claude") ||
        ext.name?.toLowerCase().includes("claude") ||
        ext.displayName?.toLowerCase().includes("claude")
    );
  }, [installedExtensions]);

  const navItems = useMemo(() => {
    const items: Array<{ id: string; label: string; icon: React.ReactNode; accent?: string }> = [
      { id: "explorer", label: "Explorer", icon: <Folder size={18} /> },
      { id: "search", label: "Search", icon: <Search size={18} /> },
      { id: "git", label: "Source Control", icon: <GitBranch size={18} /> },
      { id: "chat", label: "AI Pair Programmer", icon: <MessageSquare size={18} /> },
      { id: "memory", label: "Obsidian Brain", icon: <Brain size={18} /> },
    ];

    if (hasClaude) {
      items.push({
        id: "claude-code",
        label: "Claude Code",
        icon: <ClaudeIcon size={18} />,
        accent: "#da7756",
      });
    }

    items.push({ id: "plugins", label: "Extensions", icon: <Puzzle size={18} /> });
    return items;
  }, [hasClaude]);

  const renderBottomRail = () => (
    <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: "100%", paddingBottom: 4 }}>
      {/* Account Anchor Button */}
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setAccountFlyoutOpen(!accountFlyoutOpen)}
          title={session?.user ? `Signed in as ${session.user.name || session.user.username}` : "Accounts & Sign In"}
          aria-label="Accounts"
          style={{
            width: 34,
            height: 34,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
            background: session?.user ? "rgba(239, 68, 68, 0.15)" : "transparent",
            border: session?.user ? "1.5px solid rgba(239, 68, 68, 0.6)" : "1px solid var(--color-border-subtle)",
            color: session?.user ? "#ef4444" : "var(--color-text-secondary)",
            cursor: "pointer",
            position: "relative",
            transition: "all 0.15s ease",
            padding: 0,
            overflow: "visible",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "#ef4444";
            e.currentTarget.style.transform = "scale(1.05)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = session?.user ? "rgba(239, 68, 68, 0.6)" : "var(--color-border-subtle)";
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          {session?.user?.avatarUrl ? (
            <img
              src={session.user.avatarUrl}
              alt={session.user.name || "User"}
              style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
            />
          ) : (
            <UserIcon size={17} />
          )}

          {/* Online / Active status badge dot */}
          {session?.user && (
            <span
              style={{
                position: "absolute",
                bottom: -1,
                right: -1,
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: "#22c55e",
                border: "2px solid var(--color-bg-base)",
                boxShadow: "0 0 4px #22c55e",
              }}
            />
          )}
        </button>

        <AccountFlyout
          isOpen={accountFlyoutOpen}
          onClose={() => setAccountFlyoutOpen(false)}
          session={session}
          onOpenAuthModal={() => {
            setAccountFlyoutOpen(false);
            onOpenAuthModal?.();
          }}
          onOpenSettings={() => {
            setAccountFlyoutOpen(false);
            onOpenSettings?.();
          }}
          onLogout={() => {
            setAccountFlyoutOpen(false);
            onLogout?.();
          }}
        />
      </div>

      {/* Settings Gear Button */}
      {onOpenSettings && (
        <button
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
          className="sidebar__nav-item"
          style={{
            width: 36,
            height: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "var(--radius-md)",
            color: "var(--color-text-secondary)",
          }}
        >
          <SettingsIcon size={18} />
        </button>
      )}
    </div>
  );

  if (!visible) {
    return (
      <aside className="sidebar sidebar--collapsed" style={{ width: 48, height: "100%", display: "flex", flexDirection: "column" }}>
        <nav className="sidebar__nav" style={{ width: 48, flexShrink: 0, height: "100%", display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0", gap: 4, background: "var(--color-bg-base)", borderRight: "1px solid var(--color-border-subtle)" }}>
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`sidebar__nav-item ${activeView === item.id ? "sidebar__nav-item--active" : ""}`}
              onClick={() => onViewChange(item.id)}
              title={item.label}
              aria-label={item.label}
              style={{
                color: item.accent,
              }}
            >
              {item.icon}
            </button>
          ))}
          {renderBottomRail()}
        </nav>
      </aside>
    );
  }

  return (
    <aside
      className="sidebar"
      style={{
        display: "flex",
        height: "100%",
        overflow: "hidden",
        width: width ? `${width}px` : "var(--sidebar-width)",
        minWidth: width ? `${width}px` : "var(--sidebar-width)",
        maxWidth: width ? `${width}px` : "var(--sidebar-width)",
      }}
    >
      {/* Activity Bar Icons */}
      <nav className="sidebar__nav" style={{ width: 48, flexShrink: 0, height: "100%", display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0", gap: 4, background: "var(--color-bg-base)", borderRight: "1px solid var(--color-border-subtle)" }}>
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              className={`sidebar__nav-item ${isActive ? "sidebar__nav-item--active" : ""}`}
              onClick={() => onViewChange(item.id)}
              title={item.label}
              aria-label={item.label}
              style={{
                width: 36,
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "var(--radius-md)",
                color: isActive && item.accent ? item.accent : (item.accent && !isActive ? item.accent : undefined),
                filter: item.accent && isActive ? "drop-shadow(0 0 6px rgba(218, 119, 86, 0.5))" : undefined,
              }}
            >
              {item.icon}
            </button>
          );
        })}
        {renderBottomRail()}
      </nav>

      {/* Primary Sidebar Content Pane */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", background: "var(--color-bg-surface)" }}>
        {activeView !== "plugins" && activeView !== "claude-code" && (
          <div className="sidebar__section-title" style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border-subtle)", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--color-text-secondary)" }}>
            {activeView === "explorer" && "EXPLORER"}
            {activeView === "search" && "Search & Replace"}
            {activeView === "git" && "Source Control"}
            {activeView === "chat" && "Conversations"}
            {activeView === "memory" && "Obsidian Brain & Vault"}
          </div>
        )}

        <div className="sidebar__content" style={{ flex: 1, overflowY: activeView === "plugins" || activeView === "claude-code" ? "hidden" : "auto", display: "flex", flexDirection: "column" }} key={activeView}>
          {activeView === "explorer" && (
            <ExplorerPanel
              activeProject={activeProject}
              recentProjects={recentProjects}
              onOpenFile={onOpenFile}
              onOpenProject={onOpenProject}
            />
          )}
          {activeView === "search" && <SearchPanel activeProject={activeProject} onOpenFile={onOpenFile} />}
          {activeView === "git" && <GitPanel activeProject={activeProject} onOpenFile={onOpenFile} activeModel={activeModel} />}
          {activeView === "chat" && (
            <ChatListPlaceholder 
              onNewConversation={onNewConversation} 
              conversations={conversations}
              activeConversationId={activeConversationId}
              onSelectConversation={onSelectConversation}
              onRenameConversation={onRenameConversation}
              onDeleteConversation={onDeleteConversation}
              onDuplicateConversation={onDuplicateConversation}
              onTogglePinConversation={onTogglePinConversation}
              onToggleArchiveConversation={onToggleArchiveConversation}
              onExportConversation={onExportConversation}
            />
          )}
          {activeView === "memory" && (
            <BrainSidebarPanel
              projectPath={activeProject?.path || null}
              projectName={activeProject?.name}
              activeFilePath={activeTab?.path || null}
              onOpenFile={onOpenFile}
              onOpenGraph={onOpenGraph}
              theme={theme}
            />
          )}
          {activeView === "claude-code" && (
            <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", overflow: "hidden" }}>
              {/* Dual-Mode Selector */}
              <div
                style={{
                  display: "flex",
                  borderBottom: theme === "light" ? "1px solid #e2e8f0" : "1px solid var(--color-border-default)",
                  background: theme === "light" ? "#f8fafc" : "#18181b",
                  padding: "6px 10px",
                  gap: 6,
                  userSelect: "none",
                }}
              >
                <button
                  onClick={() => setClaudeMode("extension")}
                  style={{
                    flex: 1,
                    padding: "5px 8px",
                    fontSize: "11px",
                    fontWeight: 600,
                    borderRadius: 5,
                    border: "none",
                    background: claudeMode === "extension"
                      ? (theme === "light" ? "rgba(217, 119, 6, 0.15)" : "rgba(217, 119, 6, 0.22)")
                      : (theme === "light" ? "rgba(0, 0, 0, 0.04)" : "rgba(255, 255, 255, 0.03)"),
                    color: claudeMode === "extension"
                      ? "#d97706"
                      : (theme === "light" ? "#475569" : "#9ca3af"),
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  Live Webview (Host)
                </button>
                <button
                  onClick={() => setClaudeMode("sessions")}
                  style={{
                    flex: 1,
                    padding: "5px 8px",
                    fontSize: "11px",
                    fontWeight: 600,
                    borderRadius: 5,
                    border: "none",
                    background: claudeMode === "sessions"
                      ? (theme === "light" ? "rgba(0, 0, 0, 0.08)" : "rgba(255, 255, 255, 0.1)")
                      : (theme === "light" ? "rgba(0, 0, 0, 0.04)" : "rgba(255, 255, 255, 0.03)"),
                    color: claudeMode === "sessions"
                      ? (theme === "light" ? "#0f172a" : "#ffffff")
                      : (theme === "light" ? "#475569" : "#9ca3af"),
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  Session Scanner
                </button>
              </div>

              {/* View Body */}
              <div style={{ flex: 1, overflow: "hidden" }}>
                {claudeMode === "extension" ? (
                  <ExtensionWebviewHost
                    viewId="claudeVSCodeSidebar"
                    extensionId="Anthropic.claude-code"
                    title="Claude Code"
                    workspaceRoot={activeProject?.path}
                    theme={theme}
                  />
                ) : (
                  <ClaudeCodePanel
                    activeProject={activeProject}
                    activeFilePath={activeTab?.path}
                    onOpenFile={onOpenFile}
                    onOpenExtension={(extId) => {
                      const ext = installedExtensions.find((e) => e.id === extId);
                      if (ext && onOpenExtension) onOpenExtension(ext);
                    }}
                    onOpenTerminal={(cmd?: string) => {
                      window.dispatchEvent(new CustomEvent("csotic:open-terminal", { detail: { cmd: cmd || "claude" } }));
                    }}
                  />
                )}
              </div>
            </div>
          )}
          {activeView === "plugins" && (
            <ExtensionsPanel 
              onOpenExtension={onOpenExtension} 
              activeExtensionId={activeTab?.path?.startsWith("extension:") ? activeTab.path.replace("extension:", "") : null} 
            />
          )}
        </div>
      </div>
    </aside>
  );
}

/* =========================================================================
   1. Explorer Panel with Open Editors + Tree + Context Menu
   ========================================================================= */

interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
  expanded?: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: FileNode;
}

function ExplorerPanel({
  activeProject,
  recentProjects: _recentProjects = [],
  onOpenFile,
  onOpenProject,
}: {
  activeProject: ProjectInfo | null;
  recentProjects?: ProjectInfo[];
  onOpenFile: (path: string) => void;
  onOpenProject: (path: string) => void;
}) {
  const [_projectPath, setProjectPath] = useState("");
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);

  useEffect(() => {
    if (activeProject) {
      loadDir(activeProject.path).then((entries) => {
        setFileTree(entries);
      });
    } else {
      setFileTree([]);
    }
  }, [activeProject]);

  useEffect(() => {
    const handleGlobalClick = () => setContextMenu(null);
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, []);

  const loadDir = async (dirPath: string): Promise<FileNode[]> => {
    setLoading(true);
    const res = await filesystem.readDir(dirPath);
    setLoading(false);
    if (res.success && res.data) {
      return (res.data as any).entries as FileNode[];
    }
    return [];
  };

  const toggleFolder = async (node: FileNode, levelPath: number[]) => {
    if (!node.is_dir) return;
    const newTree = [...fileTree];
    let current = newTree;
    let targetNode: FileNode | null = null;
    
    for (let i = 0; i < levelPath.length; i++) {
      targetNode = current[levelPath[i]];
      if (i < levelPath.length - 1 && targetNode.children) {
        current = targetNode.children;
      }
    }

    if (targetNode) {
      if (targetNode.expanded) {
        targetNode.expanded = false;
      } else {
        if (!targetNode.children) {
          targetNode.children = await loadDir(targetNode.path);
        }
        targetNode.expanded = true;
      }
      setFileTree(newTree);
    }
  };

  const handleRefresh = async () => {
    if (!activeProject) return;
    const entries = await loadDir(activeProject.path);
    setFileTree(entries);
  };

  const handleCreateFile = async (parentPath?: string) => {
    if (!activeProject) return;
    const base = parentPath || activeProject.path;
    const fileName = await CustomDialog.prompt("Enter new file name (e.g. App.tsx):");
    if (!fileName || !fileName.trim()) return;
    const fullPath = `${base}/${fileName.trim()}`;
    const res = await filesystem.writeFile(fullPath, "");
    if (res.success) {
      await handleRefresh();
      onOpenFile(fullPath);
    } else {
      await CustomDialog.alert(`Failed to create file: ${res.error?.message || "Unknown error"}`);
    }
  };

  const handleCreateFolder = async (parentPath?: string) => {
    if (!activeProject) return;
    const base = parentPath || activeProject.path;
    const folderName = await CustomDialog.prompt("Enter new folder name:");
    if (!folderName || !folderName.trim()) return;
    const fullPath = `${base}/${folderName.trim()}`;
    const res = await filesystem.createDir(fullPath);
    if (res.success) {
      await handleRefresh();
    } else {
      await CustomDialog.alert(`Failed to create folder: ${res.error?.message || "Unknown error"}`);
    }
  };

  const handleRename = async (node: FileNode) => {
    const newName = await CustomDialog.prompt("Rename to:", node.name);
    if (!newName || !newName.trim() || newName.trim() === node.name) return;
    const lastSlash = Math.max(node.path.lastIndexOf("/"), node.path.lastIndexOf("\\"));
    const parent = lastSlash >= 0 ? node.path.substring(0, lastSlash) : (activeProject?.path || "");
    const newPath = `${parent}/${newName.trim()}`;
    const res = await filesystem.rename(node.path, newPath);
    if (res.success) {
      await handleRefresh();
    } else {
      await CustomDialog.alert(`Failed to rename: ${res.error?.message || "Unknown error"}`);
    }
  };

  const handleDelete = async (node: FileNode) => {
    const confirmed = await CustomDialog.confirm(`Are you sure you want to delete ${node.name}?`);
    if (!confirmed) return;
    const res = await filesystem.deletePath(node.path, true);
    if (res.success) {
      await handleRefresh();
    } else {
      await CustomDialog.alert(`Failed to delete: ${res.error?.message || "Unknown error"}`);
    }
  };

  const handleDuplicate = async (node: FileNode) => {
    if (node.is_dir) return;
    const ext = node.name.includes(".") ? `.${node.name.split(".").pop()}` : "";
    const base = node.name.replace(ext, "");
    const newName = `${base}.copy${ext}`;
    const lastSlash = Math.max(node.path.lastIndexOf("/"), node.path.lastIndexOf("\\"));
    const parent = lastSlash >= 0 ? node.path.substring(0, lastSlash) : (activeProject?.path || "");
    const newPath = `${parent}/${newName}`;
    const res = await filesystem.copyFile(node.path, newPath);
    if (res.success) {
      await handleRefresh();
      onOpenFile(newPath);
    }
  };

  const renderTree = (nodes: FileNode[], level: number = 0, levelPath: number[] = []) => {
    return nodes.map((node, idx) => {
      const currentPath = [...levelPath, idx];
      return (
        <div key={node.path} style={{ position: "relative" }}>
          <div
            style={{
              padding: `3px 8px 3px ${level === 0 ? 8 : 10}px`,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: "12px",
              color: node.is_dir ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              userSelect: "none",
            }}
            className="file-tree__item"
            onClick={() => {
              if (node.is_dir) {
                toggleFolder(node, currentPath);
              } else {
                onOpenFile(node.path);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, node });
            }}
          >
            {node.is_dir ? (
              <span style={{ fontSize: "10px", width: 12, display: "flex", alignItems: "center", opacity: 0.7 }}>
                {node.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </span>
            ) : (
              <span style={{ width: 12 }}></span>
            )}
            {node.is_dir ? <Folder size={14} style={{ color: "#ef4444" }} /> : getFileIcon(node.name)}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {node.name}
            </span>
          </div>
          {node.is_dir && node.expanded && node.children && (
            <div
              className="tree-indent-guide"
              style={{
                position: "relative",
                marginLeft: "14px",
                borderLeft: "1px solid var(--color-tree-indent, rgba(239, 68, 68, 0.22))",
              }}
            >
              {renderTree(node.children, level + 1, currentPath)}
            </div>
          )}
        </div>
      );
    });
  };

  const handleBrowse = async () => {
    const res = await filesystem.selectFolder();
    if (res.success && res.data && (res.data as any).path) {
      const selectedPath = (res.data as any).path;
      setProjectPath(selectedPath);
      onOpenProject(selectedPath);
    }
  };

  if (activeProject) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", color: "var(--color-text-secondary)", position: "relative" }}>
        {/* Project Header Bar with File Actions */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 12px", borderBottom: "1px solid var(--color-border-subtle)", background: "rgba(0,0,0,0.15)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden", minWidth: 0 }}>
            <ChevronDown size={13} style={{ color: "var(--color-text-secondary)", flexShrink: 0 }} />
            <span style={{ fontWeight: 700, color: "var(--color-text-primary)", fontSize: "11px", textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "0.5px" }}>
              {activeProject.name}
            </span>
          </div>
          <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
            <button className="btn btn--icon" onClick={() => handleCreateFile()} title="New File" style={{ width: 22, height: 22, padding: 0 }}>
              <FilePlus size={13} />
            </button>
            <button className="btn btn--icon" onClick={() => handleCreateFolder()} title="New Folder" style={{ width: 22, height: 22, padding: 0 }}>
              <FolderPlus size={13} />
            </button>
            <button className="btn btn--icon" onClick={handleRefresh} title="Refresh Explorer" style={{ width: 22, height: 22, padding: 0 }}>
              <RefreshCw size={13} />
            </button>
            <button className="btn btn--icon" onClick={() => setFileTree((prev) => prev.map((n) => ({ ...n, expanded: false })))} title="Collapse All Folders" style={{ width: 22, height: 22, padding: 0 }}>
              <Folder size={12} />
            </button>
          </div>
        </div>

        {/* File Tree */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
          {loading && fileTree.length === 0 ? (
            <div style={{ padding: "12px", fontSize: "12px", color: "var(--color-text-tertiary)" }}>Loading file tree…</div>
          ) : (
            renderTree(fileTree)
          )}
        </div>

        {/* OUTLINE Accordion Section */}
        <div style={{ borderTop: "1px solid var(--color-border-subtle)", marginTop: "auto" }}>
          <div
            onClick={() => setOutlineOpen(!outlineOpen)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 12px",
              cursor: "pointer",
              fontSize: "11px",
              fontWeight: 700,
              color: "var(--color-text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              background: "rgba(0, 0, 0, 0.15)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {outlineOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span>Outline</span>
            </div>
          </div>
          {outlineOpen && (
            <div style={{ padding: "8px 14px", fontSize: "11px", color: "var(--color-text-tertiary)", fontStyle: "italic" }}>
              No symbols found in active file.
            </div>
          )}
        </div>

        {/* Right-click Context Menu */}
        {contextMenu && (
          <div
            style={{
              position: "fixed",
              top: contextMenu.y,
              left: contextMenu.x,
              zIndex: 1000,
              background: "var(--color-bg-surface)",
              border: "1px solid var(--color-border-default)",
              borderRadius: "var(--radius-md)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
              minWidth: 160,
              padding: 4,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.node.is_dir && (
              <>
                <button className="btn btn--ghost" onClick={() => { handleCreateFile(contextMenu.node.path); setContextMenu(null); }} style={{ justifyContent: "flex-start", fontSize: "11.5px", height: 24, gap: 6 }}>
                  <FilePlus size={12} /> New File...
                </button>
                <button className="btn btn--ghost" onClick={() => { handleCreateFolder(contextMenu.node.path); setContextMenu(null); }} style={{ justifyContent: "flex-start", fontSize: "11.5px", height: 24, gap: 6 }}>
                  <FolderPlus size={12} /> New Folder...
                </button>
                <div style={{ height: 1, background: "var(--color-border-subtle)", margin: "2px 0" }} />
              </>
            )}
            {!contextMenu.node.is_dir && (
              <button className="btn btn--ghost" onClick={() => { handleDuplicate(contextMenu.node); setContextMenu(null); }} style={{ justifyContent: "flex-start", fontSize: "11.5px", height: 24, gap: 6 }}>
                <Copy size={12} /> Duplicate
              </button>
            )}
            <button className="btn btn--ghost" onClick={() => { handleRename(contextMenu.node); setContextMenu(null); }} style={{ justifyContent: "flex-start", fontSize: "11.5px", height: 24, gap: 6 }}>
              <Edit3 size={12} /> Rename...
            </button>
            <button className="btn btn--ghost" onClick={() => { navigator.clipboard.writeText(contextMenu.node.path); setContextMenu(null); }} style={{ justifyContent: "flex-start", fontSize: "11.5px", height: 24, gap: 6 }}>
              <Copy size={12} /> Copy Path
            </button>
            <div style={{ height: 1, background: "var(--color-border-subtle)", margin: "2px 0" }} />
            <button className="btn btn--ghost" onClick={() => { handleDelete(contextMenu.node); setContextMenu(null); }} style={{ justifyContent: "flex-start", fontSize: "11.5px", height: 24, gap: 6, color: "var(--color-error)" }}>
              <Trash2 size={12} /> Delete
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "24px 16px", color: "var(--color-text-secondary)" }}>
      <div style={{ fontSize: "11px", textTransform: "uppercase", fontWeight: 700, color: "var(--color-text-tertiary)", letterSpacing: "0.5px", marginBottom: "8px" }}>
        No Folder Opened
      </div>
      <p style={{ fontSize: "12px", color: "#8b949e", margin: "0 0 16px 0", lineHeight: 1.45 }}>
        You have not yet opened a folder.
      </p>
      <button
        type="button"
        onClick={handleBrowse}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          height: 32,
          padding: "0 14px",
          background: "rgba(239, 68, 68, 0.15)",
          border: "1px solid rgba(239, 68, 68, 0.35)",
          borderRadius: 6,
          color: "#fca5a5",
          fontSize: "12px",
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 0.15s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#ef4444";
          e.currentTarget.style.color = "#ffffff";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)";
          e.currentTarget.style.color = "#fca5a5";
        }}
      >
        <FolderOpen size={14} />
        <span>Open Folder</span>
      </button>
    </div>
  );
}

/* =========================================================================
   2. SearchPanel with Global Project Search & Replace
   ========================================================================= */

function SearchPanel({ activeProject, onOpenFile }: { activeProject: ProjectInfo | null; onOpenFile: (path: string) => void }) {
  const [query, setQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matches, setMatches] = useState<FileSearchMatch[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setMatches([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      const res = await filesystem.searchInFiles(query.trim(), caseSensitive);
      if (res.success && res.data && (res.data as any).matches) {
        setMatches((res.data as any).matches as FileSearchMatch[]);
      } else {
        setMatches([]);
      }
      setLoading(false);
    }, 250);

    return () => clearTimeout(timer);
  }, [query, caseSensitive, activeProject]);

  const handleReplaceAll = async () => {
    if (!query.trim() || matches.length === 0) return;
    const confirmed = await CustomDialog.confirm(`Replace all ${matches.length} occurrences of "${query}" with "${replaceQuery}"?`);
    if (!confirmed) return;

    // Group matches by file
    const fileMap: Record<string, boolean> = {};
    for (const m of matches) {
      fileMap[m.file] = true;
    }

    for (const filePath of Object.keys(fileMap)) {
      const readRes = await filesystem.readFile(filePath);
      if (readRes.success && readRes.data) {
        const content = (readRes.data as any).content || "";
        const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi");
        const newContent = content.replace(regex, replaceQuery);
        await filesystem.writeFile(filePath, newContent);
      }
    }

    await CustomDialog.alert("Replaced successfully across all files!");
    // Re-run search
    const res = await filesystem.searchInFiles(query.trim(), caseSensitive);
    if (res.success && res.data && (res.data as any).matches) {
      setMatches((res.data as any).matches as FileSearchMatch[]);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "10px", gap: "8px" }}>
      {/* Search Input */}
      <div style={{ display: "flex", gap: 4 }}>
        <input
          className="input"
          type="text"
          placeholder="Search in files... (regex or text)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, fontSize: "12px", padding: "6px 8px" }}
          autoFocus
        />
        <button
          className={`btn btn--icon ${caseSensitive ? "btn--active" : ""}`}
          onClick={() => setCaseSensitive(!caseSensitive)}
          title="Match Case"
          style={{ width: 28, height: 28, padding: 0, fontSize: "11px", fontWeight: "bold" }}
        >
          Aa
        </button>
      </div>

      {/* Replace toggle & input */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button
            onClick={() => setShowReplace(!showReplace)}
            style={{ background: "transparent", border: "none", color: "var(--color-accent-primary)", fontSize: "11px", cursor: "pointer", padding: 0 }}
          >
            {showReplace ? "▾ Hide Replace" : "▸ Toggle Replace"}
          </button>
          {showReplace && matches.length > 0 && (
            <button className="btn btn--secondary" onClick={handleReplaceAll} style={{ fontSize: "10.5px", padding: "2px 8px" }}>
              Replace All ({matches.length})
            </button>
          )}
        </div>

        {showReplace && (
          <input
            className="input"
            type="text"
            placeholder="Replace with..."
            value={replaceQuery}
            onChange={(e) => setReplaceQuery(e.target.value)}
            style={{ fontSize: "12px", padding: "6px 8px" }}
          />
        )}
      </div>

      {/* Results List */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
        {loading ? (
          <div style={{ padding: "12px", color: "var(--color-text-tertiary)", fontSize: "12px" }}>Searching workspace…</div>
        ) : !query.trim() ? (
          <div className="empty-state" style={{ padding: "16px" }}>
            <div className="empty-state__icon" style={{ display: "flex", justifyContent: "center" }}>
              <Search size={24} style={{ color: "var(--color-text-tertiary)", opacity: 0.5 }} />
            </div>
            <div className="empty-state__title" style={{ fontSize: "12px" }}>Search in Project</div>
            <div className="empty-state__description" style={{ fontSize: "11px" }}>
              Search across all files with instant live line matching.
            </div>
          </div>
        ) : matches.length === 0 ? (
          <div className="empty-state" style={{ padding: "16px" }}>
            <div className="empty-state__description" style={{ fontSize: "12px" }}>
              No matches found for "{query}".
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", padding: "2px 4px 6px", fontWeight: 600 }}>
              {matches.length} matches found
            </div>
            {matches.map((m, idx) => (
              <div
                key={idx}
                onClick={() => onOpenFile(m.file)}
                style={{
                  padding: "6px 8px",
                  borderRadius: "var(--radius-sm)",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.05)",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  marginBottom: 4,
                }}
                className="search-result-item"
                title={m.file}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11.5px" }}>
                  <span style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>{m.relative_path}</span>
                  <span style={{ fontSize: "10px", color: "#f87171", fontFamily: "var(--font-mono)" }}>
                    L{m.line_number}
                  </span>
                </div>
                <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {m.line_text}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================================================================
   3. GitPanel with Staged/Unstaged, AI Commit, and Log History
   ========================================================================= */

function GitPanel({ activeProject, onOpenFile, activeModel }: { activeProject: ProjectInfo | null; onOpenFile: (path: string) => void; activeModel?: string | null }) {
  const [statusText, setStatusText] = useState<string>("");
  const [commitMessage, setCommitMessage] = useState("");
  const [currentBranch, setCurrentBranch] = useState("main");
  const [activeTab, setActiveTab] = useState<"changes" | "history">("changes");
  const [commits, setCommits] = useState<GitCommitItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isGeneratingMessage, setIsGeneratingMessage] = useState(false);

  const fetchGit = async () => {
    if (!activeProject) return;
    setLoading(true);
    const statusRes = await git.status(activeProject.path);
    if (statusRes.success && statusRes.data) {
      setStatusText(((statusRes.data as any).status || "").trim());
    }

    const branchRes = await git.branch(activeProject.path);
    if (branchRes.success && branchRes.data) {
      const raw = (branchRes.data as any).branches || "";
      raw.split("\n").forEach((b: string) => {
        const clean = b.replace("*", "").trim();
        if (b.startsWith("*")) setCurrentBranch(clean);
      });
    }

    const logRes = await git.log(activeProject.path, 15);
    if (logRes.success && logRes.data && (logRes.data as any).commits) {
      setCommits((logRes.data as any).commits);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchGit();
  }, [activeProject]);

  const parsedFiles = useMemo(() => {
    if (!statusText) return { staged: [], unstaged: [] };
    const staged: any[] = [];
    const unstaged: any[] = [];

    statusText.split("\n").forEach((line) => {
      if (!line.trim()) return;
      const indexStatus = line[0];
      const workTreeStatus = line[1];
      const relPath = line.substring(3).trim();
      const basename = relPath.split(/[/\\]/).pop() || relPath;
      const fullPath = `${activeProject?.path}/${relPath}`;

      if (indexStatus !== " " && indexStatus !== "?") {
        staged.push({ relPath, fullPath, basename, status: indexStatus });
      }
      if (workTreeStatus !== " " || indexStatus === "?") {
        unstaged.push({ relPath, fullPath, basename, status: workTreeStatus === " " ? indexStatus : workTreeStatus });
      }
    });

    return { staged, unstaged };
  }, [statusText, activeProject]);

  const handleStageFile = async (path: string) => {
    if (!activeProject) return;
    await git.add(activeProject.path, path);
    await fetchGit();
  };

  const handleUnstageFile = async (path: string) => {
    if (!activeProject) return;
    await git.unstage(activeProject.path, path);
    await fetchGit();
  };

  const handleDiscardFile = async (path: string) => {
    if (!activeProject) return;
    const confirmed = await CustomDialog.confirm(`Discard changes to ${path.split(/[/\\]/).pop()}?`);
    if (!confirmed) return;
    await git.discard(activeProject.path, path);
    await fetchGit();
  };

  const handleStageAll = async () => {
    if (!activeProject) return;
    await git.add(activeProject.path, ".");
    await fetchGit();
  };

  const handleCommit = async () => {
    if (!activeProject || !commitMessage.trim()) return;
    // If no staged files, stage all first
    if (parsedFiles.staged.length === 0) {
      await git.add(activeProject.path, ".");
    }
    const res = await git.commit(activeProject.path, commitMessage.trim());
    if (res.success) {
      setCommitMessage("");
      await fetchGit();
    } else {
      await CustomDialog.alert(`Commit failed: ${res.error?.message || "Unknown error"}`);
    }
  };

  const handleGenerateCommitMessage = async () => {
    if (!activeProject || !activeModel) {
      await CustomDialog.alert("Please select an AI model in the top bar to generate commit messages.");
      return;
    }
    setIsGeneratingMessage(true);
    try {
      const diffRes = await git.diff(activeProject.path);
      const diffContent = diffRes.success ? (diffRes.data as any).diff || "" : "";
      const prompt = `Generate a concise, conventional commit message (e.g. feat: ..., fix: ..., refactor: ...) for this Git diff. Output ONLY the commit message with no extra quotes, formatting, or commentary:\n\n${diffContent.slice(0, 3000)}`;
      const res = await models.executePrompt(activeModel, prompt, "You are a Git commit message generator. Return only the 1-line commit summary.");
      if (res.success && res.data) {
        const msg = ((res.data as any).response || "").trim().replace(/^["']|["']$/g, "");
        setCommitMessage(msg);
      } else if (!res.success) {
        await CustomDialog.alert(`Failed to generate commit message: ${res.error?.message || "Check your API key and connection."}`);
      }
    } catch (err) {
      console.error(err);
      await CustomDialog.alert(`Error generating commit message: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsGeneratingMessage(false);
    }
  };

  const handleCreateBranch = async () => {
    if (!activeProject) return;
    const name = await CustomDialog.prompt("Enter new branch name:");
    if (!name || !name.trim()) return;
    const res = await git.createBranch(activeProject.path, name.trim());
    if (res.success) {
      await fetchGit();
    } else {
      await CustomDialog.alert(`Failed to create branch: ${res.error?.message || "Unknown error"}`);
    }
  };

  const handlePush = async () => {
    if (!activeProject) return;
    setLoading(true);
    const res = await git.push(activeProject.path);
    setLoading(false);
    if (!res.success) {
      await CustomDialog.alert(`Push failed: ${res.error?.message || "Unknown error"}`);
    } else {
      await CustomDialog.alert("Pushed changes to remote branch successfully!");
    }
  };

  const handlePull = async () => {
    if (!activeProject) return;
    setLoading(true);
    const res = await git.pull(activeProject.path);
    setLoading(false);
    if (res.success) {
      await fetchGit();
    } else {
      await CustomDialog.alert(`Pull failed: ${res.error?.message || "Unknown error"}`);
    }
  };

  if (!activeProject) {
    return (
      <div className="empty-state" style={{ padding: "20px" }}>
        <div className="empty-state__icon">⎇</div>
        <div className="empty-state__title">No Project Open</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "10px", gap: "8px" }}>
      {/* Branch selector & Actions */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "12px", color: "var(--color-text-primary)", fontWeight: 600 }}>
          <GitBranch size={14} style={{ color: "#ef4444" }} />
          <span>{currentBranch}</span>
        </div>
        <div style={{ display: "flex", gap: 3 }}>
          <button className="btn btn--icon" onClick={handleCreateBranch} title="New Branch" style={{ width: 24, height: 24, padding: 0 }}>
            <Plus size={13} />
          </button>
          <button className="btn btn--icon" onClick={handlePull} title="Pull Remote Changes" style={{ width: 24, height: 24, padding: 0 }}>
            <DownloadCloud size={13} />
          </button>
          <button className="btn btn--icon" onClick={handlePush} title="Push Commits" style={{ width: 24, height: 24, padding: 0 }}>
            <UploadCloud size={13} />
          </button>
          <button className="btn btn--icon" onClick={fetchGit} title="Refresh Git Status" style={{ width: 24, height: 24, padding: 0 }}>
            <RefreshCw size={13} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          </button>
        </div>
      </div>

      {/* Tabs: Changes vs History */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--color-border-subtle)", gap: 8 }}>
        <button
          onClick={() => setActiveTab("changes")}
          style={{
            background: "transparent",
            border: "none",
            color: activeTab === "changes" ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
            borderBottom: activeTab === "changes" ? "2px solid var(--color-accent-primary)" : "2px solid transparent",
            padding: "4px 8px",
            fontSize: "11.5px",
            cursor: "pointer",
            fontWeight: activeTab === "changes" ? 600 : 400,
          }}
        >
          Changes ({parsedFiles.staged.length + parsedFiles.unstaged.length})
        </button>
        <button
          onClick={() => setActiveTab("history")}
          style={{
            background: "transparent",
            border: "none",
            color: activeTab === "history" ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
            borderBottom: activeTab === "history" ? "2px solid var(--color-accent-primary)" : "2px solid transparent",
            padding: "4px 8px",
            fontSize: "11.5px",
            cursor: "pointer",
            fontWeight: activeTab === "history" ? 600 : 400,
          }}
        >
          History
        </button>
      </div>

      {activeTab === "changes" ? (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, overflowY: "auto", gap: 8 }}>
          {/* Commit Message Box */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <textarea
              className="input"
              rows={2}
              placeholder="Commit message (Ctrl+Enter to commit)..."
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void handleCommit();
                }
              }}
              style={{ fontSize: "12px", resize: "none", padding: "6px" }}
            />
            <div style={{ display: "flex", gap: 5 }}>
              <button
                className="btn btn--secondary"
                onClick={handleGenerateCommitMessage}
                disabled={isGeneratingMessage}
                style={{ flex: 1, fontSize: "11px", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
                title="Use AI to write commit message from current diff"
              >
                <Sparkles size={12} style={{ color: "#f87171" }} />
                <span>{isGeneratingMessage ? "Writing message…" : "Generate with AI"}</span>
              </button>
              <button
                className="btn btn--primary"
                onClick={handleCommit}
                disabled={!commitMessage.trim()}
                style={{ fontSize: "11px", padding: "0 12px" }}
              >
                Commit
              </button>
            </div>
          </div>

          {/* Staged Changes */}
          {parsedFiles.staged.length > 0 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" }}>
                <span>Staged Changes ({parsedFiles.staged.length})</span>
                <button className="btn btn--ghost" onClick={async () => { await git.unstage(activeProject.path, "."); await fetchGit(); }} style={{ height: 20, fontSize: "10px", padding: "0 4px" }}>
                  Unstage All
                </button>
              </div>
              {parsedFiles.staged.map((f: any, idx: number) => (
                <div
                  key={idx}
                  onClick={() => onOpenFile(f.fullPath)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "4px 6px",
                    borderRadius: "var(--radius-sm)",
                    background: "rgba(255,255,255,0.03)",
                    fontSize: "11.5px",
                    cursor: "pointer",
                    marginTop: 3,
                  }}
                  className="git-change-item"
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                    <span style={{ fontSize: "10px", color: "var(--color-success)", fontWeight: "bold" }}>{f.status}</span>
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.basename}</span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); void handleUnstageFile(f.relPath); }}
                    style={{ background: "transparent", border: "none", color: "var(--color-text-tertiary)", cursor: "pointer", padding: 0 }}
                    title="Unstage"
                  >
                    -
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Changes (Unstaged) */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" }}>
              <span>Changes ({parsedFiles.unstaged.length})</span>
              {parsedFiles.unstaged.length > 0 && (
                <button className="btn btn--ghost" onClick={handleStageAll} style={{ height: 20, fontSize: "10px", padding: "0 4px" }}>
                  Stage All (+)
                </button>
              )}
            </div>

            {parsedFiles.unstaged.length === 0 && parsedFiles.staged.length === 0 ? (
              <div style={{ fontSize: "11.5px", color: "var(--color-text-tertiary)", padding: "10px 0", fontStyle: "italic" }}>
                Working tree is clean.
              </div>
            ) : (
              parsedFiles.unstaged.map((f: any, idx: number) => (
                <div
                  key={idx}
                  onClick={() => onOpenFile(f.fullPath)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "4px 6px",
                    borderRadius: "var(--radius-sm)",
                    background: "rgba(255,255,255,0.03)",
                    fontSize: "11.5px",
                    cursor: "pointer",
                    marginTop: 3,
                  }}
                  className="git-change-item"
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                    <span style={{ fontSize: "10px", color: f.status === "?" ? "#94a3b8" : "#f87171", fontWeight: "bold" }}>
                      {f.status === "?" ? "U" : f.status}
                    </span>
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.basename}</span>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleDiscardFile(f.relPath); }}
                      style={{ background: "transparent", border: "none", color: "var(--color-text-tertiary)", cursor: "pointer", padding: 0 }}
                      title="Discard changes"
                    >
                      <RotateCcw size={11} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleStageFile(f.relPath); }}
                      style={{ background: "transparent", border: "none", color: "var(--color-text-tertiary)", cursor: "pointer", padding: 0 }}
                      title="Stage file"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        /* Git Commit History */
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          {commits.length === 0 ? (
            <div style={{ fontSize: "11.5px", color: "var(--color-text-tertiary)", padding: "10px 0" }}>
              No commit history found.
            </div>
          ) : (
            commits.map((c, i) => (
              <div
                key={i}
                style={{
                  padding: "6px 8px",
                  borderRadius: "var(--radius-sm)",
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.04)",
                  fontSize: "11.5px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ color: "#f87171", fontFamily: "var(--font-mono)", fontSize: "10.5px" }}>{c.hash}</span>
                  <span style={{ color: "var(--color-text-tertiary)", fontSize: "10px" }}>{c.date}</span>
                </div>
                <div style={{ color: "var(--color-text-primary)", fontWeight: 500, marginTop: 2 }}>{c.message}</div>
                <div style={{ color: "var(--color-text-tertiary)", fontSize: "10px", marginTop: 2 }}>by {c.author}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   4. Chat List & Conversations
   ========================================================================= */

function ChatListPlaceholder({ 
  onNewConversation, 
  conversations,
  activeConversationId,
  onSelectConversation,
  onRenameConversation,
  onDeleteConversation,
  onDuplicateConversation,
  onTogglePinConversation,
  onToggleArchiveConversation,
  onExportConversation,
}: { 
  onNewConversation: () => void;
  conversations: {id: number, title: string, pinned?: boolean, archived?: boolean}[];
  activeConversationId: number;
  onSelectConversation: (id: number) => void;
  onRenameConversation: (id: number, title: string) => void;
  onDeleteConversation: (id: number) => void;
  onDuplicateConversation: (id: number) => void;
  onTogglePinConversation: (id: number) => void;
  onToggleArchiveConversation: (id: number) => void;
  onExportConversation: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);

  const visibleConversations = conversations
    .filter((c) => !c.archived)
    .filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));

  return (
    <div style={{ padding: "8px", display: "flex", flexDirection: "column", height: "100%", gap: 6 }}>
      <button className="btn btn--primary" style={{ width: "100%", fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={onNewConversation}>
        <Plus size={13} />
        <span>New Conversation</span>
      </button>
      <input
        className="input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search conversations..."
        style={{ fontSize: "12px", padding: "5px 8px" }}
      />
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
        {visibleConversations.map((conv) => {
          const isActive = activeConversationId === conv.id;
          return (
            <div
              key={conv.id}
              onClick={() => onSelectConversation(conv.id)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 8px",
                borderRadius: "var(--radius-md)",
                background: isActive ? "rgba(239, 68, 68, 0.15)" : "rgba(255, 255, 255, 0.03)",
                border: isActive ? "1px solid rgba(239, 68, 68, 0.35)" : "1px solid transparent",
                cursor: "pointer",
                fontSize: "12px",
                color: isActive ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                position: "relative",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden", minWidth: 0, flex: 1 }}>
                {conv.pinned && (
                  <Pin size={11} style={{ color: "var(--color-accent-primary)", flexShrink: 0, transform: "rotate(45deg)" }} />
                )}
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: isActive ? 600 : 400 }}>
                  {conv.title}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuId(openMenuId === conv.id ? null : conv.id);
                  }}
                  style={{ background: "transparent", border: "none", color: "inherit", opacity: 0.6, cursor: "pointer", display: "flex", alignItems: "center", padding: "2px" }}
                  title="Options"
                >
                  <MoreHorizontal size={13} />
                </button>
              </div>

              {openMenuId === conv.id && (
                <div
                  style={{
                    position: "absolute",
                    right: 8,
                    top: 28,
                    background: "var(--color-bg-surface)",
                    border: "1px solid var(--color-border-default)",
                    borderRadius: "var(--radius-sm)",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                    zIndex: 100,
                    padding: "4px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    minWidth: 110,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="dropdown-item"
                    onClick={async () => {
                      setOpenMenuId(null);
                      const newTitle = await CustomDialog.prompt("Rename Conversation:", conv.title);
                      if (newTitle?.trim()) onRenameConversation(conv.id, newTitle.trim());
                    }}
                    style={{ padding: "4px 8px", fontSize: "11px", textAlign: "left", borderRadius: 3 }}
                  >
                    Rename
                  </button>
                  <button
                    className="dropdown-item"
                    onClick={() => { setOpenMenuId(null); onDuplicateConversation(conv.id); }}
                    style={{ padding: "4px 8px", fontSize: "11px", textAlign: "left", borderRadius: 3 }}
                  >
                    Duplicate
                  </button>
                  <button
                    className="dropdown-item"
                    onClick={() => { setOpenMenuId(null); onTogglePinConversation(conv.id); }}
                    style={{ padding: "4px 8px", fontSize: "11px", textAlign: "left", borderRadius: 3 }}
                  >
                    {conv.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button
                    className="dropdown-item"
                    onClick={() => { setOpenMenuId(null); onExportConversation(conv.id); }}
                    style={{ padding: "4px 8px", fontSize: "11px", textAlign: "left", borderRadius: 3 }}
                  >
                    Export MD
                  </button>
                  <button
                    className="dropdown-item"
                    onClick={() => { setOpenMenuId(null); onToggleArchiveConversation(conv.id); }}
                    style={{ padding: "4px 8px", fontSize: "11px", textAlign: "left", borderRadius: 3 }}
                  >
                    Archive
                  </button>
                  <button
                    className="dropdown-item"
                    onClick={() => { setOpenMenuId(null); onDeleteConversation(conv.id); }}
                    style={{ padding: "4px 8px", fontSize: "11px", textAlign: "left", borderRadius: 3, color: "#f87171" }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
