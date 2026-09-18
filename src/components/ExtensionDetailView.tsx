import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { 
  ShieldCheck, 
  Download, 
  Trash2, 
  Power, 
  RotateCw, 
  ExternalLink, 
  Star, 
  Puzzle, 
  FolderGit2, 
  Bug, 
} from "lucide-react";
import { ExtensionMetadata } from "./ExtensionsPanel";
import { plugins as ipcPlugins } from "../services/ipc";
import { CustomDialog } from "./GlobalDialog";

interface ExtensionDetailViewProps {
  extension: ExtensionMetadata;
  onInstallChange?: () => void;
}

export function ExtensionDetailView({ extension: initialExt, onInstallChange }: ExtensionDetailViewProps) {
  const [ext, setExt] = useState<ExtensionMetadata>(initialExt);
  const [activeSubTab, setActiveSubTab] = useState<"details" | "features" | "changelog">("details");
  const [readmeContent, setReadmeContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isInstalled, setIsInstalled] = useState(initialExt.installed || false);
  const [isEnabled, setIsEnabled] = useState(initialExt.enabled ?? true);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [fullData, setFullData] = useState<any>(initialExt);

  // Sync when prop changes
  useEffect(() => {
    setExt(initialExt);
    setIsInstalled(initialExt.installed || false);
    setIsEnabled(initialExt.enabled ?? true);
    setFullData(initialExt);
  }, [initialExt]);

  // Fetch live detailed metadata + README from Open VSX
  useEffect(() => {
    let mounted = true;
    const fetchOpenVsxDetails = async () => {
      setLoading(true);
      try {
        const detailRes = await fetch(`https://open-vsx.org/api/${ext.namespace}/${ext.name}`);
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
        console.warn("Could not fetch remote readme:", err);
      }
      if (mounted) {
        setReadmeContent(`# ${ext.displayName}\n\n${ext.description || "No detailed README provided by the extension publisher."}`);
        setLoading(false);
      }
    };

    fetchOpenVsxDetails();
    return () => { mounted = false; };
  }, [ext.namespace, ext.name, ext.displayName, ext.description]);

  const handleInstall = async () => {
    setIsInstalling(true);
    try {
      const res = await ipcPlugins.installExtension({
        id: ext.id,
        download_url: ext.downloadUrl || fullData?.files?.download || "",
        displayName: ext.displayName,
        description: ext.description,
        version: ext.version,
        namespace: ext.namespace,
        name: ext.name,
        iconUrl: ext.iconUrl,
        downloadCount: ext.downloadCount,
        averageRating: ext.averageRating,
        verified: ext.verified,
        homepage: ext.homepage,
      });

      if (!res.success) {
        console.error("Install failed on backend:", res.error);
        await CustomDialog.alert(`Failed to install ${ext.displayName}: ${res.error?.message || "Unknown error"}`, "Installation Failed");
        return;
      }

      setIsInstalled(true);
      setIsEnabled(true);
      onInstallChange?.();
    } catch (e: any) {
      console.error("Install failed:", e);
      await CustomDialog.alert(`Install failed: ${e?.message || "Unknown error"}`, "Installation Error");
    } finally {
      setIsInstalling(false);
    }
  };

  const handleUninstall = async () => {
    const confirmed = await CustomDialog.confirm(
      `Are you sure you want to uninstall "${ext.displayName}"?`,
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
    } catch (e: any) {
      console.error("Uninstall failed:", e);
      await CustomDialog.alert(`Uninstall failed: ${e?.message || "Unknown error"}`, "Uninstall Error");
    }
  };

  const handleToggleEnable = () => {
    setIsEnabled((prev) => !prev);
  };

  const categories = fullData?.categories || ext.tags || ["Programming Languages", "Tools"];
  const downloadCount = fullData?.downloadCount || ext.downloadCount || 0;
  const rating = fullData?.averageRating || ext.averageRating || 0;
  const reviewCount = fullData?.reviewCount || ext.reviewCount || 0;
  const repoUrl = fullData?.repository || ext.homepage;
  const bugsUrl = fullData?.bugs;

  return (
    <div style={{
      width: "100%",
      height: "100%",
      background: "var(--color-bg-base)",
      color: "var(--color-text-primary)",
      display: "flex",
      flexDirection: "column",
      overflowY: "auto",
      fontFamily: "var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
    }}>
      {/* Top Header Banner */}
      <div style={{
        padding: "24px 32px 18px",
        display: "flex",
        gap: 24,
        alignItems: "flex-start",
        borderBottom: "1px solid var(--color-border-subtle)",
        background: "var(--color-bg-surface)",
      }}>
        {/* Big Icon */}
        <div style={{
          width: 72,
          height: 72,
          borderRadius: 10,
          background: "rgba(255, 255, 255, 0.05)",
          border: "1px solid var(--color-border-subtle)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          overflow: "hidden",
        }}>
          {ext.iconUrl ? (
            <img
              src={ext.iconUrl}
              alt={ext.displayName}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={(e) => {
                (e.target as HTMLElement).style.display = "none";
              }}
            />
          ) : (
            <Puzzle size={40} style={{ color: "#ef4444" }} />
          )}
        </div>

        {/* Title, Publisher, Ratings & Actions */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: "22px", fontWeight: 700, margin: 0, color: "var(--color-text-primary)" }}>
              {ext.displayName}
            </h1>
            <span style={{
              fontSize: "11px",
              padding: "2px 7px",
              borderRadius: 4,
              background: "rgba(255, 255, 255, 0.08)",
              color: "var(--color-text-tertiary)",
              fontWeight: 500,
            }}>
              v{ext.version}
            </span>
          </div>

          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: "12px",
            color: "var(--color-text-secondary)",
            flexWrap: "wrap",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "#38bdf8", fontWeight: 600 }}>{ext.namespace}</span>
              {ext.verified && (
                <span title="Verified Publisher" style={{ display: "inline-flex" }}>
                  <ShieldCheck size={13} style={{ color: "#38bdf8" }} />
                </span>
              )}
            </div>

            <span style={{ opacity: 0.4 }}>|</span>

            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Download size={12} style={{ color: "var(--color-text-tertiary)" }} />
              <span>{downloadCount.toLocaleString()}</span>
            </div>

            <span style={{ opacity: 0.4 }}>|</span>

            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ display: "flex", color: "#f59e0b" }}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star
                    key={i}
                    size={12}
                    fill={i <= Math.round(rating) ? "#f59e0b" : "transparent"}
                    stroke="#f59e0b"
                  />
                ))}
              </div>
              {reviewCount > 0 && <span>({reviewCount})</span>}
            </div>
          </div>

          <p style={{
            margin: "4px 0 10px",
            fontSize: "13px",
            color: "var(--color-text-secondary)",
            lineHeight: 1.4,
          }}>
            {ext.description}
          </p>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {isInstalled ? (
              <>
                <button
                  onClick={handleToggleEnable}
                  className="btn btn--secondary"
                  style={{
                    fontSize: "12px",
                    height: 28,
                    padding: "0 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Power size={13} style={{ color: isEnabled ? "#34d399" : "var(--color-text-tertiary)" }} />
                  <span>{isEnabled ? "Disable" : "Enable"}</span>
                </button>

                <button
                  onClick={handleUninstall}
                  className="btn btn--secondary"
                  style={{
                    fontSize: "12px",
                    height: 28,
                    padding: "0 14px",
                    color: "#f87171",
                    borderColor: "rgba(239, 68, 68, 0.3)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Trash2 size={13} />
                  <span>Uninstall</span>
                </button>
              </>
            ) : (
              <button
                onClick={handleInstall}
                disabled={isInstalling}
                className="btn btn--primary"
                style={{
                  fontSize: "12px",
                  height: 28,
                  padding: "0 18px",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "#0078d4",
                  borderColor: "#0078d4",
                }}
              >
                {isInstalling ? (
                  <>
                    <RotateCw size={13} className="animate-spin" />
                    <span>Installing...</span>
                  </>
                ) : (
                  <>
                    <Download size={13} />
                    <span>Install</span>
                  </>
                )}
              </button>
            )}

            {ext.downloadUrl && (
              <a
                href={ext.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn--secondary"
                style={{
                  fontSize: "12px",
                  height: 28,
                  padding: "0 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  textDecoration: "none",
                }}
              >
                <Download size={13} />
                <span>Download .VSIX</span>
              </a>
            )}

            <label style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: "12px",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
              marginLeft: 8,
              userSelect: "none",
            }}>
              <input
                type="checkbox"
                checked={autoUpdate}
                onChange={(e) => setAutoUpdate(e.target.checked)}
                style={{ cursor: "pointer", accentColor: "#0078d4" }}
              />
              <span>Auto Update</span>
            </label>
          </div>
        </div>
      </div>

      {/* Sub Navigation Tabs */}
      <div style={{
        padding: "0 32px",
        display: "flex",
        gap: 20,
        borderBottom: "1px solid var(--color-border-subtle)",
        background: "var(--color-bg-surface)",
      }}>
        <button
          onClick={() => setActiveSubTab("details")}
          style={{
            padding: "10px 0",
            fontSize: "12px",
            fontWeight: activeSubTab === "details" ? 600 : 500,
            color: activeSubTab === "details" ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
            background: "transparent",
            border: "none",
            borderBottom: activeSubTab === "details" ? "2px solid #0078d4" : "2px solid transparent",
            cursor: "pointer",
            letterSpacing: "0.5px",
            textTransform: "uppercase",
          }}
        >
          Details
        </button>

        <button
          onClick={() => setActiveSubTab("features")}
          style={{
            padding: "10px 0",
            fontSize: "12px",
            fontWeight: activeSubTab === "features" ? 600 : 500,
            color: activeSubTab === "features" ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
            background: "transparent",
            border: "none",
            borderBottom: activeSubTab === "features" ? "2px solid #0078d4" : "2px solid transparent",
            cursor: "pointer",
            letterSpacing: "0.5px",
            textTransform: "uppercase",
          }}
        >
          Features
        </button>

        <button
          onClick={() => setActiveSubTab("changelog")}
          style={{
            padding: "10px 0",
            fontSize: "12px",
            fontWeight: activeSubTab === "changelog" ? 600 : 500,
            color: activeSubTab === "changelog" ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
            background: "transparent",
            border: "none",
            borderBottom: activeSubTab === "changelog" ? "2px solid #0078d4" : "2px solid transparent",
            cursor: "pointer",
            letterSpacing: "0.5px",
            textTransform: "uppercase",
          }}
        >
          Changelog
        </button>
      </div>

      {/* Main Two-Column Body Content */}
      <div style={{
        flex: 1,
        display: "flex",
        padding: "24px 32px",
        gap: 36,
      }}>
        {/* Left Column: Markdown Details / Readme */}
        <div style={{
          flex: 1,
          minWidth: 0,
          fontSize: "13.5px",
          lineHeight: 1.6,
          color: "var(--color-text-secondary)",
        }}>
          {activeSubTab === "details" && (
            loading && !readmeContent ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--color-text-tertiary)", padding: "40px 0" }}>
                <RotateCw size={18} className="animate-spin" />
                <span>Loading extension documentation...</span>
              </div>
            ) : readmeContent ? (
              <div className="markdown-body" style={{ color: "inherit" }}>
                <ReactMarkdown>{readmeContent}</ReactMarkdown>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <h2 style={{ color: "var(--color-text-primary)", fontSize: "18px", margin: 0 }}>
                  {ext.displayName} for Forge & VS Code
                </h2>
                <p>{ext.description}</p>
                <div style={{
                  padding: "16px",
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid var(--color-border-subtle)",
                  borderRadius: 6,
                }}>
                  <h4 style={{ margin: "0 0 8px", color: "var(--color-text-primary)" }}>Overview</h4>
                  <p style={{ margin: 0, fontSize: "13px" }}>
                    This extension provides language tooling, IntelliSense, formatters, and enhancements for {ext.displayName}.
                  </p>
                </div>
              </div>
            )
          )}

          {activeSubTab === "features" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h3 style={{ color: "var(--color-text-primary)", margin: 0 }}>Contributed Features</h3>
              <ul style={{ paddingLeft: 20, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <li>IntelliSense & Syntax Highlighting for {ext.displayName}</li>
                <li>Code Completion & Parameter Hints</li>
                <li>Formatting and Diagnostics</li>
                <li>Custom Commands & Keybindings</li>
              </ul>
            </div>
          )}

          {activeSubTab === "changelog" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h3 style={{ color: "var(--color-text-primary)", margin: 0 }}>Version {ext.version}</h3>
              <p>Release updates and enhancements for {ext.displayName} v{ext.version}.</p>
            </div>
          )}
        </div>

        {/* Right Column: Metadata Sidebar */}
        <div style={{
          width: 220,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: 22,
          borderLeft: "1px solid var(--color-border-subtle)",
          paddingLeft: 24,
          fontSize: "12px",
        }}>
          {/* Installation Section */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontWeight: 700, textTransform: "uppercase", fontSize: "11px", letterSpacing: "0.5px", color: "var(--color-text-primary)" }}>
              Installation
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div>
                <span style={{ color: "var(--color-text-tertiary)" }}>Identifier: </span>
                <span style={{ color: "var(--color-text-secondary)", wordBreak: "break-all" }}>{ext.id}</span>
              </div>
              <div>
                <span style={{ color: "var(--color-text-tertiary)" }}>Version: </span>
                <span style={{ color: "var(--color-text-secondary)" }}>{ext.version}</span>
              </div>
              {fullData?.timestamp && (
                <div>
                  <span style={{ color: "var(--color-text-tertiary)" }}>Last Updated: </span>
                  <span style={{ color: "var(--color-text-secondary)" }}>
                    {new Date(fullData.timestamp).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Marketplace Section */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontWeight: 700, textTransform: "uppercase", fontSize: "11px", letterSpacing: "0.5px", color: "var(--color-text-primary)" }}>
              Marketplace
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div>
                <span style={{ color: "var(--color-text-tertiary)" }}>Downloads: </span>
                <span style={{ color: "var(--color-text-secondary)", fontWeight: 600 }}>{downloadCount.toLocaleString()}</span>
              </div>
              <div>
                <span style={{ color: "var(--color-text-tertiary)" }}>Rating: </span>
                <span style={{ color: "#f59e0b", fontWeight: 600 }}>{rating ? rating.toFixed(1) : "N/A"} / 5</span>
              </div>
            </div>
          </div>

          {/* Categories */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontWeight: 700, textTransform: "uppercase", fontSize: "11px", letterSpacing: "0.5px", color: "var(--color-text-primary)" }}>
              Categories
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {categories.map((cat: string, i: number) => (
                <span
                  key={i}
                  style={{
                    fontSize: "10.5px",
                    padding: "2px 8px",
                    borderRadius: 3,
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid var(--color-border-subtle)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  {cat}
                </span>
              ))}
            </div>
          </div>

          {/* Resources Links */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontWeight: 700, textTransform: "uppercase", fontSize: "11px", letterSpacing: "0.5px", color: "var(--color-text-primary)" }}>
              Resources
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {repoUrl && (
                <a
                  href={repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 6, color: "#38bdf8", textDecoration: "none" }}
                >
                  <FolderGit2 size={13} />
                  <span>Repository</span>
                </a>
              )}
              {bugsUrl && (
                <a
                  href={bugsUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 6, color: "#38bdf8", textDecoration: "none" }}
                >
                  <Bug size={13} />
                  <span>Issues</span>
                </a>
              )}
              {ext.homepage && (
                <a
                  href={ext.homepage}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 6, color: "#38bdf8", textDecoration: "none" }}
                >
                  <ExternalLink size={13} />
                  <span>Marketplace Page</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
