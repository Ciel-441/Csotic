/**
 * IPC Client Service
 * Per Chapter 3 §IPC Layer — The only bridge between the React UI and Rust backend.
 * Frontend communicates ONLY through typed IPC commands.
 */

import { invoke } from "@tauri-apps/api/core";
import { emit } from "./events";
import type { IpcResponse } from "../types/ipc";

/**
 * Check if running inside the native Tauri runtime with active IPC bridge.
 */
export const isTauri =
  typeof window !== "undefined" &&
  Boolean((window as any).__TAURI_INTERNALS__?.invoke);

/** In-memory directory handle or uploaded files when running in web browser preview */
let activeBrowserDirHandle: any = null;
const browserUploadedFiles: Map<string, { name: string; path: string; is_dir: boolean; content?: string }> = new Map();

/**
 * Open native OS directory picker using modern File System Access API
 * or standard <input type="file" webkitdirectory> fallback.
 * Triggers the actual Windows File Explorer / OS file manager folder picker.
 */
async function pickFolderInBrowser(): Promise<{ path: string; name: string } | null> {
  // 1. Try modern File System Access API (supported in Chrome/Edge)
  if (typeof window !== "undefined" && typeof (window as any).showDirectoryPicker === "function") {
    try {
      const dirHandle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
      if (dirHandle) {
        activeBrowserDirHandle = dirHandle;
        return {
          path: dirHandle.name,
          name: dirHandle.name,
        };
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return null;
      }
      console.warn("showDirectoryPicker fallback to input element:", err);
    }
  }

  // 2. Universal input[type=file][webkitdirectory] fallback (opens real Windows File Explorer)
  return new Promise((resolve) => {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.webkitdirectory = true;
      (input as any).directory = true;
      input.style.position = "fixed";
      input.style.top = "-9999px";
      input.style.left = "-9999px";
      input.style.opacity = "0";
      document.body.appendChild(input);

      let resolved = false;

      input.onchange = async () => {
        if (resolved) return;
        resolved = true;
        const files = input.files;
        if (files && files.length > 0) {
          browserUploadedFiles.clear();
          let rootName = "project";
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const relPath = file.webkitRelativePath || file.name;
            const parts = relPath.split("/");
            rootName = parts[0] || rootName;
            const content = await file.text().catch(() => "");
            browserUploadedFiles.set(relPath, {
              name: file.name,
              path: relPath,
              is_dir: false,
              content,
            });
          }
          if (document.body.contains(input)) document.body.removeChild(input);
          resolve({
            path: rootName,
            name: rootName,
          });
        } else {
          if (document.body.contains(input)) document.body.removeChild(input);
          resolve(null);
        }
      };

      input.oncancel = () => {
        if (resolved) return;
        resolved = true;
        if (document.body.contains(input)) document.body.removeChild(input);
        resolve(null);
      };

      const handleFocus = () => {
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            if (document.body.contains(input)) document.body.removeChild(input);
            resolve(null);
          }
        }, 800);
      };
      window.addEventListener("focus", handleFocus, { once: true });

      input.click();
    } catch {
      resolve(null);
    }
  });
}

/**
 * Open native OS file picker using modern File System Access API
 * or standard <input type="file"> fallback.
 * Triggers the actual Windows File Explorer / OS file manager file picker.
 */
async function pickFileInBrowser(): Promise<{ path: string; name: string; content?: string } | null> {
  if (typeof window !== "undefined" && typeof (window as any).showOpenFilePicker === "function") {
    try {
      const [fileHandle] = await (window as any).showOpenFilePicker();
      if (fileHandle) {
        const file = await fileHandle.getFile();
        const content = await file.text();
        return {
          path: file.name,
          name: file.name,
          content,
        };
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return null;
      }
      console.warn("showOpenFilePicker fallback to input element:", err);
    }
  }

  return new Promise((resolve) => {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.style.position = "fixed";
      input.style.top = "-9999px";
      input.style.left = "-9999px";
      input.style.opacity = "0";
      document.body.appendChild(input);

      let resolved = false;

      input.onchange = async () => {
        if (resolved) return;
        resolved = true;
        const file = input.files?.[0];
        if (file) {
          const content = await file.text().catch(() => "");
          if (document.body.contains(input)) document.body.removeChild(input);
          resolve({
            path: file.name,
            name: file.name,
            content,
          });
        } else {
          if (document.body.contains(input)) document.body.removeChild(input);
          resolve(null);
        }
      };

      input.oncancel = () => {
        if (resolved) return;
        resolved = true;
        if (document.body.contains(input)) document.body.removeChild(input);
        resolve(null);
      };

      const handleFocus = () => {
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            if (document.body.contains(input)) document.body.removeChild(input);
            resolve(null);
          }
        }, 800);
      };
      window.addEventListener("focus", handleFocus, { once: true });

      input.click();
    } catch {
      resolve(null);
    }
  });
}

/**
 * In-memory / localStorage fallback when running in a standard web browser (npm run dev).
 * Allows full UI testing of extensions, workspaces, and settings without crashing.
 */
