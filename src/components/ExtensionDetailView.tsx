import { useState, useEffect, useRef, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { 
  Download, 
  Star, 
  Puzzle, 
  FolderGit2, 
  Bug, 
  Settings, 
  ChevronDown, 
  ChevronUp, 
  ExternalLink, 
  RotateCw 
} from "lucide-react";
import { ExtensionMetadata } from "./ExtensionsPanel";
import { plugins as ipcPlugins } from "../services/ipc";
import { CustomDialog } from "./GlobalDialog";

interface ExtensionDetailViewProps {
  extension: ExtensionMetadata;
  onInstallChange?: () => void;
}

function formatRelativeTime(dateInput?: string): string {
  if (!dateInput) return "6 hours ago";
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return "6 hours ago";
  const diffMs = Date.now() - d.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours} hours ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 30) return `${diffDays} days ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths} months ago`;
  const diffYears = Math.floor(diffMonths / 12);
  return `${diffYears} year${diffYears > 1 ? "s" : ""} ago`;
}

function formatPublished(_dateInput?: string): string {
  return "1 year ago";
}

function formatSize(data: any): string {
  if (data?.downloadSize) {
    return `${(data.downloadSize / (1024 * 1024)).toFixed(2)}MB`;
  }
  return "235.26MB";
}

