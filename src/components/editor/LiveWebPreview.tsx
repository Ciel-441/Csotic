import { useState } from "react";
import { RotateCw, ExternalLink, Smartphone, Tablet, Monitor, X, Code2, Globe } from "lucide-react";

interface LiveWebPreviewProps {
  defaultUrl?: string;
  htmlContent?: string;
  onClose?: () => void;
}

export function LiveWebPreview({
  defaultUrl = "http://localhost:5173",
  htmlContent,
  onClose,
}: LiveWebPreviewProps) {
  const hasHtml = Boolean(htmlContent && htmlContent.trim().length > 0 && /<[a-z][\s\S]*>/i.test(htmlContent));
  const [mode, setMode] = useState<"code" | "server">(hasHtml ? "code" : "server");
  const [url, setUrl] = useState(defaultUrl);
  const [inputUrl, setInputUrl] = useState(defaultUrl);
  const [reloadKey, setReloadKey] = useState(0);
  const [deviceMode, setDeviceMode] = useState<"desktop" | "tablet" | "mobile">("desktop");

  const handleRefresh = () => {
    setReloadKey((k) => k + 1);
  };

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    let target = inputUrl.trim();
    if (!target.startsWith("http://") && !target.startsWith("https://")) {
      target = `http://${target}`;
    }
    setUrl(target);
    setInputUrl(target);
    setMode("server");
  };

  const getFrameWidth = () => {
    switch (deviceMode) {
      case "mobile":
        return 375;
      case "tablet":
        return 768;
      default:
        return "100%";
    }
  };

  return (
    <div className="live-web-preview" style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      width: "100%",
      background: "var(--color-bg-base)",
      overflow: "hidden",
    }}>
      {/* Navigation & Device Bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 10px",
        background: "var(--color-bg-surface)",
        borderBottom: "1px solid var(--color-border-default)",
        gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, flex: 1, minWidth: 0 }}>
          <button
            type="button"
            className="btn btn--icon"
            onClick={handleRefresh}
            title="Reload Preview"
            style={{ width: 26, height: 26, padding: 0, flexShrink: 0 }}
          >
            <RotateCw size={13} />
          </button>

          {/* Mode Switcher */}
          {hasHtml && (
            <div style={{
              display: "flex",
              alignItems: "center",
              background: "rgba(0, 0, 0, 0.4)",
              border: "1px solid var(--color-border-subtle)",
              borderRadius: "var(--radius-sm)",
              padding: 2,
              gap: 2,
              flexShrink: 0,
            }}>
              <button
                type="button"
                onClick={() => setMode("code")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  padding: "2px 6px",
                  fontSize: "11px",
                  fontWeight: 500,
                  borderRadius: 3,
                  background: mode === "code" ? "rgba(239, 68, 68, 0.2)" : "transparent",
                  color: mode === "code" ? "#f87171" : "var(--color-text-tertiary)",
                  cursor: "pointer",
                }}
              >
                <Code2 size={11} /> Live Code
              </button>
              <button
                type="button"
                onClick={() => setMode("server")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  padding: "2px 6px",
                  fontSize: "11px",
                  fontWeight: 500,
                  borderRadius: 3,
                  background: mode === "server" ? "rgba(239, 68, 68, 0.2)" : "transparent",
                  color: mode === "server" ? "#f87171" : "var(--color-text-tertiary)",
                  cursor: "pointer",
                }}
              >
                <Globe size={11} /> Server URL
              </button>
            </div>
          )}

          {/* URL Bar */}
          {mode === "server" ? (
            <form onSubmit={handleNavigate} style={{ display: "flex", flex: 1, alignItems: "center", minWidth: 0 }}>
              <input
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="http://localhost:5173"
                style={{
                  width: "100%",
                  background: "var(--color-bg-base)",
                  border: "1px solid var(--color-border-subtle)",
                  borderRadius: "var(--radius-sm)",
                  padding: "4px 8px",
                  fontSize: "12px",
                  color: "var(--color-text-primary)",
                  fontFamily: "var(--font-mono)",
                }}
              />
            </form>
          ) : (
            <div style={{
              flex: 1,
              fontSize: "11.5px",
              color: "var(--color-text-secondary)",
              padding: "4px 8px",
              background: "rgba(0,0,0,0.2)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border-subtle)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              ⚡ Live rendering active HTML tab
            </div>
          )}
        </div>

        {/* Device toggle buttons & Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
          <button
            className={`btn btn--icon ${deviceMode === "desktop" ? "btn--active" : ""}`}
            onClick={() => setDeviceMode("desktop")}
            title="Desktop View"
            style={{ width: 24, height: 24, padding: 0 }}
          >
            <Monitor size={13} />
          </button>
          <button
            className={`btn btn--icon ${deviceMode === "tablet" ? "btn--active" : ""}`}
            onClick={() => setDeviceMode("tablet")}
            title="Tablet View (768px)"
            style={{ width: 24, height: 24, padding: 0 }}
          >
            <Tablet size={13} />
          </button>
          <button
            className={`btn btn--icon ${deviceMode === "mobile" ? "btn--active" : ""}`}
            onClick={() => setDeviceMode("mobile")}
            title="Mobile View (375px)"
            style={{ width: 24, height: 24, padding: 0 }}
          >
            <Smartphone size={13} />
          </button>
          {mode === "server" && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="btn btn--icon"
              title="Open in external browser"
              style={{ width: 24, height: 24, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <ExternalLink size={13} />
            </a>
          )}

          {/* Close Preview / Split Button */}
          {onClose && (
            <button
              className="btn btn--icon"
              onClick={onClose}
              title="Close Preview (Return to Code Editor)"
              style={{
                width: 24,
                height: 24,
                padding: 0,
                color: "var(--color-text-tertiary)",
                marginLeft: 4,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#ef4444";
                e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--color-text-tertiary)";
                e.currentTarget.style.background = "transparent";
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Frame Container */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        background: "#080a0f",
        overflow: "auto",
        padding: deviceMode !== "desktop" ? "16px 0" : 0,
        position: "relative",
      }}>
        <iframe
          key={`${reloadKey}-${mode}`}
          src={mode === "server" ? url : undefined}
          srcDoc={mode === "code" ? (htmlContent || "<html><body style='font-family:sans-serif;color:#888;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;'><p>No HTML content to render</p></body></html>") : undefined}
          title="Web Preview"
          // srcDoc inherits the app's origin: with allow-same-origin, previewed HTML (e.g. from a
          // cloned repo) could reach window.parent's Tauri IPC and run shell commands. Only a
          // real dev-server URL (already cross-origin) may keep its own origin.
          sandbox={mode === "code" ? "allow-scripts allow-forms allow-modals" : "allow-scripts allow-same-origin allow-forms allow-popups allow-modals"}
          style={{
            width: getFrameWidth(),
            height: "100%",
            border: deviceMode !== "desktop" ? "1px solid var(--color-border-default)" : "none",
            borderRadius: deviceMode !== "desktop" ? 8 : 0,
            boxShadow: deviceMode !== "desktop" ? "0 8px 30px rgba(0,0,0,0.5)" : "none",
            background: "#ffffff",
          }}
        />
      </div>
    </div>
  );
}