async function handleBrowserIpc(
  service: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<IpcResponse> {
  if (service === "plugins") {
    if (action === "install_extension") {
      try {
        const id = (payload.id as string) || "unknown";
        const raw = localStorage.getItem("csotic_installed_extensions") || "[]";
        let list: any[] = [];
        try {
          list = JSON.parse(raw);
          if (!Array.isArray(list)) list = [];
        } catch {
          list = [];
        }
        const existingIdx = list.findIndex((x) => x.id === id);
        const item = {
          ...payload,
          installed: true,
          enabled: true,
          installedAt: Date.now(),
        };
        if (existingIdx >= 0) {
          list[existingIdx] = item;
        } else {
          list.unshift(item);
        }
        localStorage.setItem("csotic_installed_extensions", JSON.stringify(list));
        return {
          success: true,
          data: { status: "installed", id },
          duration_ms: 15,
        };
      } catch (err: any) {
        return {
          success: false,
          data: null,
          error: { code: "Filesystem", message: err?.message || "Failed to persist extension" },
          duration_ms: 0,
        };
      }
    }

    if (action === "uninstall_extension") {
      try {
        const id = (payload.id as string) || "";
        const raw = localStorage.getItem("csotic_installed_extensions") || "[]";
        let list: any[] = [];
        try {
          list = JSON.parse(raw);
          if (!Array.isArray(list)) list = [];
        } catch {
          list = [];
        }
        list = list.filter((x) => x.id !== id);
        localStorage.setItem("csotic_installed_extensions", JSON.stringify(list));
        return {
          success: true,
          data: { status: "uninstalled", id },
          duration_ms: 10,
        };
      } catch (err: any) {
        return {
          success: false,
          data: null,
          error: { code: "Filesystem", message: err?.message || "Failed to uninstall extension" },
          duration_ms: 0,
        };
      }
    }

    if (action === "get_installed_extensions") {
      try {
        const raw = localStorage.getItem("csotic_installed_extensions") || "[]";
        let list: any[] = [];
        try {
          list = JSON.parse(raw);
          if (!Array.isArray(list)) list = [];
        } catch {
          list = [];
        }
        return {
          success: true,
          data: { extensions: list },
          duration_ms: 5,
        };
      } catch {
        return {
          success: true,
          data: { extensions: [] },
          duration_ms: 0,
        };
      }
    }

    if (action === "get_plugins") {
      return { success: true, data: { plugins: [] }, duration_ms: 5 };
    }

    if (action === "is_workspace_trusted" || action === "trust_workspace") {
      return { success: true, data: { trusted: true }, duration_ms: 5 };
    }

    if (action === "untrust_workspace") {
      return { success: true, data: { trusted: false }, duration_ms: 5 };
    }
  }

  if (service === "workspace") {
    if (action === "get_state") {
      try {
        const raw = localStorage.getItem("csotic_workspace_state");
        return { success: true, data: raw ? JSON.parse(raw) : null, duration_ms: 5 };
      } catch {
        return { success: true, data: null, duration_ms: 0 };
      }
    }
    if (action === "save_state") {
      try {
        localStorage.setItem("csotic_workspace_state", JSON.stringify(payload));
        return { success: true, data: { saved: true }, duration_ms: 5 };
      } catch {
        return { success: true, data: { saved: false }, duration_ms: 0 };
      }
    }
    if (action === "get_recent_projects") {
      try {
        const raw = localStorage.getItem("csotic_recent_projects") || "[]";
        return { success: true, data: JSON.parse(raw), duration_ms: 5 };
      } catch {
        return { success: true, data: [], duration_ms: 0 };
      }
    }
    if (action === "open_project") {
      const p = (payload.path as string) || "";
      const name = p.split(/[/\\]/).filter(Boolean).pop() || "project";
      const project = { name, path: p };
      try {
        const raw = localStorage.getItem("csotic_recent_projects") || "[]";
        let recent: any[] = JSON.parse(raw);
        if (!Array.isArray(recent)) recent = [];
        recent = [project, ...recent.filter((r) => r.path !== p)].slice(0, 10);
        localStorage.setItem("csotic_recent_projects", JSON.stringify(recent));
        localStorage.setItem("csotic_active_project", JSON.stringify(project));
      } catch {
        // ignore
      }
      return { 
        success: true, 
        data: { 
          active_project: project,
          name, 
          path: p,
          active_project_id: "project_" + name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
          open_files: [],
          recent_projects: [],
          layout: {}
        }, 
        duration_ms: 10 
      };
    }
    if (action === "clear_active_project") {
      try {
        localStorage.removeItem("csotic_active_project");
      } catch {
        // ignore
      }
      return { success: true, data: true, duration_ms: 5 };
    }
    if (action === "get_layout" || action === "update_layout") {
      return { success: true, data: {}, duration_ms: 5 };
    }
  }

  if (service === "filesystem") {
    if (action === "read_dir") {
      const p = ((payload.path as string) || "").replace(/\\/g, "/").replace(/\/$/, "");
      
      if (activeBrowserDirHandle) {
        try {
          const rootName = activeBrowserDirHandle.name;
          let currentHandle = activeBrowserDirHandle;
          const relParts = p.startsWith(rootName) 
            ? p.slice(rootName.length).split("/").filter(Boolean)
            : p.split("/").filter(Boolean);
          
          let canTraverse = true;
          for (const part of relParts) {
            try {
              currentHandle = await currentHandle.getDirectoryHandle(part);
            } catch {
              canTraverse = false;
              break;
            }
          }

          if (canTraverse) {
            const entries: { name: string; path: string; is_dir: boolean }[] = [];
            for await (const [entryName, entryHandle] of currentHandle.entries()) {
              entries.push({
                name: entryName,
                path: p ? `${p}/${entryName}` : `${rootName}/${entryName}`,
                is_dir: entryHandle.kind === "directory",
              });
            }
            entries.sort((a, b) => {
              if (a.is_dir === b.is_dir) return a.name.localeCompare(b.name);
              return a.is_dir ? -1 : 1;
            });
            return { success: true, data: { entries }, duration_ms: 10 };
          }
        } catch (e) {
          console.warn("Could not read directory from handle:", e);
        }
      }

      if (browserUploadedFiles.size > 0) {
        const entriesMap = new Map<string, { name: string; path: string; is_dir: boolean }>();
        for (const [filePath] of browserUploadedFiles.entries()) {
          const prefix = p ? p + "/" : "";
          if (filePath.startsWith(prefix)) {
            const remainder = filePath.slice(prefix.length);
            const directName = remainder.split("/")[0];
            const isDir = remainder.includes("/");
            const fullEntryPath = p ? `${p}/${directName}` : directName;
            if (!entriesMap.has(directName)) {
              entriesMap.set(directName, {
                name: directName,
                path: fullEntryPath,
                is_dir: isDir,
              });
            }
          }
        }
        if (entriesMap.size > 0) {
          const entries = Array.from(entriesMap.values()).sort((a, b) => {
            if (a.is_dir === b.is_dir) return a.name.localeCompare(b.name);
            return a.is_dir ? -1 : 1;
          });
          return { success: true, data: { entries }, duration_ms: 10 };
        }
      }

      if (p.endsWith("/src/components") || p.endsWith("\\src\\components")) {
        return {
          success: true,
          data: {
            entries: [
              { name: "TopBar.tsx", path: `${p}/TopBar.tsx`, is_dir: false },
              { name: "Sidebar.tsx", path: `${p}/Sidebar.tsx`, is_dir: false },
              { name: "ExtensionsPanel.tsx", path: `${p}/ExtensionsPanel.tsx`, is_dir: false },
              { name: "ExtensionDetailView.tsx", path: `${p}/ExtensionDetailView.tsx`, is_dir: false },
              { name: "GlobalDialog.tsx", path: `${p}/GlobalDialog.tsx`, is_dir: false },
            ]
          },
          duration_ms: 5,
        };
      }

      if (p.endsWith("/src") || p.endsWith("\\src")) {
        return {
          success: true,
          data: {
            entries: [
              { name: "components", path: `${p}/components`, is_dir: true },
              { name: "layouts", path: `${p}/layouts`, is_dir: true },
              { name: "services", path: `${p}/services`, is_dir: true },
              { name: "App.tsx", path: `${p}/App.tsx`, is_dir: false },
              { name: "main.tsx", path: `${p}/main.tsx`, is_dir: false },
              { name: "index.css", path: `${p}/index.css`, is_dir: false },
            ]
          },
          duration_ms: 5,
        };
      }

      return {
        success: true,
        data: {
          entries: [
            { name: "src", path: `${p}/src`, is_dir: true },
            { name: "public", path: `${p}/public`, is_dir: true },
            { name: "package.json", path: `${p}/package.json`, is_dir: false },
            { name: "tsconfig.json", path: `${p}/tsconfig.json`, is_dir: false },
            { name: "vite.config.ts", path: `${p}/vite.config.ts`, is_dir: false },
            { name: "README.md", path: `${p}/README.md`, is_dir: false },
          ]
        },
        duration_ms: 5,
      };
    }
    if (action === "get_file_tree") {
      return { success: true, data: { root: null, files: [] }, duration_ms: 5 };
    }
    if (action === "read_file") {
      const rawPath = (payload.path as string) || "";
      const p = rawPath.replace(/\\/g, "/").replace(/\/+/g, "/");

      // 1. Active browser directory handle (from File System Access API)
      if (activeBrowserDirHandle) {
        try {
          const rootName = activeBrowserDirHandle.name;
          let relPath = p;
          if (relPath === rootName) {
            relPath = "";
          } else if (relPath.startsWith(rootName + "/")) {
            relPath = relPath.slice(rootName.length + 1);
          }
          const parts = relPath.split("/").filter(Boolean);
          if (parts.length > 0) {
            let currentHandle = activeBrowserDirHandle;
            for (let i = 0; i < parts.length - 1; i++) {
              currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
            }
            const fileName = parts[parts.length - 1];
            const fileHandle = await currentHandle.getFileHandle(fileName);
            const file = await fileHandle.getFile();
            const content = await file.text();
            return { success: true, data: { content }, duration_ms: 5 };
          }
        } catch {
          // Continue to next lookup strategy
        }
      }

      // 2. Uploaded files map (from webkitdirectory input)
      if (browserUploadedFiles.size > 0) {
        if (browserUploadedFiles.has(p)) {
          return { success: true, data: { content: browserUploadedFiles.get(p)?.content || "" }, duration_ms: 5 };
        }
        for (const [key, val] of browserUploadedFiles.entries()) {
          if (key === p || key.endsWith("/" + p) || p.endsWith("/" + key)) {
            return { success: true, data: { content: val.content || "" }, duration_ms: 5 };
          }
        }
      }

      // 3. Dev Server Filesystem API (reads directly from disk via Vite dev server)
      try {
        const resp = await fetch(`/__api/fs/read?path=${encodeURIComponent(rawPath)}`);
        if (resp.ok) {
          const json = await resp.json();
          if (json && json.success && typeof json.content === "string") {
            return { success: true, data: { content: json.content }, duration_ms: 8 };
          }
        }
      } catch {}

      // 4. Fallback for project README.md if not on disk
      const fileName = p.split("/").pop() || "";
      if (p.endsWith("README.md") || fileName === "README.md") {
        return { success: true, data: { content: "# CSOTIC IDE\nHigh-Performance obsidian-themed IDE for students and developers.\n" }, duration_ms: 2 };
      }

      // Genuine NotFound error. NEVER return fake hello() dummy code!
      return {
        success: false,
        data: null,
        error: { code: "Filesystem", message: `File not found: ${rawPath}` },
        duration_ms: 0,
      };
    }
    if (action === "write_file") {
      const rawPath = (payload.path as string) || "";
      const content = (payload.content as string) || "";
      const p = rawPath.replace(/\\/g, "/").replace(/\/+/g, "/");

      if (activeBrowserDirHandle) {
        try {
          const rootName = activeBrowserDirHandle.name;
          let relPath = p;
          if (relPath.startsWith(rootName + "/")) {
            relPath = relPath.slice(rootName.length + 1);
          }
          const parts = relPath.split("/").filter(Boolean);
          if (parts.length > 0) {
            let currentHandle = activeBrowserDirHandle;
            for (let i = 0; i < parts.length - 1; i++) {
              currentHandle = await currentHandle.getDirectoryHandle(parts[i], { create: true });
            }
            const fileName = parts[parts.length - 1];
            const fileHandle = await currentHandle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
          }
        } catch (e) {
          console.warn("Could not write to handle:", e);
        }
      }

      browserUploadedFiles.set(p, {
        name: p.split("/").pop() || "file",
        path: p,
        is_dir: false,
        content,
      });

      try {
        await fetch("/__api/fs/write", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: rawPath, content }),
        });
      } catch {}

      return { success: true, data: { success: true }, duration_ms: 5 };
    }
    if (action === "select_folder") {
      const picked = await pickFolderInBrowser();
      if (picked) {
        return {
          success: true,
          data: {
            path: picked.path,
            name: picked.name,
          },
          duration_ms: 15,
        };
      }
      return { success: false, data: null, error: { code: "Validation", message: "User cancelled dialog" }, duration_ms: 0 };
    }
    if (action === "open_file_dialog") {
      const picked = await pickFileInBrowser();
      if (picked) {
        return {
          success: true,
          data: {
            path: picked.path,
            name: picked.name,
            content: picked.content || "",
          },
          duration_ms: 15,
        };
      }
      return { success: false, data: null, error: { code: "Validation", message: "User cancelled dialog" }, duration_ms: 0 };
    }
  }

  if (service === "agent") {
    if (action === "execute_request") {
      const reqId = (payload.request_id as string) || `agent_${Date.now()}`;
      const requestText = (payload.request as string) || "";
      const modelId = (payload.model_id as string) || "Gemini 2.0 Flash";

      // Asynchronously stream response tokens to the UI
      setTimeout(async () => {
        try {
          const streamChunks = [
            `I am working with you using **${modelId}**.\n\n`,
            `I've analyzed your prompt: "${requestText.slice(0, 50)}${requestText.length > 50 ? "..." : ""}".\n\n`,
            `Your codebase structure is ready. You can ask me to inspect, generate, refactor, or verify any files in your workspace.`
          ];

          for (const chunk of streamChunks) {
            await new Promise((r) => setTimeout(r, 60));
            await emit("agent-chat-response", {
              request_id: reqId,
              text: chunk,
              finished: false,
            });
          }

          await emit("agent-chat-response", {
            request_id: reqId,
            finished: true,
          });
        } catch (err) {
          console.error("Browser agent stream error:", err);
          await emit("agent-chat-response", {
            request_id: reqId,
            text: `\n\n⚠️ Error during processing: ${err}`,
            finished: true,
          });
        }
      }, 50);

      return { success: true, data: { request_id: reqId }, duration_ms: 10 };
    }

    if (action === "cancel_request") {
      return { success: true, data: { cancelled: true }, duration_ms: 5 };
    }
  }

  if (service === "models") {
    if (action === "get_models" || action === "discover_models") {
      return { success: true, data: { models: [] }, duration_ms: 5 };
    }

    if (action === "stream_prompt") {
      const reqId = (payload.request_id as string) || `stream_${Date.now()}`;
      const prompt = (payload.prompt as string) || "";
      const modelId = (payload.model_id as string) || "Gemini 2.0 Flash";

      setTimeout(async () => {
        try {
          const streamChunks = [
            `Hello! I received your message with **${modelId}**:\n\n`,
            `> ${prompt.slice(0, 100)}\n\n`,
            `Csotic AI pair programmer is active and ready to assist you.`
          ];

          for (const chunk of streamChunks) {
            await new Promise((r) => setTimeout(r, 50));
            await emit("model-stream", {
              request_id: reqId,
              delta: chunk,
              finished: false,
            });
          }

          await emit("model-stream", {
            request_id: reqId,
            delta: "",
            finished: true,
          });
        } catch (err) {
          console.error("Browser model stream error:", err);
          await emit("model-stream", {
            request_id: reqId,
            error: String(err),
            finished: true,
          });
        }
      }, 50);

      return { success: true, data: { request_id: reqId }, duration_ms: 10 };
    }

    if (action === "execute_prompt") {
      const prompt = (payload.prompt as string) || "";
      return {
        success: true,
        data: { text: `Generated response for: ${prompt.slice(0, 50)}` },
        duration_ms: 10,
      };
    }
  }

  if (service === "git") {
    if (action === "status") {
      return { success: true, data: { branch: "main", clean: true, staged: [], unstaged: [] }, duration_ms: 5 };
    }
  }

  let lastAuthAttempts: number[] = [];
  function checkBrowserAuthRateLimit(): boolean {
    const now = Date.now();
    lastAuthAttempts = lastAuthAttempts.filter((t) => now - t < 30000);
    if (lastAuthAttempts.length >= 5) {
      return false;
    }
    lastAuthAttempts.push(now);
    return true;
  }

  if (service === "auth") {
    if (action === "get_session") {
      const stored = localStorage.getItem("forge.auth_session");
      if (stored) {
        try {
          const s = JSON.parse(stored);
          if (
            !s?.user || 
            !s?.token || 
            s.user.id === "gh_developer" || 
            s.user.id === "local_dev" || 
            s.token === "gho_detected_local" || 
            s.provider === "local" ||
            String(s.token).toLowerCase().includes("demo")
          ) {
            localStorage.removeItem("forge.auth_session");
            return { success: true, data: { session: null }, duration_ms: 2 };
          }
          return { success: true, data: { session: s }, duration_ms: 2 };
        } catch {
          localStorage.removeItem("forge.auth_session");
        }
      }
      return { success: true, data: { session: null }, duration_ms: 2 };
    }
    if (action === "detect_local_identity") {
      return {
        success: true,
        data: {
          gh: {
            available: false,
          },
          git: null,
        },
        duration_ms: 2,
      };
    }
    if (action === "login_gh_cli") {
      return {
        success: false,
        data: null,
        error: {
          code: "Validation",
          message: "GitHub CLI authentication is only supported in the Csotic desktop application with 'gh' CLI installed.",
        },
        duration_ms: 5,
      };
    }
    if (action === "login_github_token") {
      const token = (payload.token as string)?.trim() || "";
      const lower = token.toLowerCase();
      if (!token || token.length < 8 || lower.includes("demo") || lower.includes("mock") || lower.includes("dummy") || lower.includes("fake") || lower.startsWith("test_") || lower === "test") {
        return { 
          success: false, 
          data: null, 
          error: { code: "Validation", message: "Demo or mock tokens are strictly rejected. A genuine GitHub Personal Access Token is required." }, 
          duration_ms: 0 
        };
      }
      if (!checkBrowserAuthRateLimit()) {
        return {
          success: false,
          data: null,
          error: { code: "Validation", message: "Too many authentication attempts. Rate limit exceeded. Please wait 30 seconds before retrying." },
          duration_ms: 0
        };
      }

      try {
        const resp = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.v3+json",
          },
        });
        if (!resp.ok) {
          const status = resp.status;
          const msg = status === 401 
            ? "GitHub authentication failed: Personal Access Token is invalid, expired, or revoked."
            : status === 403
            ? "GitHub access denied: Token lacks required permissions or API rate limit exceeded."
            : status === 429
            ? "GitHub API rate limit exceeded. Please wait a few minutes before trying again."
            : `GitHub authentication failed with status ${status}. Please verify your token.`;
          return { success: false, data: null, error: { code: "Validation", message: msg }, duration_ms: 50 };
        }
        const u = await resp.json();
        const realUser = {
          id: String(u.id),
          username: u.login,
          login: u.login,
          name: u.name || u.login,
          email: u.email || `${u.login}@users.noreply.github.com`,
          avatarUrl: u.avatar_url,
          company: u.company,
          bio: u.bio,
          reposCount: u.public_repos,
          provider: "github" as const,
          createdAt: new Date().toISOString(),
        };
        const maskedToken = token.length > 8 ? `${token.slice(0, 4)}••••••••${token.slice(-4)}` : "••••••••";
        const session = {
          user: realUser,
          token: maskedToken,
          hasToken: true,
          provider: "github" as const,
          syncEnabled: true,
          lastSyncedAt: new Date().toISOString(),
        };
        localStorage.setItem("forge.auth_session", JSON.stringify(session));
        return { success: true, data: { success: true, session }, duration_ms: 50 };
      } catch {
        return { success: false, data: null, error: { code: "Network", message: "Unable to connect to GitHub API. Please check your internet connection." }, duration_ms: 0 };
      }
    }
    if (action === "login_google") {
      const token = (payload.token as string)?.trim() || "";
      const lower = token.toLowerCase();
      if (!token || token.length < 10 || lower.includes("demo") || lower.includes("mock") || lower.includes("dummy") || lower.includes("fake") || lower.startsWith("test_") || lower === "test") {
        return { 
          success: false, 
          data: null, 
          error: { code: "Validation", message: "Demo or mock tokens are strictly rejected. A genuine Google OAuth Access Token is required." }, 
          duration_ms: 0 
        };
      }
      if (!checkBrowserAuthRateLimit()) {
        return {
          success: false,
          data: null,
          error: { code: "Validation", message: "Too many authentication attempts. Rate limit exceeded. Please wait 30 seconds before retrying." },
          duration_ms: 0
        };
      }

      try {
        const resp = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) {
          const status = resp.status;
          const msg = status === 401 
            ? "Google authentication failed: Access Token is invalid, expired, or revoked."
            : status === 403
            ? "Google access denied: Token lacks user profile permissions."
            : status === 429
            ? "Google API rate limit exceeded. Please wait a few minutes before trying again."
            : `Google authentication failed with status ${status}. Please verify your token.`;
          return { success: false, data: null, error: { code: "Validation", message: msg }, duration_ms: 50 };
        }
        const gu = await resp.json();
        const email = gu.email || "";
        const name = gu.name || email;
        const realGoogleUser = {
          id: `google_${gu.sub}`,
          username: email.split("@")[0] || name.toLowerCase().replace(/\s+/g, "_"),
          login: email.split("@")[0] || name.toLowerCase().replace(/\s+/g, "_"),
          name,
          email,
          avatarUrl: gu.picture,
          provider: "google" as const,
          bio: "Verified Google Developer Account",
          createdAt: new Date().toISOString(),
        };
        const maskedToken = token.length > 8 ? `${token.slice(0, 4)}••••••••${token.slice(-4)}` : "••••••••";
        const session = {
          user: realGoogleUser,
          token: maskedToken,
          hasToken: true,
          provider: "google" as const,
          syncEnabled: true,
          lastSyncedAt: new Date().toISOString(),
        };
        localStorage.setItem("forge.auth_session", JSON.stringify(session));
        return { success: true, data: { success: true, session }, duration_ms: 50 };
      } catch {
        return { success: false, data: null, error: { code: "Network", message: "Unable to connect to Google API. Please check your internet connection." }, duration_ms: 0 };
      }
    }
    if (action === "save_profile") {
      const stored = localStorage.getItem("forge.auth_session");
      if (!stored) {
        return {
          success: false,
          data: null,
          error: {
            code: "Validation",
            message: "Cannot update profile: No active authenticated session found. Please sign in with GitHub or Google first.",
          },
          duration_ms: 2,
        };
      }
      let curr: any = null;
      try {
        curr = JSON.parse(stored);
      } catch {
        curr = null;
      }
      if (!curr || !curr.user || !curr.token) {
        return {
          success: false,
          data: null,
          error: {
            code: "Validation",
            message: "Cannot update profile: No authenticated user session exists. Please sign in with GitHub or Google first.",
          },
          duration_ms: 2,
        };
      }
      const profile = (payload.profile || payload) as any;
      const rawName = (profile.name || "").trim();
      if (!rawName) {
        return {
          success: false,
          data: null,
          error: { code: "Validation", message: "Display Name is required." },
          duration_ms: 0,
        };
      }
      curr.user = {
        ...curr.user,
        name: rawName,
        bio: (profile.bio || "").trim() || curr.user.bio,
        avatarUrl: (profile.avatarUrl || "").trim() || curr.user.avatarUrl,
      };
      curr.lastSyncedAt = new Date().toISOString();
      localStorage.setItem("forge.auth_session", JSON.stringify(curr));
      return { success: true, data: { success: true, session: curr }, duration_ms: 5 };
    }
    if (action === "logout") {
      localStorage.removeItem("forge.auth_session");
      return { success: true, data: { success: true, session: null }, duration_ms: 2 };
    }
  }

  return {
    success: false,
    data: null,
    error: {
      code: "Internal",
      message: `Action '${service}:${action}' requires the desktop application environment.`,
    },
    duration_ms: 0,
  };
}