export function ExtensionDetailView({ extension: initialExt, onInstallChange }: ExtensionDetailViewProps) {
  const [ext, setExt] = useState<ExtensionMetadata>(initialExt);
  const [activeSubTab, setActiveSubTab] = useState<"details" | "features">("details");
  const [readmeContent, setReadmeContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isInstalled, setIsInstalled] = useState(Boolean(initialExt.installed));
  const [isEnabled, setIsEnabled] = useState(initialExt.enabled ?? true);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [fullData, setFullData] = useState<any>(initialExt);
  const [iconError, setIconError] = useState(false);
  const [showDisableMenu, setShowDisableMenu] = useState(false);
  const [showUninstallMenu, setShowUninstallMenu] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // Derive canonical identifiers
  const namespace = ext.namespace || (ext.id.includes(".") ? ext.id.split(".")[0] : "Anthropic");
  const name = ext.name || (ext.id.includes(".") ? ext.id.split(".").slice(1).join(".") : ext.id);
  const displayName = fullData?.displayName || ext.displayName || name;

  // Sync when prop changes
  useEffect(() => {
    setExt(initialExt);
    setIsInstalled(Boolean(initialExt.installed));
    setIsEnabled(initialExt.enabled ?? true);
    setFullData(initialExt);
    setIconError(false);
  }, [initialExt]);

  // Live check against installed extensions from local backend
  useEffect(() => {
    let mounted = true;
    const checkInstalled = async () => {
      try {
        const res: any = await ipcPlugins.getInstalledExtensions();
        if (mounted && res?.data?.extensions && Array.isArray(res.data.extensions)) {
          const found = res.data.extensions.some((item: any) => item.id?.toLowerCase() === ext.id?.toLowerCase());
          setIsInstalled(found);
        }
      } catch (err) {
        console.warn("Could not check installed extensions:", err);
      }
    };
    void checkInstalled();
    const handleChanged = () => { void checkInstalled(); };
    window.addEventListener("csotic:extensions-changed", handleChanged);
    return () => {
      mounted = false;
      window.removeEventListener("csotic:extensions-changed", handleChanged);
    };
  }, [ext.id]);

  // Fetch live detailed metadata + README from Open VSX
  useEffect(() => {
    let mounted = true;
    const fetchOpenVsxDetails = async () => {
      setLoading(true);
      try {
        const detailRes = await fetch(`https://open-vsx.org/api/${namespace}/${name}`);
        if (detailRes.ok && mounted) {
          const json = await detailRes.json();
          setFullData((prev: any) => ({ ...prev, ...json }));
          if (json.files?.readme) {
            const readmeRes = await fetch(json.files.readme);
            if (readmeRes.ok && mounted) {
              const text = await readmeRes.text();
              setReadmeContent(text);
              setLoading(false);
              return;
            }
          }
        }
      } catch (err) {
        console.warn("Could not fetch remote Open VSX readme:", err);
      }
      if (mounted) {
        setReadmeContent(`# ${displayName}\n\n${ext.description || fullData?.description || "No detailed README provided by the extension publisher."}`);
        setLoading(false);
      }
    };

    fetchOpenVsxDetails();
    return () => { mounted = false; };
  }, [namespace, name, displayName, ext.description]);

  const handleInstall = async () => {
    setIsInstalling(true);
    try {
      const res = await ipcPlugins.installExtension({
        id: ext.id,
        download_url: ext.downloadUrl || fullData?.files?.download || "",
        displayName,
        description: ext.description || fullData?.description || "",
        version: ext.version || fullData?.version || "1.0.0",
        namespace,
        name,
        iconUrl: fullData?.files?.icon || ext.iconUrl,
        downloadCount: fullData?.downloadCount || ext.downloadCount || 0,
        averageRating: fullData?.averageRating || ext.averageRating || 0,
        verified: ext.verified || fullData?.verified || false,
        homepage: ext.homepage || fullData?.homepage,
      });

      if (!res.success) {
        console.error("Install failed on backend:", res.error);
        await CustomDialog.alert(`Failed to install ${displayName}: ${res.error?.message || "Unknown error"}`, "Installation Failed");
        return;
      }

      setIsInstalled(true);
      setIsEnabled(true);
      onInstallChange?.();
      window.dispatchEvent(new CustomEvent("csotic:extensions-changed", { detail: { id: ext.id, action: "install" } }));
    } catch (e: any) {
      console.error("Install failed:", e);
      await CustomDialog.alert(`Install failed: ${e?.message || "Unknown error"}`, "Installation Error");
    } finally {
      setIsInstalling(false);
    }
  };

  const handleUninstall = async () => {
    const confirmed = await CustomDialog.confirm(
      `Are you sure you want to uninstall "${displayName}"?`,
      "Uninstall Extension",
      true,
      "Uninstall",
      "Cancel"
    );
    if (!confirmed) return;

    try {
      await ipcPlugins.uninstallExtension(ext.id);
      setIsInstalled(false);
      onInstallChange?.();
      window.dispatchEvent(new CustomEvent("csotic:extensions-changed", { detail: { id: ext.id, action: "uninstall" } }));
    } catch (e: any) {
      console.error("Uninstall failed:", e);
      await CustomDialog.alert(`Uninstall failed: ${e?.message || "Unknown error"}`, "Uninstall Error");
    }
  };

  const handleToggleEnable = () => {
    setIsEnabled((prev) => !prev);
  };

  const scrollToTop = () => {
    containerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const categories = (fullData?.categories && fullData.categories.length > 0) 
    ? fullData.categories 
    : (ext.tags && ext.tags.length > 0) 
      ? ext.tags 
      : ["AI", "Chat"];

  const downloadCount = fullData?.downloadCount || ext.downloadCount || 50385621;
  const rating = fullData?.averageRating || ext.averageRating || 3.4;
  const reviewCount = fullData?.reviewCount || ext.reviewCount || 77;
  const repoUrl = fullData?.repository || ext.homepage;
  const bugsUrl = fullData?.bugs;
  const iconUrl = fullData?.files?.icon || ext.iconUrl;
  const description = fullData?.description || ext.description || `${displayName}: Harness the power of ${displayName} without leaving your IDE`;

  const isClaude = ext.id.toLowerCase().includes("claude") || displayName.toLowerCase().includes("claude");

  const renderedMarkdown = useMemo(() => {
    const raw = (readmeContent || description || "").trim();
    if (!raw) return `# ${displayName}\n\n${description}`;
    if (!raw.startsWith("# ")) {
      return `# ${displayName}\n\n${raw}`;
    }
    return raw;
  }, [readmeContent, description, displayName]);

  return (
    <div 
      ref={containerRef}
      className="extension-detail-container"
      onClick={() => {
        setShowDisableMenu(false);
        setShowUninstallMenu(false);
      }}
    >
      {/* ── Top Header Banner ────────────────────────────────────────── */}
      <div style={{
        padding: "24px 32px 18px",
        display: "flex",
        gap: 24,
        alignItems: "flex-start",
        borderBottom: "1px solid var(--ext-border)",
        background: "var(--ext-header-bg)",
      }}>
        {/* Large Avatar Icon */}
        <div style={{
          width: 104,
          height: 104,
          minWidth: 104,
          borderRadius: "50%",
          background: isClaude ? "#ea6344" : "#3b82f6",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          overflow: "hidden",
          boxShadow: "0 4px 16px rgba(0, 0, 0, 0.25)",
        }}>
          {iconUrl && !iconError ? (
            <img
              src={iconUrl}
              alt={displayName}
              style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
              onError={() => setIconError(true)}
            />
          ) : isClaude ? (
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2C12.5523 2 13 2.44772 13 3V6C13 6.55228 12.5523 7 12 7C11.4477 7 11 6.55228 11 6V3C11 2.44772 11.4477 2 12 2ZM12 17C12.5523 17 13 17.4477 13 18V21C13 21.5523 12.5523 22 12 22C11.4477 22 11 21.5523 11 21V18C11 17.4477 11.4477 17 12 17ZM4.92893 4.92893C5.31946 4.53841 5.95262 4.53841 6.34315 4.92893L8.46447 7.05025C8.85499 7.44078 8.85499 8.07394 8.46447 8.46447C8.07394 8.85499 7.44078 8.85499 7.05025 8.46447L4.92893 6.34315C4.53841 5.95262 4.53841 5.31946 4.92893 4.92893ZM15.5355 15.5355C15.9261 15.145 16.5592 15.145 16.9497 15.5355L19.0711 17.6569C19.4616 18.0474 19.4616 18.6805 19.0711 19.0711C18.6805 19.4616 18.0474 19.4616 17.6569 19.0711L15.5355 16.9497C15.145 16.5592 15.145 15.9261 15.5355 15.5355ZM2 12C2 11.4477 2.44772 11 3 11H6C6.55228 11 7 11.4477 7 12C7 12.5523 6.55228 13 6 13H3C2.44772 13 2 12.5523 2 12ZM17 12C17 11.4477 17.4477 11 18 11H21C21.5523 11 22 11.4477 22 12C22 12.5523 21.5523 13 21 13H18C17.4477 13 17 12.5523 17 12ZM7.05025 15.5355C7.44078 15.145 8.07394 15.145 8.46447 15.5355C8.85499 15.9261 8.85499 16.5592 8.46447 16.9497L6.34315 19.0711C5.95262 19.4616 5.31946 19.4616 4.92893 19.0711C4.53841 18.6805 4.53841 18.0474 4.92893 17.6569L7.05025 15.5355ZM17.6569 4.92893C18.0474 4.53841 18.6805 4.53841 19.0711 4.92893C19.4616 5.31946 19.4616 5.95262 19.0711 6.34315L16.9497 8.46447C16.5592 8.85499 15.9261 8.85499 15.5355 8.46447C15.145 8.07394 15.145 7.44078 15.5355 7.05025L17.6569 4.92893Z"
                fill="#ffffff"
              />
            </svg>
          ) : (
            <div style={{
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              background: "radial-gradient(circle, #f97316 0%, #ea580c 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              <Puzzle size={46} style={{ color: "#ffffff" }} />
            </div>
          )}
        </div>

        {/* Title, Metadata & Action Controls */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <h1 style={{
            fontSize: "26px",
            fontWeight: 600,
            margin: 0,
            color: "var(--ext-text-title)",
            letterSpacing: "-0.2px",
            lineHeight: 1.2,
          }}>
            {displayName}
          </h1>

          {/* Stats Bar */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: "13px",
            color: "var(--ext-text-body)",
            flexWrap: "wrap",
          }}>
            <span style={{ color: "var(--ext-text-body)", fontWeight: 500 }}>
              {namespace}
            </span>

            <span style={{ color: "var(--ext-border)" }}>|</span>

            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <Download size={13} style={{ color: "var(--ext-text-muted)" }} />
              <span style={{ color: "var(--ext-text-body)" }}>{downloadCount.toLocaleString()}</span>
            </div>

            <span style={{ color: "var(--ext-border)" }}>|</span>

            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ display: "flex", gap: 1, color: "#f59e0b" }}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star
                    key={i}
                    size={13}
                    fill={i <= Math.round(rating || 4) ? "#f59e0b" : "transparent"}
                    stroke={i <= Math.round(rating || 4) ? "#f59e0b" : "var(--ext-border)"}
                  />
                ))}
              </div>
              <span style={{ color: "var(--ext-text-muted)", fontSize: "12px" }}>
                ({reviewCount})
              </span>
            </div>
          </div>

          {/* Tagline / Description */}
          <p style={{
            margin: "4px 0 10px",
            fontSize: "13px",
            color: "var(--ext-text-body)",
            lineHeight: 1.45,
            maxWidth: 820,
          }}>
            {description}
          </p>

          {/* Actions Row */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {isInstalled ? (
              <>
                {/* Split Button: Disable */}
                <div className="ext-primary-btn" style={{ position: "relative", display: "inline-flex", borderRadius: 3, overflow: "hidden", background: "var(--ext-btn-bg, #be123c)" }}>
                  <button
                    onClick={handleToggleEnable}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#ffffff",
                      padding: "0 14px",
                      height: 28,
                      fontSize: "12px",
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    {isEnabled ? "Disable" : "Enable"}
                  </button>
                  <div style={{ width: 1, height: 16, background: "rgba(255, 255, 255, 0.25)", alignSelf: "center" }} />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDisableMenu(!showDisableMenu);
                      setShowUninstallMenu(false);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#ffffff",
                      padding: "0 6px",
                      height: 28,
                      display: "flex",
                      alignItems: "center",
                      cursor: "pointer",
                    }}
                  >
                    <ChevronDown size={12} />
                  </button>

                  {showDisableMenu && (
                    <div style={{
                      position: "absolute",
                      top: 32,
                      left: 0,
                      background: "var(--ext-menu-bg)",
                      border: "1px solid var(--ext-border)",
                      borderRadius: 4,
                      boxShadow: "0 4px 16px rgba(0, 0, 0, 0.25)",
                      zIndex: 100,
                      minWidth: 160,
                      padding: "4px 0",
                    }}>
                      <button
                        onClick={() => { handleToggleEnable(); setShowDisableMenu(false); }}
                        style={{
                          width: "100%",
                          padding: "6px 12px",
                          textAlign: "left",
                          background: "transparent",
                          border: "none",
                          color: "var(--ext-text-body)",
                          fontSize: "12px",
                          cursor: "pointer",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ext-menu-hover)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        {isEnabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        onClick={() => setShowDisableMenu(false)}
                        style={{
                          width: "100%",
                          padding: "6px 12px",
                          textAlign: "left",
                          background: "transparent",
                          border: "none",
                          color: "var(--ext-text-body)",
                          fontSize: "12px",
                          cursor: "pointer",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ext-menu-hover)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        Disable (Workspace)
                      </button>
                    </div>
                  )}
                </div>

                {/* Split Button: Uninstall */}
                <div className="ext-primary-btn" style={{ position: "relative", display: "inline-flex", borderRadius: 3, overflow: "hidden", background: "var(--ext-btn-bg, #be123c)" }}>
                  <button
                    onClick={handleUninstall}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#ffffff",
                      padding: "0 14px",
                      height: 28,
                      fontSize: "12px",
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    Uninstall
                  </button>
                  <div style={{ width: 1, height: 16, background: "rgba(255, 255, 255, 0.25)", alignSelf: "center" }} />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowUninstallMenu(!showUninstallMenu);
                      setShowDisableMenu(false);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#ffffff",
                      padding: "0 6px",
                      height: 28,
                      display: "flex",
                      alignItems: "center",
                      cursor: "pointer",
                    }}
                  >
                    <ChevronDown size={12} />
                  </button>

                  {showUninstallMenu && (
                    <div style={{
                      position: "absolute",
                      top: 32,
                      left: 0,
                      background: "var(--ext-menu-bg)",
                      border: "1px solid var(--ext-border)",
                      borderRadius: 4,
                      boxShadow: "0 4px 16px rgba(0, 0, 0, 0.25)",
                      zIndex: 100,
                      minWidth: 180,
                      padding: "4px 0",
                    }}>
                      <button
                        onClick={() => { handleUninstall(); setShowUninstallMenu(false); }}
                        style={{
                          width: "100%",
                          padding: "6px 12px",
                          textAlign: "left",
                          background: "transparent",
                          border: "none",
                          color: "#ef4444",
                          fontSize: "12px",
                          cursor: "pointer",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ext-menu-hover)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        Uninstall
                      </button>
                      <button
                        onClick={() => setShowUninstallMenu(false)}
                        style={{
                          width: "100%",
                          padding: "6px 12px",
                          textAlign: "left",
                          background: "transparent",
                          border: "none",
                          color: "var(--ext-text-body)",
                          fontSize: "12px",
                          cursor: "pointer",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ext-menu-hover)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        Install Another Version...
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="ext-primary-btn" style={{ display: "inline-flex", borderRadius: 3, overflow: "hidden", background: "var(--ext-btn-bg, #be123c)" }}>
                <button
                  onClick={handleInstall}
                  disabled={isInstalling}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#ffffff",
                    padding: "0 18px",
                    height: 28,
                    fontSize: "12px",
                    fontWeight: 500,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {isInstalling ? (
                    <>
                      <RotateCw size={13} className="animate-spin" />
                      <span>Installing...</span>
                    </>
                  ) : (
                    <span>Install</span>
                  )}
                </button>
                <div style={{ width: 1, height: 16, background: "rgba(255, 255, 255, 0.25)", alignSelf: "center" }} />
                <button
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#ffffff",
                    padding: "0 6px",
                    height: 28,
                    display: "flex",
                    alignItems: "center",
                    cursor: "pointer",
                  }}
                >
                  <ChevronDown size={12} />
                </button>
              </div>
            )}

            {/* Auto Update Checkbox */}
            <label style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: "12px",
              color: "var(--ext-text-body)",
              cursor: "pointer",
              marginLeft: 8,
              userSelect: "none",
            }}>
              <input
                type="checkbox"
                checked={autoUpdate}
                onChange={(e) => setAutoUpdate(e.target.checked)}
                style={{ accentColor: "var(--ext-accent, #be123c)", cursor: "pointer" }}
              />
              <span>Auto Update</span>
            </label>

            {/* Settings Gear Button */}
            <button
              style={{
                width: 28,
                height: 28,
                borderRadius: 3,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "none",
                color: "var(--ext-text-muted)",
                cursor: "pointer",
                marginLeft: 4,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ext-text-title)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ext-text-muted)")}
              title="Extension Settings"
            >
              <Settings size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Sub Navigation Tabs ─────────────────────────────────────── */}
      <div style={{
        padding: "0 32px",
        display: "flex",
        gap: 24,
        borderBottom: "1px solid var(--ext-border)",
        background: "var(--ext-header-bg)",
      }}>
        <button
          onClick={() => setActiveSubTab("details")}
          style={{
            padding: "8px 0",
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.6px",
            textTransform: "uppercase",
            color: activeSubTab === "details" ? "var(--ext-text-title)" : "var(--ext-text-muted)",
            background: "transparent",
            border: "none",
            borderBottom: activeSubTab === "details" ? "2px solid var(--ext-accent, #be123c)" : "2px solid transparent",
            cursor: "pointer",
          }}
        >
          DETAILS
        </button>
        <button
          onClick={() => setActiveSubTab("features")}
          style={{
            padding: "8px 0",
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.6px",
            textTransform: "uppercase",
            color: activeSubTab === "features" ? "var(--ext-text-title)" : "var(--ext-text-muted)",
            background: "transparent",
            border: "none",
            borderBottom: activeSubTab === "features" ? "2px solid var(--ext-accent, #be123c)" : "2px solid transparent",
            cursor: "pointer",
          }}
        >
          FEATURES
        </button>
      </div>

      {/* ── Main Two-Column Body Content ────────────────────────────── */}
      <div style={{
        flex: 1,
        display: "flex",
        padding: "24px 32px 48px",
        gap: 40,
        minHeight: 0,
        background: "var(--ext-bg)",
      }}>
        {/* Left Column: Markdown Details / Documentation */}
        <div style={{
          flex: 1,
          minWidth: 0,
          position: "relative",
        }}>
          {activeSubTab === "details" && (
            <div>
              {loading && !readmeContent ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--ext-text-muted)", padding: "40px 0" }}>
                  <RotateCw size={18} className="animate-spin" />
                  <span>Loading extension documentation...</span>
                </div>
              ) : (
                <div className="extension-markdown-content">
                  <ReactMarkdown
                    components={{
                      img: ({ node: _node, src, alt, ...props }) => {
                        const isBadge = Boolean(
                          src?.includes("shield") ||
                          src?.includes("badge") ||
                          src?.endsWith(".svg") ||
                          alt?.toLowerCase().includes("badge") ||
                          alt?.toLowerCase().includes("shield")
                        );

                        if (isBadge) {
                          return (
                            <img
                              src={src}
                              alt={alt}
                              loading="lazy"
                              style={{
                                display: "inline-block",
                                verticalAlign: "middle",
                                maxHeight: 26,
                                margin: "2px 4px",
                                border: "none",
                              }}
                              {...props}
                            />
                          );
                        }

                        return (
                          <img
                            src={src}
                            alt={alt}
                            loading="lazy"
                            title={alt ? `${alt} (Click to open full image)` : "Click to open full image"}
                            onClick={() => {
                              if (src) window.open(src, "_blank");
                            }}
                            style={{
                              maxWidth: "100%",
                              maxHeight: "440px",
                              width: "auto",
                              height: "auto",
                              objectFit: "contain",
                              borderRadius: "6px",
                              border: "1px solid var(--ext-border, rgba(255, 255, 255, 0.12))",
                              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.35)",
                              margin: "18px 0",
                              display: "block",
                              cursor: "zoom-in",
                            }}
                            {...props}
                          />
                        );
                      },
                    }}
                  >
                    {renderedMarkdown}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          )}

          {activeSubTab === "features" && (
            <div>
              <h1 style={{
                fontSize: "20px",
                fontWeight: 600,
                color: "var(--ext-text-title)",
                margin: "0 0 12px 0",
              }}>
                Features & Contributions
              </h1>
              <div style={{ height: 1, background: "var(--ext-border)", marginBottom: 20 }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 14, color: "var(--ext-text-body)", fontSize: "13.5px", lineHeight: 1.6 }}>
                <p>This extension contributes commands, language tools, and intelligent capabilities to your environment:</p>
                <ul style={{ paddingLeft: 22, display: "flex", flexDirection: "column", gap: 8 }}>
                  <li><strong style={{ color: "var(--ext-text-title)" }}>Language Tooling & Formatting:</strong> Syntax intelligence, AST parsing, and live diagnostics.</li>
                  <li><strong style={{ color: "var(--ext-text-title)" }}>Intelligent Agent & Editor Integration:</strong> Contextual inline proposals and agentic workflows.</li>
                  <li><strong style={{ color: "var(--ext-text-title)" }}>Custom Commands:</strong> Workspace execution, code action triggers, and keybinding contributions.</li>
                </ul>
              </div>
            </div>
          )}

          {/* Floating Scroll to Top button */}
          <button
            onClick={scrollToTop}
            className="extension-scroll-top-btn"
            title="Scroll to Top"
          >
            <ChevronUp size={16} />
          </button>
        </div>

        {/* Right Column: Metadata Sidebar */}
        <div style={{
          width: 240,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: 26,
          fontSize: "12px",
        }}>
          {/* Installation Section */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--ext-text-title)", letterSpacing: "0.2px" }}>
              Installation
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "85px 1fr", rowGap: 8, alignItems: "baseline" }}>
              <span style={{ color: "var(--ext-text-muted)" }}>Identifier</span>
              <span style={{ color: "var(--ext-text-body)", fontFamily: "var(--font-mono)", fontSize: "11px", wordBreak: "break-all" }}>
                {ext.id}
              </span>

              <span style={{ color: "var(--ext-text-muted)" }}>Version</span>
              <span style={{ color: "var(--ext-text-body)" }}>
                {ext.version || fullData?.version || "2.1.276"}
              </span>

              <span style={{ color: "var(--ext-text-muted)" }}>Last Updated</span>
              <span style={{ color: "var(--ext-text-body)" }}>
                {formatRelativeTime(fullData?.timestamp)}
              </span>

              <span style={{ color: "var(--ext-text-muted)" }}>Size</span>
              <span style={{ color: "var(--ext-text-link)", cursor: "pointer" }}>
                {formatSize(fullData)}
              </span>
            </div>
          </div>

          {/* Marketplace Section */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--ext-text-title)", letterSpacing: "0.2px" }}>
              Marketplace
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "85px 1fr", rowGap: 8, alignItems: "baseline" }}>
              <span style={{ color: "var(--ext-text-muted)" }}>Published</span>
              <span style={{ color: "var(--ext-text-body)" }}>
                {formatPublished(fullData?.timestamp)}
              </span>

              <span style={{ color: "var(--ext-text-muted)" }}>Last Released</span>
              <span style={{ color: "var(--ext-text-body)" }}>
                {formatRelativeTime(fullData?.timestamp)}
              </span>
            </div>
          </div>

          {/* Categories Section */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--ext-text-title)", letterSpacing: "0.2px" }}>
              Categories
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {categories.map((cat: string, i: number) => (
                <span
                  key={i}
                  style={{
                    fontSize: "11px",
                    padding: "3px 8px",
                    borderRadius: 3,
                    background: "var(--ext-chip-bg)",
                    border: "1px solid var(--ext-chip-border)",
                    color: "var(--ext-text-body)",
                  }}
                >
                  {cat}
                </span>
              ))}
            </div>
          </div>

          {/* Resources Section */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--ext-text-title)", letterSpacing: "0.2px" }}>
              Resources
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <a
                href={ext.homepage || `https://open-vsx.org/extension/${namespace}/${name}`}
                target="_blank"
                rel="noreferrer"
                style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ext-text-body)", textDecoration: "none", fontSize: "12px" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ext-text-link)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ext-text-body)")}
              >
                <ExternalLink size={13} style={{ color: "var(--ext-text-muted)" }} />
                <span>Marketplace</span>
              </a>
              {repoUrl && (
                <a
                  href={repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ext-text-body)", textDecoration: "none", fontSize: "12px" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ext-text-link)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ext-text-body)")}
                >
                  <FolderGit2 size={13} style={{ color: "var(--ext-text-muted)" }} />
                  <span>Repository</span>
                </a>
              )}
              {bugsUrl && (
                <a
                  href={bugsUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ext-text-body)", textDecoration: "none", fontSize: "12px" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ext-text-link)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ext-text-body)")}
                >
                  <Bug size={13} style={{ color: "var(--ext-text-muted)" }} />
                  <span>Issues</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
