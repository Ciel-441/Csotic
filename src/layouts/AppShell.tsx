import { useState, useCallback, useEffect, useRef } from "react";
import { TopBar } from "../components/TopBar";
import { Sidebar } from "../components/Sidebar";
import { MainWorkspace, FileDiff } from "../components/MainWorkspace";
import { RightPanel } from "../components/RightPanel";
import { BottomDock } from "../components/BottomDock";
import { CustomDialog } from "../components/GlobalDialog";
import { workspace, models, filesystem, terminal } from "../services/ipc";
import { ProjectInfo, ModelMetadata, EditorTab } from "../types/ipc";
import { pluginManager } from "../plugins/PluginManager";
import { SearchModal } from "../components/SearchModal";
import { SettingsModal } from "../components/SettingsModal";

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
  const [bottomDockVisible, setBottomDockVisible] = useState(true);
  const [activeBottomTab, setActiveBottomTab] = useState<string>("terminal");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchInitialMode, setSearchInitialMode] = useState<"files" | "commands">("files");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
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

  // ── Decoupled View States ──
  // sidebarView: controls ONLY the left sidebar panel
  const [sidebarView, setSidebarView] = useState<string>("explorer");
  // aiSlideVisible: controls the Manual Coder Slide (AI Assistant Drawer) on the right of the editor
  const [aiSlideVisible, setAiSlideVisible] = useState(false);

  // Multi-Tab Editor States
  const [openTabs, setOpenTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
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

  // Refresh recent projects from database
  const refreshRecentProjects = useCallback(async () => {
    const res = await workspace.getRecentProjects();
    const list = Array.isArray(res.data) ? res.data : (res.data as any)?.projects;
    if (res.success && Array.isArray(list)) {
      setRecentProjects(list as ProjectInfo[]);
    }
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

  // Handle opening a project folder
  const handleOpenProject = useCallback(async (path: string, conversationId = activeConversationId) => {
    try {
      const res = await workspace.openProject(path);
      if (res.success && res.data) {
        const state = res.data as any;
        setActiveProject(state.active_project);
        setOpenTabs([]);
        setActiveTabId(null);
        setConversations((current) => current.map((conversation) => conversation.id === conversationId
          ? { ...conversation, activeProjectPath: state.active_project.path, projectPaths: Array.from(new Set([...conversation.projectPaths, state.active_project.path])), updatedAt: new Date().toISOString() }
          : conversation));
        await refreshRecentProjects();
      } else {
        await CustomDialog.alert(`Failed to open project: ${res.error?.message || "Unknown error"}`);
      }
    } catch (e) {
      await CustomDialog.alert(`IPC Error opening project: ${e}`);
    }
  }, [activeConversationId, refreshRecentProjects]);

  const handleOpenFolderDialog = useCallback(async () => {
    const res = await filesystem.selectFolder();
    if (res.success && res.data && (res.data as any).path) {
      await handleOpenProject((res.data as any).path);
    }
  }, [handleOpenProject]);

  // Handle opening a file in Multi-Tab Editor
  const cleanPath = (p: string) => {
    return p.replace(/^\\\\\?\\/, "").replace(/^\/\/\?\//, "").replace(/\\/g, "/");
  };

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

    // Resolve relative wikilinks (e.g. "architecture.md" or "tasks") to full project path
    if (activeProject && !normalized.includes(":") && !normalized.startsWith("/")) {
      const brainCandidate = `${cleanPath(activeProject.path)}/.forge/brain/${normalized}${normalized.endsWith(".md") ? "" : ".md"}`;
      const projectCandidate = `${cleanPath(activeProject.path)}/${normalized}`;
      
      const checkBrain = await filesystem.readFile(brainCandidate);
      if (checkBrain.success) {
        normalized = brainCandidate;
      } else {
        const checkProject = await filesystem.readFile(projectCandidate);
        if (checkProject.success) {
          normalized = projectCandidate;
        }
      }
    }

    const fileName = normalized.split("/").pop() || "untitled";

    // Read content from disk
    const readRes = await filesystem.readFile(normalized);
    const content = readRes.success && readRes.data ? ((readRes.data as any).content || "") : "";

    setOpenTabs((prev) => {
      // Find existing tab with same canonical path or relative suffix
      const existingIdx = prev.findIndex((t) => {
        const tNorm = cleanPath(t.path);
        return t.id === normalized || t.path === normalized || tNorm === normalized || 
               (tNorm.length > 0 && normalized.length > 0 && (tNorm.endsWith("/" + normalized) || normalized.endsWith("/" + tNorm)));
      });

      if (existingIdx !== -1) {
        // Tab already open! Update its path/id to canonical and refresh content if read, no duplicate!
        return prev.map((t, i) => i === existingIdx ? { ...t, id: normalized, path: normalized, content: content || t.content } : t);
      }

      const newTab: EditorTab = {
        id: normalized,
        path: normalized,
        title: fileName,
        content,
        isDirty: false,
      };
      return [...prev, newTab];
    });

    setActiveTabId(normalized);
  }, [activeProject, handleOpenBrainGraph]);

  // Create instant untitled tab (Ctrl+N)
  const handleNewUntitledTab = useCallback(() => {
    const title = `Untitled-${untitledCounterRef.current++}`;
    const id = `untitled://${Date.now()}`;
    const newTab: EditorTab = {
      id,
      path: id,
      title,
      content: "",
      isDirty: true,
    };
    setOpenTabs((prev) => [...prev, newTab]);
    setActiveTabId(id);
  }, []);

  // Debounced auto-save timer ref to ensure files are written to disk for compilation
  const autoSaveTimerRef = useRef<Record<string, number>>({});

  const handleTabContentChange = useCallback((tabId: string, newContent: string, isDirty = true) => {
    const normalized = cleanPath(tabId);
    setOpenTabs((prev) => prev.map((t) => {
      const tNorm = cleanPath(t.path);
      const isMatch = t.id === tabId || t.path === tabId || t.id === normalized || tNorm === normalized || tNorm.endsWith(normalized) || normalized.endsWith(tNorm);
      return isMatch ? { ...t, content: newContent, isDirty } : t;
    }));

    // Auto-save to disk for real file paths so compilers (gcc, salivo, cargo) always see latest code
    if (!normalized.startsWith("untitled://") && normalized.length > 0) {
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
      }
    }
  }, [openTabs]);

  const handleCloseTab = useCallback((tabId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const normalized = cleanPath(tabId);

    setOpenTabs((prev) => {
      const closingIdx = prev.findIndex((t) => {
        const tNorm = cleanPath(t.path);
        return t.id === tabId || t.path === tabId || t.id === normalized || tNorm === normalized ||
               tNorm.endsWith("/" + normalized) || normalized.endsWith("/" + tNorm);
      });

      if (closingIdx === -1) return prev;

      const nextTabs = prev.filter((_, i) => i !== closingIdx);

      // If activeTab is being closed, switch to adjacent tab rather than null
      setActiveTabId((current) => {
        const isCurrentClosing = current === tabId || cleanPath(current || "") === normalized ||
          (current && prev[closingIdx] && (current === prev[closingIdx].id || cleanPath(current) === cleanPath(prev[closingIdx].path)));

        if (isCurrentClosing) {
          if (nextTabs.length === 0) {
            setIsSplit(false);
            return null;
          }
          const nextIdx = Math.max(0, Math.min(closingIdx, nextTabs.length - 1));
          return nextTabs[nextIdx].id;
        }
        return current;
      });

      return nextTabs;
    });
  }, []);

  const handleCloseAllTabs = useCallback(() => {
    setOpenTabs([]);
    setActiveTabId(null);
  }, []);

  const handleCloseOtherTabs = useCallback((keepTabId: string) => {
    const normalized = cleanPath(keepTabId);
    setOpenTabs((prev) => prev.filter((t) => t.id === keepTabId || cleanPath(t.path) === normalized));
    setActiveTabId(keepTabId);
  }, []);

  const handleCloseSavedTabs = useCallback(() => {
    setOpenTabs((prev) => prev.filter((t) => t.isDirty));
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
      case "runner.dev": {
        setBottomDockVisible(true);
        setActiveBottomTab("terminal");
        if (activeProject) {
          void terminal.executeCommand(activeProject.path, "npm run dev", true);
        }
        break;
      }
      case "runner.build": {
        setBottomDockVisible(true);
        setActiveBottomTab("terminal");
        if (activeProject) {
          void terminal.executeCommand(activeProject.path, "npm run build", true);
        }
        break;
      }
      case "ai.chat": {
        setAiSlideVisible((v) => !v);
        break;
      }
      case "git.status": {
        setSidebarView("git");
        break;
      }
      default:
        break;
    }
  }, [activeTabId, activeProject, handleSaveTab, handleNewUntitledTab, handleOpenFolderDialog]);

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
    const messages = JSON.parse(localStorage.getItem("forge.conversation-messages") ?? "{}")[conversationId] ?? [];
    const transcript = [`# ${conversation.title}`, "", `Created: ${conversation.createdAt}`, ...messages.map((message: { sender: string; text: string }) => `## ${message.sender === "user" ? "You" : "Csotic"}\n\n${message.text}`)].join("\n\n");
    const url = URL.createObjectURL(new Blob([transcript], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url; link.download = `${conversation.title.replace(/[^a-z0-9]+/gi, "-")}.md`;
    link.click(); URL.revokeObjectURL(url);
  }, [conversations]);

  /** Global keyboard shortcuts */
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ctrl+P: Quick Open File
    if (e.ctrlKey && e.key.toLowerCase() === "p" && !e.shiftKey) {
      e.preventDefault();
      setSearchInitialMode("files");
      setIsSearchOpen(true);
    }
    // Ctrl+Shift+P: Command Palette
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      setSearchInitialMode("commands");
      setIsSearchOpen(true);
    }
    // Ctrl+B: Toggle Explorer/Sidebar
    if (e.ctrlKey && e.key.toLowerCase() === "b") {
      e.preventDefault();
      setSidebarVisible((v) => !v);
    }
    // Ctrl+`: Toggle Terminal Bottom Dock
    if (e.ctrlKey && e.key === "`") {
      e.preventDefault();
      setBottomDockVisible((v) => !v);
    }
    // Ctrl+S: Save current active file
    if (e.ctrlKey && e.key.toLowerCase() === "s" && !e.shiftKey) {
      e.preventDefault();
      if (activeTabId) {
        void handleSaveTab(activeTabId);
      }
    }
    // Ctrl+Shift+S: Save As current active file
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (activeTabId) {
        void handleSaveAsTab(activeTabId);
      }
    }
    // Ctrl+O: Open File Dialog
    if (e.ctrlKey && e.key.toLowerCase() === "o" && !e.shiftKey) {
      e.preventDefault();
      void handleOpenFileDialog();
    }
    // Ctrl+W: Close active tab
    if (e.ctrlKey && e.key.toLowerCase() === "w") {
      e.preventDefault();
      if (activeTabId) {
        void handleCloseTab(activeTabId);
      }
    }
    // Ctrl+\: Toggle Split Editor
    if (e.ctrlKey && e.key === "\\") {
      e.preventDefault();
      setIsSplit((s) => !s);
    }
    // Ctrl+L: Toggle Manual Coder Slide (AI Assistant Drawer)
    if (e.ctrlKey && e.key.toLowerCase() === "l") {
      e.preventDefault();
      setAiSlideVisible((v) => !v);
    }
    // Ctrl+N: New untitled tab
    if (e.ctrlKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      handleNewUntitledTab();
    }
  }, [activeTabId, handleSaveTab, handleSaveAsTab, handleCloseTab, handleNewUntitledTab, handleOpenFileDialog]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const activeTab = openTabs.find((t) => t.id === activeTabId);

  return (
    <div className="app-shell" style={{ display: "flex", flexDirection: "column", width: "100vw", height: "100vh", overflow: "hidden" }}>
      <TopBar
        activeProject={activeProject}
        activeFile={activeTab?.path || null}
        onToggleSidebar={() => setSidebarVisible((v) => !v)}
        onToggleRightPanel={() => setRightPanelVisible((v) => !v)}
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
      />

      <div style={{ flex: 1, display: "flex", width: "100%", height: "calc(100vh - 44px)", overflow: "hidden" }}>
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
          />

          <BottomDock
            visible={bottomDockVisible}
            onToggleVisibility={() => setBottomDockVisible(false)}
            activeTab={activeBottomTab}
            onTabChange={setActiveBottomTab}
            activeProject={activeProject}
            onOpenFile={handleOpenFile}
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

        <RightPanel
          visible={rightPanelVisible}
          width={rightPanelWidth}
          onFileClick={handleOpenFile}
          activeProject={activeProject}
        />
      </div>

      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onOpenFile={handleOpenFile}
        onExecuteCommand={handleExecuteCommand}
        initialMode={searchInitialMode}
      />

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
      />
    </div>
  );
}
