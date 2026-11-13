import { useState, useCallback, useEffect, useRef, lazy, Suspense } from "react";
import { TopBar } from "../components/TopBar";
import { Sidebar } from "../components/Sidebar";
import { MainWorkspace, FileDiff, getLanguageFromPath } from "../components/MainWorkspace";
import { BottomDock } from "../components/BottomDock";
import { StatusBar } from "../components/StatusBar";
import { CustomDialog } from "../components/GlobalDialog";
import { workspace, models, filesystem, terminal } from "../services/ipc";
import { ProjectInfo, ModelMetadata, EditorTab } from "../types/ipc";
import { pluginManager } from "../plugins/PluginManager";
import { auth as ipcAuth } from "../services/ipc";
import type { AuthSession } from "../types/auth";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { runTask } from "../services/runTasks";

// Defer modals and heavy panels via React.lazy so they do not impact startup latency or base memory
const RightPanel = lazy(() => import("../components/RightPanel").then((m) => ({ default: m.RightPanel })));
const SearchModal = lazy(() => import("../components/SearchModal").then((m) => ({ default: m.SearchModal })));
const SettingsModal = lazy(() => import("../components/SettingsModal").then((m) => ({ default: m.SettingsModal })));
const AuthModal = lazy(() => import("../components/AuthModal").then((m) => ({ default: m.AuthModal })));
const ShortcutsModal = lazy(() => import("../components/ShortcutsModal").then((m) => ({ default: m.ShortcutsModal })));

interface Conversation {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  projectPaths: string[];
  activeProjectPath?: string;
  activeModel?: string;
  permissionProfile: "read_only" | "edit" | "developer" | "full_automation";
  pinned?: boolean;
  archived?: boolean;
}

const newConversation = (id: number, title = "New Conversation"): Conversation => ({
  id, title, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  projectPaths: [], permissionProfile: "developer",
});

