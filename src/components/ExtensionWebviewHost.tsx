import { useState, useEffect, useRef, useCallback } from "react";
import { RotateCw, AlertTriangle, ShieldCheck } from "lucide-react";
import { extHost } from "../services/ipc";
import { listen } from "../services/events";

interface ExtensionWebviewHostProps {
  viewId: string;
  extensionId: string;
  title?: string;
  workspaceRoot?: string;
  theme?: "dark" | "light";
}

export function ExtensionWebviewHost({
  viewId,
  extensionId,
  title = "Extension View",
  workspaceRoot,
  theme = "dark",
}: ExtensionWebviewHostProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [webviewUrl, setWebviewUrl] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const initView = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res: any = await extHost.resolveWebview(viewId, extensionId, workspaceRoot);
      if (res?.data?.url) {
        setWebviewUrl(res.data.url);
      } else if (res?.error?.message) {
        setError(res.error.message);
      } else {
        setError("Failed to resolve webview container from extension host.");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to initialize extension host.");
    } finally {
      setLoading(false);
    }
  }, [viewId, extensionId, workspaceRoot]);

  useEffect(() => {
    void initView();
  }, [initView]);

  // Synchronize theme changes to the iframe immediately
  useEffect(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { type: "vscode-host-theme-change", theme },
        "*"
      );
    }
  }, [theme]);

  // 1. Listen for postMessage from the iframe -> route to Extension Host
  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data && data.type === "vscode-webview-post" && data.viewId === viewId) {
        void extHost.postMessage(viewId, data.message);
      }
    };

    window.addEventListener("message", handleWindowMessage);
    return () => {
      window.removeEventListener("message", handleWindowMessage);
    };
  }, [viewId]);

  // 2. Listen for events from Tauri backend (ext-host:message) -> route into iframe
  useEffect(() => {
    let unlistenMessage: (() => void) | undefined;
    let unlistenSetHtml: (() => void) | undefined;

    const setupListeners = async () => {
      unlistenMessage = await listen("ext-host:message", (event: any) => {
        const payload = event.payload;
        if (payload?.viewId === viewId && iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage(
            { type: "vscode-host-post", message: payload.message },
            "*"
          );
        }
      });

      unlistenSetHtml = await listen("ext-host:set-html", (event: any) => {
        const payload = event.payload;
        if (payload?.viewId === viewId && payload?.url) {
          setWebviewUrl(payload.url);
          if (iframeRef.current) {
            iframeRef.current.src = payload.url;
          }
        }
      });
    };

    void setupListeners();

    return () => {
      if (unlistenMessage) unlistenMessage();
      if (unlistenSetHtml) unlistenSetHtml();
    };
  }, [viewId]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: theme === "light" ? "#ffffff" : "#18181b",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Top Bar / Status */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          background: theme === "light" ? "#f8fafc" : "#12151b",
          borderBottom: theme === "light" ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.06)",
          fontSize: "11px",
          color: theme === "light" ? "#64748b" : "#9ca3af",
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ShieldCheck size={13} color="#10b981" />
          <span style={{ fontWeight: 600, color: theme === "light" ? "#0f172a" : "#e5e7eb" }}>{title}</span>
          <span style={{ fontSize: "10px", color: theme === "light" ? "#94a3b8" : "#6b7280" }}>({extensionId})</span>
        </div>

        <button
          onClick={() => void initView()}
          title="Reload extension view"
          style={{
            background: "none",
            border: "none",
            color: theme === "light" ? "#64748b" : "#9ca3af",
            cursor: "pointer",
            padding: "2px 4px",
            display: "flex",
            alignItems: "center",
          }}
        >
          <RotateCw size={11} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div
          style={{
            position: "absolute",
            top: 36,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            background: theme === "light" ? "#ffffff" : "#18181b",
            zIndex: 10,
          }}
        >
          <RotateCw size={22} color="#3b82f6" className="animate-spin" />
          <span style={{ fontSize: "12px", color: theme === "light" ? "#475569" : "#9ca3af" }}>Booting Extension Host...</span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div
          style={{
            padding: 16,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 8,
            color: "#ef4444",
          }}
        >
          <AlertTriangle size={24} />
          <div style={{ fontSize: "12px", fontWeight: 600 }}>Extension Error</div>
          <div style={{ fontSize: "11.5px", color: theme === "light" ? "#64748b" : "#9ca3af" }}>{error}</div>
          <button
            onClick={() => void initView()}
            style={{
              marginTop: 8,
              padding: "6px 12px",
              background: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              borderRadius: 4,
              color: "#f87171",
              fontSize: "11px",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Sandboxed Webview Frame */}
      {webviewUrl && (
        <iframe
          ref={iframeRef}
          src={`${webviewUrl}${webviewUrl.includes("?") ? "&" : "?"}theme=${theme || "dark"}`}
          title={title}
          sandbox="allow-scripts allow-forms allow-same-origin allow-modals"
          style={{
            width: "100%",
            flex: 1,
            border: "none",
            background: theme === "light" ? "#ffffff" : "#18181b",
          }}
        />
      )}
    </div>
  );
}