/**
 * Send a structured IPC request to the Rust backend.
 * Maps to the `ipc_request` Tauri command handler.
 */
export async function ipcRequest(
  service: string,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<IpcResponse> {
  if (!isTauri) {
    return await handleBrowserIpc(service, action, payload);
  }

  try {
    const response = await invoke<IpcResponse>("ipc_request", {
      service,
      action,
      payload,
    });
    return response;
  } catch (err) {
    // Per Chapter 3: IPC errors must never crash the UI.
    return {
      success: false,
      data: null,
      error: {
        code: "Internal",
        message: err instanceof Error ? err.message : String(err),
      },
      duration_ms: 0,
    };
  }
}

/** Workspace service shortcuts */
export const workspace = {
  getState: () => ipcRequest("workspace", "get_state"),
  openProject: (path: string) =>
    ipcRequest("workspace", "open_project", { path }),
  clearActiveProject: () =>
    ipcRequest("workspace", "clear_active_project"),
  getLayout: () => ipcRequest("workspace", "get_layout"),
  updateLayout: (layout: Record<string, unknown>) =>
    ipcRequest("workspace", "update_layout", layout),
  getRecentProjects: () => ipcRequest("workspace", "get_recent_projects"),
  saveState: (state: Record<string, unknown>) =>
    ipcRequest("workspace", "save_state", state),
};

/** Filesystem service shortcuts per Chapter 5 */
export const filesystem = {
  readDir: (path: string) =>
    ipcRequest("filesystem", "read_dir", { path }),
  readFile: (path: string) =>
    ipcRequest("filesystem", "read_file", { path }),
  writeFile: (path: string, content: string) =>
    ipcRequest("filesystem", "write_file", { path, content }),
  createDir: (path: string) =>
    ipcRequest("filesystem", "create_dir", { path }),
  rename: (oldPath: string, newPath: string) =>
    ipcRequest("filesystem", "rename", { old_path: oldPath, new_path: newPath }),
  copyFile: (srcPath: string, destPath: string) =>
    ipcRequest("filesystem", "copy_file", { src_path: srcPath, dest_path: destPath }),
  getFileTree: () =>
    ipcRequest("filesystem", "get_file_tree"),
  searchInFiles: (query: string, caseSensitive: boolean = false) =>
    ipcRequest("filesystem", "search_in_files", { query, case_sensitive: caseSensitive }),
  patchFile: (path: string, target: string, replacement: string) =>
    ipcRequest("filesystem", "patch_file", { path, target, replacement }),
  deletePath: (path: string, approved: boolean = false) =>
    ipcRequest("filesystem", "delete", { path, approved }),
  selectFolder: () =>
    ipcRequest("filesystem", "select_folder"),
  selectFiles: () =>
    ipcRequest("filesystem", "select_files"),
  saveAsDialog: (defaultName: string, content: string) =>
    ipcRequest("filesystem", "save_as_dialog", { default_name: defaultName, content }),
  openFileDialog: () =>
    ipcRequest("filesystem", "open_file_dialog"),
};

/** Git service shortcuts per Chapter 5 */
export const git = {
  status: (projectPath: string) =>
    ipcRequest("git", "status", { project_path: projectPath }),
  diff: (projectPath: string, path?: string) =>
    ipcRequest("git", "diff", { project_path: projectPath, path }),
  show: (projectPath: string, path: string) =>
    ipcRequest("git", "show", { project_path: projectPath, path }),
  numstat: (projectPath: string) =>
    ipcRequest("git", "numstat", { project_path: projectPath }),
  add: (projectPath: string, path: string = ".") =>
    ipcRequest("git", "add", { project_path: projectPath, path }),
  commit: (projectPath: string, message: string) =>
    ipcRequest("git", "commit", { project_path: projectPath, message }),
  branch: (projectPath: string) =>
    ipcRequest("git", "branch", { project_path: projectPath }),
  checkout: (projectPath: string, target: string) =>
    ipcRequest("git", "checkout", { project_path: projectPath, target }),
  createBranch: (projectPath: string, name: string) =>
    ipcRequest("git", "create_branch", { project_path: projectPath, name }),
  unstage: (projectPath: string, path: string = ".") =>
    ipcRequest("git", "unstage", { project_path: projectPath, path }),
  discard: (projectPath: string, path: string) =>
    ipcRequest("git", "discard", { project_path: projectPath, path }),
  log: (projectPath: string, limit: number = 25) =>
    ipcRequest("git", "log", { project_path: projectPath, limit }),
  resetHard: (projectPath: string, approved: boolean = false) =>
    ipcRequest("git", "reset_hard", { project_path: projectPath, approved }),
  forcePush: (projectPath: string, approved: boolean = false) =>
    ipcRequest("git", "force_push", { project_path: projectPath, approved }),
  branchDelete: (projectPath: string, branch: string, approved: boolean = false) =>
    ipcRequest("git", "branch_delete", { project_path: projectPath, branch, approved }),
  stash: (projectPath: string, subaction: "push" | "pop" = "push") =>
    ipcRequest("git", "stash", { project_path: projectPath, subaction }),
  pull: (projectPath: string) =>
    ipcRequest("git", "pull", { project_path: projectPath }),
  push: (projectPath: string) =>
    ipcRequest("git", "push", { project_path: projectPath }),
};

/** Terminal service shortcuts per Chapter 5 */
export const terminal = {
  /** `stream: true` = interactive terminal (live output, no timeout, Stop-able). Default is a silent probe. */
  executeCommand: (projectPath: string, command: string, approved: boolean = false, stream: boolean = false) =>
    ipcRequest("terminal", "execute_command", { project_path: projectPath, command, approved, stream }),
  cancelCommand: () =>
    ipcRequest("terminal", "cancel_command"),
  sendInput: (input: string) =>
    ipcRequest("terminal", "send_input", { input }),
};

/** Model service shortcuts per Chapter 24 */
export const models = {
  discoverModels: () =>
    ipcRequest("models", "discover_models"),
  executePrompt: (modelId: string, prompt: string, systemPrompt?: string) =>
    ipcRequest("models", "execute_prompt", { model_id: modelId, prompt, system_prompt: systemPrompt }),
  streamPrompt: (modelId: string, prompt: string, systemPrompt?: string, requestId?: string, imagePaths?: string[], history?: Record<string, string>[]) =>
    ipcRequest("models", "stream_prompt", {
      model_id: modelId,
      prompt,
      system_prompt: systemPrompt,
      request_id: requestId,
      image_paths: imagePaths,
      history,
    }),
  saveApiKeys: (keys: { openai?: string; anthropic?: string; deepseek?: string; groq?: string; openrouter?: string; gemini?: string; custom_endpoints?: string }) =>
    ipcRequest("models", "save_api_keys", keys),
  getApiKeys: () =>
    ipcRequest("models", "get_api_keys"),
};

/** Memory service shortcuts per Chapter 17 */
export const memory = {
  addMemory: (projectId: string | null, category: string, summary: string, source: string, confidence: number = 0.9) =>
    ipcRequest("memory", "add_memory", { project_id: projectId, category, summary, source, confidence }),
  getMemories: (category?: string) =>
    ipcRequest("memory", "get_memories", { category }),
  deleteMemory: (id: string) =>
    ipcRequest("memory", "delete_memory", { id }),
};

/** Agent service shortcuts per Chapter 15 */
export const agent = {
  executeRequest: (request: string, options: {
    projectPath: string;
    modelId: string;
    permissionProfile: "read_only" | "edit" | "developer" | "full_automation";
    requestId: string;
    imagePaths?: string[];
    history?: Record<string, string>[];
  }) => ipcRequest("agent", "execute_request", {
    request,
    project_path: options.projectPath,
    model_id: options.modelId,
    permission_profile: options.permissionProfile,
    request_id: options.requestId,
    image_paths: options.imagePaths,
    history: options.history,
  }),
  cancelRequest: (requestId: string) =>
    ipcRequest("agent", "cancel_request", { request_id: requestId }),
};

/** Indexing service shortcuts */
export const indexing = {
  start: (projectPath: string) =>
    ipcRequest("indexing", "start", { project_path: projectPath }),
  getSummary: (projectIdOrPath: string) =>
    ipcRequest("indexing", "get_summary", { project_id: projectIdOrPath, project_path: projectIdOrPath }),
  search: (query: string, projectPath?: string) =>
    ipcRequest("indexing", "search", { query, project_path: projectPath }),
};

/** Symbols service */
export const symbols = {
  extract: (path: string, content?: string) =>
    ipcRequest("symbols", "extract", { path, content }),
};

/** Plugins & Extensions service shortcuts */
export const plugins = {
  getPlugins: () => ipcRequest("plugins", "get_plugins"),
  scaffoldPlugin: (projectPath: string) => ipcRequest("plugins", "scaffold_plugin", { project_path: projectPath }),
  installExtension: (ext: Record<string, any>) => ipcRequest("plugins", "install_extension", ext),
  uninstallExtension: (id: string) => ipcRequest("plugins", "uninstall_extension", { id }),
  getInstalledExtensions: () => ipcRequest("plugins", "get_installed_extensions"),
  trustWorkspace: (projectPath: string) => ipcRequest("plugins", "trust_workspace", { project_path: projectPath }),
  untrustWorkspace: (projectPath: string) => ipcRequest("plugins", "untrust_workspace", { project_path: projectPath }),
  isWorkspaceTrusted: (projectPath: string) => ipcRequest("plugins", "is_workspace_trusted", { project_path: projectPath }),
};

/** Extension Host Service (VS Code Compatible, Ultra-Low RAM) */
export const extHost = {
  status: () => ipcRequest("ext_host", "status"),
  start: (workspaceRoot?: string) =>
    ipcRequest("ext_host", "start", { workspace_root: workspaceRoot }),
  activateExtension: (extensionId: string, workspaceRoot?: string) =>
    ipcRequest("ext_host", "activate_extension", { extension_id: extensionId, workspace_root: workspaceRoot }),
  resolveWebview: (viewId: string, extensionId?: string, workspaceRoot?: string) =>
    ipcRequest("ext_host", "resolve_webview", { view_id: viewId, extension_id: extensionId, workspace_root: workspaceRoot }),
  postMessage: (viewId: string, message: any) =>
    ipcRequest("ext_host", "post_message", { view_id: viewId, message }),
  stop: () => ipcRequest("ext_host", "stop"),
};

/** Collaboration service shortcuts */
export const collaboration = {
  startSession: () => ipcRequest("collaboration", "start_session"),
  joinSession: (sessionId: string) => ipcRequest("collaboration", "join_session", { session_id: sessionId }),
};

/** System service shortcuts */
export const system = {
  health: () => ipcRequest("system", "health"),
  diagnostics: () => ipcRequest("system", "diagnostics"),
  log: (level: string, message: string) => ipcRequest("system", "log", { level, message }),
  trimMemory: () => ipcRequest("system", "trim_memory"),
};

/** Project State & Workspace Integrity shortcuts */
export interface ProjectStateInfo {
  workspace_root: string;
  project_exists: boolean;
  project_type: string;
  project_type_name: string;
  package_manager: string;
  file_count: number;
  directory_count: number;
  entry_points: string[];
  important_files: string[];
  is_git: boolean;
  summary: string;
}

export const projectState = {
  getState: (projectPath?: string) =>
    ipcRequest("project_state", "get_state", { project_path: projectPath }),
};

export const changeset = {
  rollback: (projectPath: string, taskId: string) =>
    ipcRequest("changeset", "rollback", { project_path: projectPath, task_id: taskId }),
};

/** Obsidian Brain service shortcuts */
export const brain = {
  listNotes: (projectPath: string) =>
    ipcRequest("brain", "list_notes", { project_path: projectPath }),
  createNote: (projectPath: string, title: string, content?: string) =>
    ipcRequest("brain", "create_note", { project_path: projectPath, title, content }),
  saveNote: (path: string, content: string) =>
    ipcRequest("brain", "save_note", { path, content }),
  deleteNote: (path: string) =>
    ipcRequest("brain", "delete_note", { path }),
  getGraph: (projectPath: string) =>
    ipcRequest("brain", "get_graph", { project_path: projectPath }),
  getBacklinks: (projectPath: string, targetPath: string) =>
    ipcRequest("brain", "get_backlinks", { project_path: projectPath, target_path: targetPath }),
  syncAiBridges: (projectPath: string) =>
    ipcRequest("brain", "sync_ai_bridges", { project_path: projectPath }),
};

/** Window management shortcuts */
export const windowService = {
  minimize: () => ipcRequest("window", "minimize"),
  maximize: () => ipcRequest("window", "maximize"),
  unmaximize: () => ipcRequest("window", "unmaximize"),
  toggleMaximize: () => ipcRequest("window", "toggle_maximize"),
  close: () => ipcRequest("window", "close"),
  startDragging: () => ipcRequest("window", "start_dragging"),
};

/** Auth & Accounts service shortcuts */
export const auth = {
  getSession: () => ipcRequest("auth", "get_session"),
  detectLocalIdentity: () => ipcRequest("auth", "detect_local_identity"),
  loginGhCli: () => ipcRequest("auth", "login_gh_cli"),
  loginGitHubToken: (token: string) => ipcRequest("auth", "login_github_token", { token }),
  loginGoogle: (token: string, profile?: any) => ipcRequest("auth", "login_google", { token, profile }),
  saveProfile: (profile: any) => ipcRequest("auth", "save_profile", { profile }),
  logout: () => ipcRequest("auth", "logout"),
};