export function AppShell() {
  const [loaded, setLoaded] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(false);
  const [bottomDockVisible, setBottomDockVisible] = useState(false);
  const [activeBottomTab, setActiveBottomTab] = useState<string>("terminal");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchInitialMode, setSearchInitialMode] = useState<"files" | "commands">("files");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"models" | "keys" | "rules" | "accounts" | "general">("keys");
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isSplit, setIsSplit] = useState(false);

  // Theme state: dark | light (persisted in localStorage)
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    return (localStorage.getItem("forge_theme") as "dark" | "light") || "dark";
  });

  const handleToggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem("forge_theme", next);
      document.documentElement.setAttribute("data-theme", next);
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Load persisted authentication session from backend (~/.forge/auth.json)
  useEffect(() => {
    let mounted = true;
    ipcAuth.getSession().then((res: any) => {
      if (mounted && res?.success && res?.data) {
        const session = res.data.session !== undefined ? res.data.session : (res.data.user ? res.data : null);
        setAuthSession(session as AuthSession | null);
      }
    }).catch((err) => {
      console.warn("Failed to get initial auth session:", err);
    });
    return () => { mounted = false; };
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await ipcAuth.logout();
    } catch (e) {
      console.warn("Logout error:", e);
    }
    setAuthSession(null);
  }, []);

  // ── Decoupled View States ──
  // sidebarView: controls ONLY the left sidebar panel
  const [sidebarView, setSidebarView] = useState<string>("explorer");
  // aiSlideVisible: controls the Manual Coder Slide (AI Assistant Drawer) on the right of the editor
  const [aiSlideVisible, setAiSlideVisible] = useState(false);

  // Multi-Tab Editor States
  const [openTabs, setOpenTabs] = useState<EditorTab[]>(() => {
    const showWelcome = localStorage.getItem("csotic.show_welcome_on_startup");
    if (showWelcome !== "false") {
      return [{ id: "welcome", path: "csotic://welcome", title: "Welcome", content: "", isDirty: false }];
    }
    return [];
  });
  const [activeTabId, setActiveTabId] = useState<string | null>(() => {
    const showWelcome = localStorage.getItem("csotic.show_welcome_on_startup");
    if (showWelcome !== "false") {
      return "welcome";
    }
    return null;
  });
  const activeTab = openTabs.find((t) => t.id === activeTabId);
  const [globalCursorPos, setGlobalCursorPos] = useState({ line: 1, col: 1 });
  const untitledCounterRef = useRef(1);

  // Project & Model states
  const [activeProject, setActiveProject] = useState<ProjectInfo | null>(null);
  const [recentProjects, setRecentProjects] = useState<ProjectInfo[]>([]);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [backgroundModel, setBackgroundModel] = useState<string | null>(null);
  const [modelsList, setModelsList] = useState<ModelMetadata[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const saved = localStorage.getItem("forge.conversations");
      const parsed = saved ? JSON.parse(saved) : null;
      if (Array.isArray(parsed) && parsed.length) return parsed.map((item) => ({
        ...newConversation(item.id, item.title), ...item,
        projectPaths: item.projectPaths ?? (item.projectPath ? [item.projectPath] : []),
        activeProjectPath: item.activeProjectPath ?? item.projectPath,
      }));
      return [newConversation(1)];
    } catch {
      return [newConversation(1)];
    }
  });

  const [activeConversationId, setActiveConversationId] = useState(() => {
    try {
      const savedActive = localStorage.getItem("forge.active-conversation-id");
      if (savedActive) return Number(savedActive);
      const saved = localStorage.getItem("forge.conversations");
      const parsed = saved ? JSON.parse(saved) : null;
      if (Array.isArray(parsed) && parsed.length) return parsed[0].id;
      return 1;
    } catch {
      return 1;
    }
  });

  const [activeRightTab, setActiveRightTab] = useState<"overview" | "editor" | "review">("overview");
  const [currentDiff, setCurrentDiff] = useState<FileDiff | null>(null);

  // Resizable panel widths with persistence
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem("forge.sidebar_width");
    return saved ? Math.max(180, Math.min(700, Number(saved))) : 280;
  });
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);

  const [rightPanelWidth, setRightPanelWidth] = useState<number>(() => {
    const saved = localStorage.getItem("forge.right_panel_width");
    return saved ? Math.max(240, Math.min(700, Number(saved))) : 340;
  });
  const [isDraggingRightPanel, setIsDraggingRightPanel] = useState(false);

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingSidebar(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(180, Math.min(window.innerWidth - 400, startWidth + delta));
      setSidebarWidth(newWidth);
      localStorage.setItem("forge.sidebar_width", String(newWidth));
    };

    const onMouseUp = () => {
      setIsDraggingSidebar(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [sidebarWidth]);

  const handleRightPanelResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingRightPanel(true);
    const startX = e.clientX;
    const startWidth = rightPanelWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.max(240, Math.min(window.innerWidth - 400, startWidth + delta));
      setRightPanelWidth(newWidth);
      localStorage.setItem("forge.right_panel_width", String(newWidth));
    };

    const onMouseUp = () => {
      setIsDraggingRightPanel(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [rightPanelWidth]);

  useEffect(() => {
    localStorage.setItem("forge.active-conversation-id", String(activeConversationId));
  }, [activeConversationId]);

  useEffect(() => {
    localStorage.setItem("forge.conversations", JSON.stringify(conversations));
  }, [conversations]);

  // Refresh recent projects from database (cleaned for now per user instruction)
  const refreshRecentProjects = useCallback(async () => {
    setRecentProjects([]);
  }, []);

  // Fetch discovered models from SDK
  const refreshModels = useCallback(async () => {
    const res = await models.discoverModels();
    if (res.success && Array.isArray(res.data)) {
      setModelsList(res.data as ModelMetadata[]);
    }
  }, []);

  // Ultra-fast instant startup: load workspace state immediately (<2ms), defer background tasks
  useEffect(() => {
    let mounted = true;

    async function initFast() {
      let loadedActiveModel: string | null = null;
      let loadedBgModel: string | null = null;

      // 1. Instantly retrieve local SQLite workspace state (< 2ms)
      try {
        const res = await workspace.getState();
        if (res.success && res.data && mounted) {
          const state = res.data as any;
          setSidebarVisible(state.layout?.sidebar_visible ?? true);
          setRightPanelVisible(state.layout?.right_panel_visible ?? false);
          setBottomDockVisible(state.layout?.bottom_dock_visible ?? true);
          setActiveProject(state.active_project);

          loadedActiveModel = state.active_model;
          loadedBgModel = state.background_model;

          setActiveModel(loadedActiveModel);
          setBackgroundModel(loadedBgModel);
        }
      } catch (e) {
        console.error("Workspace state query failed:", e);
      }

      // 2. Mark app as fully loaded IMMEDIATELY for zero-latency instant rendering
      if (mounted) setLoaded(true);

      // 3. Asynchronously background-load plugins, recent projects, and remote models
      pluginManager.discoverAndLoad().catch((e) => console.error("Plugin loading failed:", e));
      refreshRecentProjects().catch((e) => console.error("Recent projects query failed:", e));

      models.discoverModels().then(async (modelsRes) => {
        if (!mounted) return;
        if (modelsRes.success && Array.isArray(modelsRes.data)) {
          const list = modelsRes.data as ModelMetadata[];
          setModelsList(list);

          if (list.length > 0) {
            let activeToSave = loadedActiveModel;
            let bgToSave = loadedBgModel;
            const codingModel = list.find((model) => /coder|code/i.test(model.id));
            const isInvalidActive = !loadedActiveModel || !list.some(m => m.id === loadedActiveModel);
            const shouldUpgradeDefault = isInvalidActive || /dolphin-mistral/i.test(loadedActiveModel || "");

            if (shouldUpgradeDefault) {
              activeToSave = codingModel?.id ?? list[0].id;
              setActiveModel(activeToSave);
            }
            
            const isInvalidBg = !loadedBgModel || !list.some(m => m.id === loadedBgModel);
            if (isInvalidBg) {
              bgToSave = list[0].id;
              setBackgroundModel(bgToSave);
            }

            if (shouldUpgradeDefault || isInvalidBg) {
              const wsRes = await workspace.getState();
              if (wsRes.success && wsRes.data) {
                const state = wsRes.data as any;
                state.active_model = activeToSave;
                state.background_model = bgToSave;
                await workspace.saveState(state);
              }
            }
          }
        }
      }).catch((e) => console.error("Models discovery failed:", e));
    }

    initFast();
    return () => { mounted = false; };
  }, [refreshRecentProjects, refreshModels]);

  // Persist layout
  useEffect(() => {
    if (!loaded) return;
    workspace.updateLayout({
      sidebar_visible: sidebarVisible,
      sidebar_width: 260,
      bottom_dock_visible: bottomDockVisible,
      bottom_dock_height: 240,
      right_panel_visible: rightPanelVisible,
      right_panel_width: 320,
    }).catch((e) => console.error("Layout update failed:", e));
  }, [sidebarVisible, rightPanelVisible, bottomDockVisible, loaded]);

  // Utility to normalize paths safely
  const cleanPath = (p?: string | null) => {
    if (!p) return "";
    return p.replace(/^\\\\\?\\/, "").replace(/^\/\/\?\//, "").replace(/\\/g, "/");
  };

  const handleOpenWelcomeTab = useCallback(() => {
    setOpenTabs((prev) => {
      if (prev.some((t) => t.id === "welcome" || t.path === "csotic://welcome")) {
        return prev;
      }
      return [{ id: "welcome", path: "csotic://welcome", title: "Welcome", content: "", isDirty: false }, ...prev];
    });
    setActiveTabId("welcome");
  }, []);

  const handleRevealInExplorer = useCallback(async () => {
    const targetPath = activeProject?.path || "C:\\codes";
    try {
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(targetPath);
    } catch {
      try {
        await terminal.executeCommand(".", `explorer "${targetPath}"`, true);
      } catch (e) {
        console.warn("Reveal in explorer error:", e);
      }
    }
  }, [activeProject]);

  // Open the interactive Obsidian Knowledge & Code Graph View tab
  const handleOpenBrainGraph = useCallback(() => {
    const id = "forge://brain-graph";
    setOpenTabs((prev) => {
      if (prev.some((t) => t.id === id)) return prev;
      return [...prev, { id, path: id, title: "🌌 Knowledge Graph", content: "", isDirty: false }];
    });
    setActiveTabId(id);
  }, []);

  // ★ KEY FIX: Deduplicating tab open handler with clean canonical IDs
  const handleOpenFile = useCallback(async (path: string) => {
    if (path === "forge://brain-graph") {
      handleOpenBrainGraph();
      return;
    }

    let normalized = cleanPath(path);
    const cleanProj = activeProject ? cleanPath(activeProject.path) : "";

    // 1. Prioritize reading the exact path requested first
    let readRes = await filesystem.readFile(normalized);

    // 2. If direct read failed and we have an active project, try resolving relative candidates
    if (!readRes.success && cleanProj) {
      if (!normalized.startsWith(cleanProj + "/") && !normalized.includes(":") && !normalized.startsWith("/")) {
        const projectCandidate = `${cleanProj}/${normalized}`;
        const checkProj = await filesystem.readFile(projectCandidate);
        if (checkProj.success) {
          normalized = projectCandidate;
          readRes = checkProj;
        } else {
          // Check brain graph markdown notes only if standard file is not found
          const brainCandidate = `${cleanProj}/.forge/brain/${normalized}${normalized.endsWith(".md") ? "" : ".md"}`;
          const checkBrain = await filesystem.readFile(brainCandidate);
          if (checkBrain.success) {
            normalized = brainCandidate;
            readRes = checkBrain;
          }
        }
      }
    }

    // A failed read must not open an empty tab: autosave would then overwrite the real file with "".
    if (!readRes.success) {
      await CustomDialog.alert(`Could not open ${normalized}: ${readRes.error?.message || "file could not be read"}`);
      return;
    }

    const fileName = normalized.split("/").pop() || "untitled";
    const content: string = (readRes.data as any)?.content ?? "";

    setOpenTabs((prev) => {
      // Clear welcome tab when opening a real code file so user directly enters the editor
      const cleaned = prev.filter((t) => t.id !== "welcome" && t.path !== "csotic://welcome");

      // Find existing tab with same canonical path or relative suffix
      const existingIdx = cleaned.findIndex((t) => {
        const tNorm = cleanPath(t.path);
        return t.id === normalized || t.path === normalized || tNorm === normalized || 
               (tNorm.length > 0 && normalized.length > 0 && (tNorm.endsWith("/" + normalized) || normalized.endsWith("/" + tNorm)));
      });

      if (existingIdx !== -1) {
        // Tab already open: canonicalize id/path, refresh from disk unless it has unsaved edits.
        return cleaned.map((t, i) => i === existingIdx ? { ...t, id: normalized, path: normalized, content: t.isDirty ? t.content : content } : t);
      }

      const newTab: EditorTab = {
        id: normalized,
        path: normalized,
        title: fileName,
        content,
        isDirty: false,
      };
      return [...cleaned, newTab];
    });

    setActiveTabId(normalized);
  }, [activeProject, handleOpenBrainGraph]);

  // Handle opening a project folder and directly navigating to its primary file
  const handleOpenProject = useCallback(async (path: string, conversationId = activeConversationId) => {
    try {
      const res = await workspace.openProject(path);
      if (res.success && res.data) {
        const state = res.data as any;
        const activeProj = state.active_project || (state.path ? { name: state.name || path.split(/[/\\]/).filter(Boolean).pop() || "project", path: state.path } : { name: path.split(/[/\\]/).filter(Boolean).pop() || "project", path });
        setActiveProject(activeProj);
        setSidebarVisible(true);
        setSidebarView("explorer");

        // Take user directly to the primary file of the project!
        let targetFile: string | null = null;
        try {
          const dirRes = await filesystem.readDir(activeProj.path);
          const entries = Array.isArray((dirRes?.data as any)?.entries) 
            ? (dirRes.data as any).entries 
            : (Array.isArray(dirRes?.data) ? dirRes.data : []);
          if (entries.length > 0) {
            const files = entries.filter((e: any) => !e.is_dir && !e.name.startsWith("."));
            const entryOrder = ["README.md", "package.json", "index.html", "main.rs", "App.tsx", "main.py", "Main.java", "main.c"];
            const best = files.find((f: any) => entryOrder.includes(f.name));
            if (best) {
              targetFile = best.path;
            } else if (files.length > 0) {
              targetFile = files[0].path;
            }
          }
        } catch (e) {
          console.warn("Could not read project directory:", e);
        }

        if (targetFile) {
          await handleOpenFile(targetFile);
        } else {
          // If no files yet, open an untitled editor buffer inside this project
          const untitledId = `${activeProj.path}/untitled.txt`;
          setOpenTabs([{ id: untitledId, path: untitledId, title: "untitled.txt", content: "", isDirty: false }]);
          setActiveTabId(untitledId);
        }

        setConversations((current) => current.map((conversation) => conversation.id === conversationId
          ? { ...conversation, activeProjectPath: activeProj.path, projectPaths: Array.from(new Set([...conversation.projectPaths, activeProj.path])), updatedAt: new Date().toISOString() }
          : conversation));
        await refreshRecentProjects();
      } else {
        await CustomDialog.alert(`Failed to open project: ${res.error?.message || "Unknown error"}`);
      }
    } catch (e) {
      await CustomDialog.alert(`IPC Error opening project: ${e}`);
    }
  }, [activeConversationId, handleOpenFile, refreshRecentProjects]);

  const handleOpenFolderDialog = useCallback(async () => {
    const res = await filesystem.selectFolder();
    if (res.success && res.data && (res.data as any).path) {
      await handleOpenProject((res.data as any).path);
    }
  }, [handleOpenProject]);

  // Create instant untitled tab (Ctrl+N)
  const handleNewUntitledTab = useCallback(() => {
    const title = `Untitled-${untitledCounterRef.current++}`;
    const id = `untitled://${Date.now()}`;
    const newTab: EditorTab = {
      id,
      path: id,
      title,
      content: "",
      isDirty: false,
    };
    setOpenTabs((prev) => [...prev.filter((t) => t.id !== "welcome" && t.path !== "csotic://welcome"), newTab]);
    setActiveTabId(id);
  }, []);

  // Debounced auto-save timer ref to ensure files are written to disk for compilation
  const autoSaveTimerRef = useRef<Record<string, number>>({});

  const handleTabContentChange = useCallback((tabId: string, newContent: string, isDirty = true) => {
    const normalized = cleanPath(tabId);
    // Exact match only: suffix matching let an edit in one tab overwrite another tab with a similar path.
    setOpenTabs((prev) => prev.map((t) => (t.id === tabId || cleanPath(t.path) === normalized) ? { ...t, content: newContent, isDirty } : t));

    // Auto-save to disk for real file paths so compilers (gcc, salivo, cargo) always see latest code.
    // Virtual tabs (untitled://, extension:, claude-code:, forge://, csotic://) never touch disk.
    const isRealFile = /^([a-zA-Z]:)?\//.test(normalized);
    if (isRealFile) {
      if (autoSaveTimerRef.current[normalized]) {
        window.clearTimeout(autoSaveTimerRef.current[normalized]);
      }
      autoSaveTimerRef.current[normalized] = window.setTimeout(async () => {
        try {
          const res = await filesystem.writeFile(normalized, newContent);
          if (res.success) {
            setOpenTabs((prev) => prev.map((t) => (t.id === tabId || cleanPath(t.path) === normalized) ? { ...t, isDirty: false } : t));
          }
        } catch {}
      }, 350);
    }
  }, []);

  const handleSaveTab = useCallback(async (tabId: string) => {
    const target = openTabs.find((t) => t.id === tabId || cleanPath(t.path) === cleanPath(tabId));
    if (!target) return;

    // Untitled tabs → open native Save As dialog (works without a project)
    if (target.path.startsWith("untitled://")) {
      const res = await filesystem.saveAsDialog(target.title || "untitled.txt", target.content || "");
      if (res.success && res.data) {
        const data = res.data as any;
        if (data.saved && data.path) {
          const cleanSavedPath = cleanPath(data.path);
          const fileName = cleanSavedPath.split(/[/\\]/).pop() || target.title;
          setOpenTabs((prev) => prev.map((t) => t.id === tabId ? { ...t, id: cleanSavedPath, path: cleanSavedPath, title: fileName, isDirty: false } : t));
          setActiveTabId(cleanSavedPath);
        }
      }
      return;
    }

    // Real files → write directly to their absolute path on disk
    const cleanTargetPath = cleanPath(target.path);
    const res = await filesystem.writeFile(cleanTargetPath, target.content || "");
    if (res.success) {
      setOpenTabs((prev) => prev.map((t) => (t.id === tabId || cleanPath(t.path) === cleanTargetPath) ? { ...t, isDirty: false } : t));
    } else {
      await CustomDialog.alert(`Save failed: ${res.error?.message || "Unknown error"}`);
    }
  }, [openTabs]);

  const handleSaveAsTab = useCallback(async (tabId: string) => {
    const target = openTabs.find((t) => t.id === tabId || cleanPath(t.path) === cleanPath(tabId));
    if (!target) return;
    const defaultName = target.path.startsWith("untitled://")
      ? (target.title || "untitled.txt")
      : (target.path.split(/[/\\]/).pop() || "file.txt");
    const res = await filesystem.saveAsDialog(defaultName, target.content || "");
    if (res.success && res.data) {
      const data = res.data as any;
      if (data.saved && data.path) {
        const cleanSavedPath = cleanPath(data.path);
        const fileName = cleanSavedPath.split(/[/\\]/).pop() || defaultName;
        setOpenTabs((prev) => prev.map((t) => t.id === tabId ? { ...t, id: cleanSavedPath, path: cleanSavedPath, title: fileName, isDirty: false } : t));
        setActiveTabId(cleanSavedPath);
      }
    }
  }, [openTabs]);

  const handleSaveAll = useCallback(async () => {
    for (const tab of openTabs) {
      if (tab.isDirty) {
        await handleSaveTab(tab.id);
      }
    }
  }, [openTabs, handleSaveTab]);

  const handleCloseProject = useCallback(async () => {
    await workspace.clearActiveProject();
    setActiveProject(null);
    setOpenTabs([]);
    setActiveTabId(null);
    setConversations((current) => current.map((c) => ({
      ...c,
      activeProjectPath: undefined,
      projectPaths: [],
      updatedAt: new Date().toISOString(),
    })));
  }, []);

  // Open a standalone file via native OS file dialog (no project needed)
  const handleOpenFileDialog = useCallback(async () => {
    const res = await filesystem.openFileDialog();
    if (res.success && res.data) {
      const data = res.data as any;
      if (data.path && data.content !== undefined) {
        const cleanP = cleanPath(data.path);
        const existing = openTabs.find((t) => cleanPath(t.path) === cleanP);
        if (existing) {
          setActiveTabId(existing.id);
          return;
        }
        const newTab: EditorTab = {
          id: cleanP,
          path: cleanP,
          title: data.name || cleanP.split("/").pop() || "file",
          content: data.content,
          isDirty: false,
        };
        setOpenTabs((prev) => [...prev, newTab]);
        setActiveTabId(newTab.id);
        return;
      }
      if (data.path) {
        await handleOpenFile(data.path);
      }
    }
  }, [openTabs, handleOpenFile]);

  // Latest tabs for close handlers, so they can decide (and confirm) before touching state.
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;

  // History stack of closed real file paths for Ctrl+Shift+T
  const closedTabsHistoryRef = useRef<string[]>([]);
  // Navigation history stacks for Alt+ArrowLeft / Alt+ArrowRight
  const tabHistoryRef = useRef<string[]>([]);
  const forwardHistoryRef = useRef<string[]>([]);
  const isNavigatingHistoryRef = useRef(false);

  useEffect(() => {
    if (activeTabId) {
      if (!isNavigatingHistoryRef.current) {
        forwardHistoryRef.current = [];
      }
      isNavigatingHistoryRef.current = false;
      const hist = tabHistoryRef.current;
      if (hist[hist.length - 1] !== activeTabId) {
        hist.push(activeTabId);
        if (hist.length > 50) hist.shift();
      }
    }
  }, [activeTabId]);

  // Real files autosave; only untitled buffers can lose work on close.
  const confirmDiscard = useCallback(async (tabs: EditorTab[]) => {
    const unsaved = tabs.filter((t) => t.isDirty && t.path.startsWith("untitled://"));
    if (unsaved.length === 0) return true;
    const names = unsaved.map((t) => t.title).join(", ");
    return CustomDialog.confirm(`${names} ${unsaved.length === 1 ? "has" : "have"} unsaved changes that will be lost.`, "Discard unsaved changes?", true, "Discard");
  }, []);

  const handleReopenLastClosedTab = useCallback(() => {
    while (closedTabsHistoryRef.current.length > 0) {
      const lastPath = closedTabsHistoryRef.current.pop();
      if (lastPath && !openTabs.some((t) => cleanPath(t.path) === cleanPath(lastPath))) {
        void handleOpenFile(lastPath);
        return;
      }
    }
  }, [handleOpenFile, openTabs]);

  const handleCloseTab = useCallback(async (tabId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const normalized = cleanPath(tabId);
    const prev = openTabsRef.current;
    const closingIdx = prev.findIndex((t) => t.id === tabId || cleanPath(t.path) === normalized);
    if (closingIdx === -1) return;
    const closing = prev[closingIdx];
    if (!(await confirmDiscard([closing]))) return;

    if (closing.path && !closing.path.includes("://") && !closing.path.startsWith("extension:")) {
      closedTabsHistoryRef.current.push(closing.path);
    }

    tabHistoryRef.current = tabHistoryRef.current.filter((id) => id !== closing.id && id !== tabId && cleanPath(id) !== normalized);
    forwardHistoryRef.current = forwardHistoryRef.current.filter((id) => id !== closing.id && id !== tabId && cleanPath(id) !== normalized);

    const nextTabs = prev.filter((_, i) => i !== closingIdx);
    setOpenTabs((cur) => cur.filter((t) => t.id !== closing.id));
    // Closing the active tab focuses its right neighbour (or the new last tab).
    setActiveTabId((current) => {
      if (current !== closing.id) return current;
      return nextTabs.length ? nextTabs[Math.min(closingIdx, nextTabs.length - 1)].id : null;
    });
    if (nextTabs.length === 0) setIsSplit(false);
  }, [confirmDiscard]);

  const handleCloseAllTabs = useCallback(async () => {
    if (!(await confirmDiscard(openTabsRef.current))) return;
    setOpenTabs([]);
    setActiveTabId(null);
    setIsSplit(false);
    tabHistoryRef.current = [];
    forwardHistoryRef.current = [];
  }, [confirmDiscard]);

  const handleCloseOtherTabs = useCallback(async (keepTabId: string) => {
    const normalized = cleanPath(keepTabId);
    const isKept = (t: EditorTab) => t.id === keepTabId || cleanPath(t.path) === normalized;
    if (!(await confirmDiscard(openTabsRef.current.filter((t) => !isKept(t))))) return;
    setOpenTabs((prev) => prev.filter(isKept));
    setActiveTabId(keepTabId);
    tabHistoryRef.current = [keepTabId];
    forwardHistoryRef.current = [];
  }, [confirmDiscard]);

  const handleCloseSavedTabs = useCallback(() => {
    const remaining = openTabsRef.current.filter((t) => t.isDirty);
    setOpenTabs(remaining);
    setActiveTabId((cur) => (remaining.some((t) => t.id === cur) ? cur : remaining[0]?.id ?? null));
  }, []);

  const handleOpenExtension = useCallback((ext: any) => {
    const tabId = `extension:${ext.id}`;
    setOpenTabs((prev) => {
      const existing = prev.find((t) => t.id === tabId || t.path === tabId);
      if (existing) {
        return prev.map((t) => (t.id === tabId ? { ...t, extensionData: ext } : t));
      }
      const newTab: EditorTab = {
        id: tabId,
        path: tabId,
        title: `Extension: ${ext.displayName || ext.name}`,
        extensionData: ext,
      };
      return [...prev, newTab];
    });
    setActiveTabId(tabId);
  }, []);

  const handleOpenClaudeSession = useCallback((session: any) => {
    if (!session || !session.id) return;
    const tabId = `claude-code:${session.id}`;
    setOpenTabs((prev) => {
      const existing = prev.find((t) => t.id === tabId || t.path === tabId);
      if (existing) {
        return prev.map((t) => (t.id === tabId ? { ...t, claudeSessionData: session, title: session.title } : t));
      }
      const newTab: EditorTab = {
        id: tabId,
        path: tabId,
        title: session.title,
        claudeSessionData: session,
      };
      return [...prev, newTab];
    });
    setActiveTabId(tabId);
  }, []);

  useEffect(() => {
    const handleSessionOpen = (e: any) => {
      if (e.detail?.session) {
        handleOpenClaudeSession(e.detail.session);
      }
    };
    window.addEventListener("csotic:open-claude-session", handleSessionOpen);
    return () => window.removeEventListener("csotic:open-claude-session", handleSessionOpen);
  }, [handleOpenClaudeSession]);

  // Handle Command Palette actions
  const handleExecuteCommand = useCallback(async (commandId: string) => {
    switch (commandId) {
      case "file.new": {
        handleNewUntitledTab();
        break;
      }
      case "file.save": {
        if (activeTabId) await handleSaveTab(activeTabId);
        break;
      }
      case "workspace.open": {
        await handleOpenFolderDialog();
        break;
      }
      case "editor.split": {
        setIsSplit((s) => !s);
        break;
      }
      case "terminal.toggle": {
        setBottomDockVisible((v) => !v);
        break;
      }
      case "terminal.focus": {
        setBottomDockVisible(true);
        setActiveBottomTab("terminal");
        break;
      }
      case "runner.dev":
      case "runner.build": {
        const cmd = commandId === "runner.dev" ? "npm run dev" : "npm run build";
        window.dispatchEvent(new CustomEvent("csotic:open-terminal", { detail: { cmd, cwd: activeProject?.path } }));
        break;
      }
      case "runner.runActive": {
        runTask("run", activeTab?.path, activeProject?.path);
        break;
      }
      case "runner.buildActive": {
        runTask("build", activeTab?.path, activeProject?.path);
        break;
      }
      case "ai.chat": {
        setAiSlideVisible((v) => !v);
        break;
      }
      case "git.status":
      case "view.git": {
        setSidebarVisible(true);
        setSidebarView("git");
        break;
      }
      case "view.explorer": {
        setSidebarVisible(true);
        setSidebarView("explorer");
        break;
      }
      case "view.search": {
        setSidebarVisible(true);
        setSidebarView("search");
        break;
      }
      case "view.plugins": {
        setSidebarVisible(true);
        setSidebarView("plugins");
        break;
      }
      case "view.problems": {
        setBottomDockVisible(true);
        setActiveBottomTab("problems");
        break;
      }
      case "view.preview": {
        window.dispatchEvent(new CustomEvent("csotic:toggle-preview"));
        break;
      }
      case "app.settings": {
        setIsSettingsOpen(true);
        break;
      }
      case "view.fullscreen": {
        void getCurrentWindow().isFullscreen().then((isFs) => {
          void getCurrentWindow().setFullscreen(!isFs);
        });
        break;
      }
      case "editor.reopenClosedTab": {
        handleReopenLastClosedTab();
        break;
      }
      case "file.saveAs": {
        if (activeTabId) void handleSaveAsTab(activeTabId);
        break;
      }
      case "file.saveAll": {
        void handleSaveAll();
        break;
      }
      case "help.shortcuts": {
        setIsShortcutsOpen(true);
        break;
      }
      default:
        break;
    }
  }, [activeTabId, activeProject, activeTab, handleSaveTab, handleSaveAsTab, handleSaveAll, handleNewUntitledTab, handleOpenFolderDialog, handleReopenLastClosedTab]);

  // Handle selecting a model
  const handleSelectModel = useCallback(async (modelId: string) => {
    setActiveModel(modelId);
    setConversations((current) => current.map((conversation) => conversation.id === activeConversationId
      ? { ...conversation, activeModel: modelId, updatedAt: new Date().toISOString() }
      : conversation));
    try {
      await workspace.saveState({ active_model: modelId });
    } catch (e) {
      console.error("Model save failed:", e);
    }
  }, [activeConversationId]);

  const handleSelectBackgroundModel = useCallback(async (modelId: string) => {
    setBackgroundModel(modelId);
    try {
      await workspace.saveState({ background_model: modelId });
    } catch (e) {
      console.error("Background model save failed:", e);
    }
  }, []);

  // Handle sidebar view changes — decoupled from editor
  const handleViewChange = useCallback((view: string) => {
    if (view === "settings") {
      setIsSettingsOpen(true);
      return;
    }
    setSidebarView(view);
  }, []);

  const handleConversationTitleChange = useCallback((conversationId: number, firstRequest: string) => {
    const title = firstRequest.replace(/\s+/g, " ").trim().slice(0, 48);
    if (!title) return;
    setConversations((current) => current.map((conversation) => (
      conversation.id === conversationId && /^New Conversation|^Conversation \d+$/.test(conversation.title)
        ? { ...conversation, title }
        : conversation
    )));
  }, []);

  const handleSelectConversation = useCallback(async (conversationId: number) => {
    setActiveConversationId(conversationId);
    setAiSlideVisible(true); // Open AI slide when selecting a conversation
    const conversation = conversations.find((item) => item.id === conversationId);
    if (conversation?.activeModel) setActiveModel(conversation.activeModel);
  }, [conversations]);

  const handleDeleteConversation = useCallback((conversationId: number) => {
    try {
      const savedMessages = JSON.parse(localStorage.getItem("forge.conversation-messages") ?? "{}");
      delete savedMessages[conversationId];
      localStorage.setItem("forge.conversation-messages", JSON.stringify(savedMessages));
    } catch {
      // ignore
    }

    setConversations((current) => {
      let next = current.filter((conversation) => conversation.id !== conversationId);
      if (next.length === 0) {
        next = [newConversation(Date.now(), "Conversation 1")];
      }
      if (conversationId === activeConversationId) {
        setActiveConversationId(next[0].id);
      }
      return next;
    });
  }, [activeConversationId]);

  const handleDuplicateConversation = useCallback((conversationId: number) => {
    const source = conversations.find((conversation) => conversation.id === conversationId);
    if (!source) return;
    const id = Date.now();
    const copy = { ...source, id, title: `${source.title} copy`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), pinned: false };
    setConversations((current) => [...current, copy]);
    setActiveConversationId(id);
    setAiSlideVisible(true);
  }, [conversations]);

  const handleNewConversation = useCallback(() => {
    const id = Date.now();
    const count = conversations.length + 1;
    const conversation = newConversation(id, `Conversation ${count}`);
    setConversations((current) => [...current, conversation]);
    setActiveConversationId(id);
    setAiSlideVisible(true);
  }, [conversations.length]);

  const handleExportConversation = useCallback((conversationId: number) => {
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation) return;
    let messages: any[] = [];
    try {
      messages = JSON.parse(localStorage.getItem("forge.conversation-messages") ?? "{}")[conversationId] ?? [];
    } catch {
      messages = [];
    }
    const transcript = [`# ${conversation.title}`, "", `Created: ${conversation.createdAt}`, ...messages.map((message: { sender: string; text: string }) => `## ${message.sender === "user" ? "You" : "Csotic"}\n\n${message.text}`)].join("\n\n");
    const url = URL.createObjectURL(new Blob([transcript], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url; link.download = `${conversation.title.replace(/[^a-z0-9]+/gi, "-")}.md`;
    link.click(); URL.revokeObjectURL(url);
  }, [conversations]);

  /** Global keyboard shortcuts */
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // F1: Command Palette
    if (e.key === "F1") {
      e.preventDefault();
      setSearchInitialMode("commands");
      setIsSearchOpen(true);
      return;
    }

    // F11: Toggle Fullscreen
    if (e.key === "F11") {
      e.preventDefault();
      void getCurrentWindow().isFullscreen().then((isFs) => {
        void getCurrentWindow().setFullscreen(!isFs);
      });
      return;
    }

    // F5 / Ctrl+F5: Run active file
    if (e.key === "F5") {
      e.preventDefault();
      runTask("run", activeTab?.path, activeProject?.path);
      return;
    }

    // Alt+1 ... Alt+8 or Ctrl+1 ... Ctrl+8: Go to tab N; Alt+9 / Ctrl+9: Go to last tab
    if ((e.altKey || e.ctrlKey) && !e.shiftKey && !e.metaKey) {
      if (e.key >= "1" && e.key <= "8") {
        const targetIdx = parseInt(e.key, 10) - 1;
        if (openTabs[targetIdx]) {
          e.preventDefault();
          setActiveTabId(openTabs[targetIdx].id);
          return;
        }
      } else if (e.key === "9") {
        if (openTabs.length > 0) {
          e.preventDefault();
          setActiveTabId(openTabs[openTabs.length - 1].id);
          return;
        }
      }
    }

    const targetEl = e.target as HTMLElement | null;
    const isTextInput = targetEl && (targetEl.tagName === "INPUT" || targetEl.tagName === "TEXTAREA" || targetEl.isContentEditable);

    // Alt+ArrowLeft: Go back in tab history
    if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === "ArrowLeft") {
      if (isTextInput) return;
      while (tabHistoryRef.current.length > 1) {
        const cur = tabHistoryRef.current.pop()!;
        forwardHistoryRef.current.push(cur);
        const candidate = tabHistoryRef.current[tabHistoryRef.current.length - 1];
        if (openTabs.some((t) => t.id === candidate)) {
          e.preventDefault();
          isNavigatingHistoryRef.current = true;
          setActiveTabId(candidate);
          return;
        }
      }
    }

    // Alt+ArrowRight: Go forward in tab history
    if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === "ArrowRight") {
      if (isTextInput) return;
      while (forwardHistoryRef.current.length > 0) {
        const next = forwardHistoryRef.current.pop()!;
        if (openTabs.some((t) => t.id === next)) {
          e.preventDefault();
          tabHistoryRef.current.push(next);
          isNavigatingHistoryRef.current = true;
          setActiveTabId(next);
          return;
        }
      }
    }

    // Shift+Alt+0: Toggle split editor layout
    if (e.shiftKey && e.altKey && e.key === "0") {
      e.preventDefault();
      setIsSplit((s) => !s);
      return;
    }

    // Ctrl+Tab / Ctrl+PageDown: Next editor tab
    if (e.ctrlKey && !e.shiftKey && (e.key === "Tab" || e.key === "PageDown")) {
      e.preventDefault();
      if (openTabs.length > 1) {
        const curIdx = openTabs.findIndex((t) => t.id === activeTabId);
        const nextIdx = curIdx === -1 ? 0 : (curIdx + 1) % openTabs.length;
        setActiveTabId(openTabs[nextIdx].id);
      }
      return;
    }

    // Ctrl+Shift+Tab / Ctrl+PageUp: Previous editor tab
    if (e.ctrlKey && ((e.shiftKey && e.key === "Tab") || (!e.shiftKey && e.key === "PageUp"))) {
      e.preventDefault();
      if (openTabs.length > 1) {
        const curIdx = openTabs.findIndex((t) => t.id === activeTabId);
        const prevIdx = curIdx === -1 ? openTabs.length - 1 : (curIdx - 1 + openTabs.length) % openTabs.length;
        setActiveTabId(openTabs[prevIdx].id);
      }
      return;
    }

    // Ctrl+,: Open Settings
    if (e.ctrlKey && e.key === ",") {
      e.preventDefault();
      setIsSettingsOpen(true);
      return;
    }

    // Ctrl+Shift+E: Explorer
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "e") {
      e.preventDefault();
      setSidebarVisible(true);
      setSidebarView("explorer");
      return;
    }

    // Ctrl+Shift+F: Search panel
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      setSidebarVisible(true);
      setSidebarView("search");
      return;
    }

    // Ctrl+Shift+H: Search panel / Replace in files
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "h") {
      e.preventDefault();
      setSidebarVisible(true);
      setSidebarView("search");
      return;
    }

    // Ctrl+Shift+G: Source control
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "g") {
      e.preventDefault();
      setSidebarVisible(true);
      setSidebarView("git");
      return;
    }

    // Ctrl+Shift+X: Extensions
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "x") {
      e.preventDefault();
      setSidebarVisible(true);
      setSidebarView("plugins");
      return;
    }

    // Ctrl+Shift+B: Build active file/project
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "b") {
      e.preventDefault();
      runTask("build", activeTab?.path, activeProject?.path);
      return;
    }

    // Ctrl+Shift+T: Reopen last closed tab
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "t") {
      e.preventDefault();
      handleReopenLastClosedTab();
      return;
    }

    // Ctrl+Shift+M: Show Problems panel
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "m") {
      e.preventDefault();
      setBottomDockVisible(true);
      setActiveBottomTab("problems");
      return;
    }

    // Ctrl+Shift+U / Ctrl+Shift+D: Show Output / Terminal panel
    if (e.ctrlKey && e.shiftKey && (e.key.toLowerCase() === "u" || e.key.toLowerCase() === "d")) {
      e.preventDefault();
      setBottomDockVisible(true);
      setActiveBottomTab("terminal");
      return;
    }

    // Ctrl+Shift+V: Toggle Markdown / HTML Preview
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "v") {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("csotic:toggle-preview"));
      return;
    }

    // Ctrl+Shift+`: Open terminal and focus it
    if (e.ctrlKey && e.shiftKey && e.key === "`") {
      e.preventDefault();
      setBottomDockVisible(true);
      setActiveBottomTab("terminal");
      return;
    }

    // Ctrl+P / Ctrl+T: Quick Open File
    if (e.ctrlKey && !e.shiftKey && (e.key.toLowerCase() === "p" || e.key.toLowerCase() === "t")) {
      e.preventDefault();
      setSearchInitialMode("files");
      setIsSearchOpen(true);
      return;
    }
    // Ctrl+Shift+P / Ctrl+Shift+O: Command Palette / Symbol Search
    if (e.ctrlKey && e.shiftKey && (e.key.toLowerCase() === "p" || e.key.toLowerCase() === "o")) {
      e.preventDefault();
      setSearchInitialMode("commands");
      setIsSearchOpen(true);
      return;
    }
    // Ctrl+B: Toggle Explorer/Sidebar
    if (e.ctrlKey && e.key.toLowerCase() === "b" && !e.shiftKey) {
      e.preventDefault();
      setSidebarVisible((v) => !v);
      return;
    }
    // Ctrl+`: Toggle Terminal Bottom Dock
    if (e.ctrlKey && e.key === "`" && !e.shiftKey) {
      e.preventDefault();
      setBottomDockVisible((v) => !v);
      return;
    }
    // Ctrl+S: Save current active file
    if (e.ctrlKey && e.key.toLowerCase() === "s" && !e.shiftKey) {
      e.preventDefault();
      if (activeTabId) {
        void handleSaveTab(activeTabId);
      }
      return;
    }
    // Ctrl+Shift+S: Save As current active file
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (activeTabId) {
        void handleSaveAsTab(activeTabId);
      }
      return;
    }
    // Ctrl+O: Open File Dialog
    if (e.ctrlKey && e.key.toLowerCase() === "o" && !e.shiftKey) {
      e.preventDefault();
      void handleOpenFileDialog();
      return;
    }
    // Ctrl+W / Ctrl+F4: Close active tab
    if ((e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "w") || (e.ctrlKey && e.key === "F4")) {
      e.preventDefault();
      if (activeTabId) {
        void handleCloseTab(activeTabId);
      }
      return;
    }
    // Ctrl+\: Toggle Split Editor
    if (e.ctrlKey && e.key === "\\") {
      e.preventDefault();
      setIsSplit((s) => !s);
      return;
    }
    // Ctrl+L: Toggle Manual Coder Slide (AI Assistant Drawer)
    if (e.ctrlKey && e.key.toLowerCase() === "l" && !e.shiftKey) {
      e.preventDefault();
      setAiSlideVisible((v) => !v);
      return;
    }
    // Ctrl+J: Toggle AI Context Panel
    if (e.ctrlKey && e.key.toLowerCase() === "j" && !e.shiftKey) {
      e.preventDefault();
      setRightPanelVisible((v) => !v);
      return;
    }
    // Ctrl+N: New untitled tab (must check !e.shiftKey)
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      handleNewUntitledTab();
      return;
    }
  }, [activeTabId, activeTab, activeProject, openTabs, handleSaveTab, handleSaveAsTab, handleCloseTab, handleNewUntitledTab, handleOpenFileDialog, handleReopenLastClosedTab]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    // Only reveals the dock; the terminal panel itself runs `detail.cmd`.
    const handleOpenTerm = () => {
      setBottomDockVisible(true);
      setActiveBottomTab("terminal");
    };
    window.addEventListener("csotic:open-terminal", handleOpenTerm);
    return () => window.removeEventListener("csotic:open-terminal", handleOpenTerm);
  }, []);

  return (
    <div className="app-shell" style={{ display: "flex", flexDirection: "column", width: "100vw", height: "100vh", overflow: "hidden" }}>
      <TopBar
        activeProject={activeProject}
        activeFile={activeTab?.path || null}
        onToggleSidebar={() => setSidebarVisible((v) => !v)}
        onToggleRightPanel={() => setRightPanelVisible((v) => !v)}
        rightPanelVisible={rightPanelVisible}
        onToggleBottomDock={() => setBottomDockVisible((v) => !v)}
        onOpenTerminal={() => { setBottomDockVisible(true); setActiveBottomTab("terminal"); }}
        onOpenSearch={() => { setSearchInitialMode("files"); setIsSearchOpen(true); }}
        onOpenCommandPalette={() => { setSearchInitialMode("commands"); setIsSearchOpen(true); }}
        onOpenFolder={handleOpenFolderDialog}
        onOpenFile={handleOpenFileDialog}
        onSave={() => activeTabId && handleSaveTab(activeTabId)}
        onSaveAs={() => activeTabId && handleSaveAsTab(activeTabId)}
        onSaveAll={handleSaveAll}
        onCloseFile={() => activeTabId && handleCloseTab(activeTabId)}
        onCloseProject={handleCloseProject}
        onToggleSplit={() => setIsSplit((s) => !s)}
        isSplit={isSplit}
        activeModel={activeModel}
        modelsList={modelsList}
        onSelectModel={handleSelectModel}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onToggleAiSlide={() => setAiSlideVisible((v) => !v)}
        aiSlideVisible={aiSlideVisible}
        onNewFile={handleNewUntitledTab}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onOpenWelcomeTab={handleOpenWelcomeTab}
        onOpenShortcuts={() => setIsShortcutsOpen(true)}
      />

      <div style={{ flex: 1, display: "flex", width: "100%", height: "calc(100vh - 44px - 24px)", overflow: "hidden" }}>
        <Sidebar
          visible={sidebarVisible}
          width={sidebarWidth}
          activeView={sidebarView}
          onViewChange={handleViewChange}
          activeProject={activeProject}
          recentProjects={recentProjects}
          onOpenProject={handleOpenProject}
          onOpenFile={handleOpenFile}
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelectConversation={handleSelectConversation}
          onRenameConversation={(id, title) => setConversations((current) => current.map((conversation) => conversation.id === id ? { ...conversation, title, updatedAt: new Date().toISOString() } : conversation))}
          onDeleteConversation={handleDeleteConversation}
          onDuplicateConversation={handleDuplicateConversation}
          onTogglePinConversation={(id) => setConversations((current) => current.map((conversation) => conversation.id === id ? { ...conversation, pinned: !conversation.pinned, updatedAt: new Date().toISOString() } : conversation))}
          onToggleArchiveConversation={(id) => setConversations((current) => current.map((conversation) => conversation.id === id ? { ...conversation, archived: !conversation.archived, updatedAt: new Date().toISOString() } : conversation))}
          onExportConversation={handleExportConversation}
          onNewConversation={() => {
            const newId = Date.now();
            setConversations((prev) => [...prev, newConversation(newId, `Conversation ${prev.length + 1}`)]);
            setActiveConversationId(newId);
            setAiSlideVisible(true);
          }}
          openTabs={openTabs}
          activeTabId={activeTabId}
          onCloseTab={handleCloseTab}
          onSelectTab={(id) => { setActiveTabId(id); }}
          activeModel={activeModel}
          onOpenGraph={handleOpenBrainGraph}
          onOpenExtension={handleOpenExtension}
          theme={theme}
          session={authSession}
          onOpenAuthModal={() => setIsAuthModalOpen(true)}
          onOpenSettings={() => {
            setSettingsInitialTab("accounts");
            setIsSettingsOpen(true);
          }}
          onLogout={handleLogout}
        />

        {sidebarVisible && (
          <div
            className={`panel-resizer ${isDraggingSidebar ? "is-dragging" : ""}`}
            onMouseDown={handleSidebarResizeStart}
            onDoubleClick={() => {
              setSidebarWidth(280);
              localStorage.setItem("forge.sidebar_width", "280");
            }}
            title="Drag to resize Explorer / Sidebar · Double click to reset width"
          />
        )}

        <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
          <MainWorkspace
            activeView="editor"
            onViewChange={handleViewChange}
            activeProject={activeProject}
            activeModel={activeModel}
            modelsList={modelsList}
            onSelectModel={handleSelectModel}
            onOpenSettings={() => {
              setSettingsInitialTab("keys");
              setIsSettingsOpen(true);
            }}
            activeFile={activeTab?.path || null}
            openTabs={openTabs}
            activeTabId={activeTabId}
            onSelectTab={(id) => setActiveTabId(id)}
            onCloseTab={handleCloseTab}
            onCloseOthers={handleCloseOtherTabs}
            onCloseAll={handleCloseAllTabs}
            onCloseSaved={handleCloseSavedTabs}
            onTabContentChange={handleTabContentChange}
            onSaveTab={handleSaveTab}
            onSaveAsTab={handleSaveAsTab}
            isSplit={isSplit}
            onToggleSplit={() => setIsSplit((s) => !s)}
            onOpenProject={handleOpenProject}
            conversationId={activeConversationId}
            onConversationTitleChange={handleConversationTitleChange}
            permissionProfile={conversations.find((c) => c.id === activeConversationId)?.permissionProfile ?? "full_automation"}
            attachedProjectPaths={conversations.find((c) => c.id === activeConversationId)?.projectPaths ?? []}
            onDetachProject={(path) => {
              setConversations((current) => current.map((conversation) => conversation.id === activeConversationId
                ? { ...conversation, projectPaths: conversation.projectPaths.filter((item) => item !== path), activeProjectPath: conversation.activeProjectPath === path ? undefined : conversation.activeProjectPath, updatedAt: new Date().toISOString() }
                : conversation));
            }}
            onPermissionProfileChange={(permissionProfile) => setConversations((current) => current.map((conversation) => conversation.id === activeConversationId ? { ...conversation, permissionProfile, updatedAt: new Date().toISOString() } : conversation))}
            currentDiff={currentDiff}
            setCurrentDiff={setCurrentDiff}
            activeRightTab={activeRightTab}
            setActiveRightTab={setActiveRightTab}
            onOpenSearch={() => { setSearchInitialMode("files"); setIsSearchOpen(true); }}
            aiSlideVisible={aiSlideVisible}
            onToggleAiSlide={() => setAiSlideVisible((v) => !v)}
            conversations={conversations.map((c) => ({ id: c.id, title: c.title }))}
            onSelectConversation={handleSelectConversation}
            onNewConversation={handleNewConversation}
            onDeleteConversation={handleDeleteConversation}
            onOpenFile={handleOpenFile}
            theme={theme}
            recentProjects={recentProjects}
            onOpenFolder={handleOpenFolderDialog}
            onRevealInExplorer={handleRevealInExplorer}
            onOpenTerminal={() => { setBottomDockVisible(true); setActiveBottomTab("terminal"); }}
            onNewFile={handleNewUntitledTab}
            onOpenFilePicker={handleOpenFileDialog}
            onCursorChangeGlobal={(line, col) => setGlobalCursorPos({ line, col })}
          />

          <BottomDock
            visible={bottomDockVisible}
            onToggleVisibility={() => setBottomDockVisible(false)}
            activeTab={activeBottomTab}
            onTabChange={setActiveBottomTab}
            activeProject={activeProject}
            onOpenFile={handleOpenFile}
            theme={theme}
          />
        </div>

        {rightPanelVisible && (
          <div
            className={`panel-resizer ${isDraggingRightPanel ? "is-dragging" : ""}`}
            onMouseDown={handleRightPanelResizeStart}
            onDoubleClick={() => {
              setRightPanelWidth(340);
              localStorage.setItem("forge.right_panel_width", "340");
            }}
            title="Drag to resize Context Panel · Double click to reset width"
          />
        )}

        {rightPanelVisible && (
          <Suspense fallback={null}>
            <RightPanel
              visible={rightPanelVisible}
              onClose={() => setRightPanelVisible(false)}
              width={rightPanelWidth}
              onFileClick={handleOpenFile}
              activeProject={activeProject}
              theme={theme}
            />
          </Suspense>
        )}
      </div>

      <StatusBar
        line={globalCursorPos.line}
        col={globalCursorPos.col}
        language={activeTab?.path ? getLanguageFromPath(activeTab.path) : "PLAINTEXT"}
        onToggleProblems={() => {
          setBottomDockVisible(true);
          setActiveBottomTab("problems");
        }}
        onToggleTerminal={() => {
          setBottomDockVisible(true);
          setActiveBottomTab("terminal");
        }}
        theme={theme}
      />

      {isSearchOpen && (
        <Suspense fallback={null}>
          <SearchModal
            isOpen={isSearchOpen}
            onClose={() => setIsSearchOpen(false)}
            onOpenFile={handleOpenFile}
            onExecuteCommand={handleExecuteCommand}
            initialMode={searchInitialMode}
          />
        </Suspense>
      )}

      {isShortcutsOpen && (
        <Suspense fallback={null}>
          <ShortcutsModal
            isOpen={isShortcutsOpen}
            onClose={() => setIsShortcutsOpen(false)}
          />
        </Suspense>
      )}

      {isSettingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            activeModel={activeModel}
            backgroundModel={backgroundModel}
            modelsList={modelsList}
            onSelectModel={handleSelectModel}
            onSelectBackgroundModel={handleSelectBackgroundModel}
            onRefreshModels={refreshModels}
            theme={theme}
            onToggleTheme={handleToggleTheme}
            session={authSession}
            onOpenAuthModal={() => {
              setIsSettingsOpen(false);
              setIsAuthModalOpen(true);
            }}
            onLogout={handleLogout}
            initialTab={settingsInitialTab}
          />
        </Suspense>
      )}

      {isAuthModalOpen && (
        <Suspense fallback={null}>
          <AuthModal
            isOpen={isAuthModalOpen}
            onClose={() => setIsAuthModalOpen(false)}
            session={authSession}
            onSessionChange={setAuthSession}
          />
        </Suspense>
      )}
    </div>
  );
}
