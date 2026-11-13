import { useState, useEffect, useCallback } from "react";
import { 
  Search, 
  Download, 
  ShieldCheck, 
  RotateCw, 
  Puzzle, 
  X,
  ChevronDown,
  ChevronRight, 
  Filter,
  Settings
} from "lucide-react";
import { ClaudeIcon } from "./ClaudeIcon";
import { plugins as ipcPlugins } from "../services/ipc";
import { CustomDialog } from "./GlobalDialog";

export interface ExtensionMetadata {
  id: string; // namespace.name
  namespace: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  downloadCount: number;
  averageRating?: number;
  reviewCount?: number;
  iconUrl?: string;
  downloadUrl?: string;
  verified?: boolean;
  homepage?: string;
  repository?: string;
  tags?: string[];
  installed?: boolean;
  enabled?: boolean;
  installedAt?: number;
}

interface ExtensionsPanelProps {
  onOpenExtension?: (ext: ExtensionMetadata) => void;
  activeExtensionId?: string | null;
}

export function ExtensionsPanel({ onOpenExtension, activeExtensionId }: ExtensionsPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [extensions, setExtensions] = useState<ExtensionMetadata[]>([]);
  const [installedList, setInstalledList] = useState<ExtensionMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const [installedExpanded, setInstalledExpanded] = useState(true);
  const [marketplaceExpanded, setMarketplaceExpanded] = useState(true);

  // Sync installed extensions from local backend
  const loadInstalled = useCallback(async () => {
    try {
      const res: any = await ipcPlugins.getInstalledExtensions();
      if (res?.data?.extensions && Array.isArray(res.data.extensions)) {
        setInstalledList(res.data.extensions);
      }
    } catch (e) {
      console.error("Failed to load installed extensions:", e);
    }
  }, []);

  useEffect(() => {
    void loadInstalled();
    const handleChanged = () => {
      void loadInstalled();
    };
    window.addEventListener("csotic:extensions-changed", handleChanged);
    return () => {
      window.removeEventListener("csotic:extensions-changed", handleChanged);
    };
  }, [loadInstalled]);

  // Sync installed flag in marketplace list whenever installedList changes
  useEffect(() => {
    setExtensions((prev) =>
      prev.map((item) => {
        const isInst = installedList.some((inst) => inst.id?.toLowerCase() === item.id?.toLowerCase());
        return item.installed !== isInst ? { ...item, installed: isInst } : item;
      })
    );
  }, [installedList]);

  // Fetch extensions from Open VSX registry
  const fetchMarketplace = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const q = query.trim();
      let url = "https://open-vsx.org/api/-/search?size=50";
      if (q) {
        url += `&query=${encodeURIComponent(q)}`;
      } else {
        url += "&sortBy=downloadCount&sortOrder=desc";
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error(`Registry responded with status ${res.status}`);
      const data = await res.json();

      const items: ExtensionMetadata[] = (data.extensions || []).map((ext: any) => {
        const id = `${ext.namespace}.${ext.name}`;
        const isInstalled = installedList.some((inst) => inst.id?.toLowerCase() === id.toLowerCase());
        return {
          id,
          namespace: ext.namespace,
          name: ext.name,
          displayName: ext.displayName || ext.name,
          description: ext.description || "No description provided.",
          version: ext.version || "1.0.0",
          downloadCount: ext.downloadCount || 0,
          averageRating: ext.averageRating || 0,
          reviewCount: ext.reviewCount || 0,
          iconUrl: ext.files?.icon || undefined,
          downloadUrl: ext.files?.download || undefined,
          verified: ext.verified || false,
          homepage: ext.url || undefined,
          tags: ext.tags || [],
          installed: isInstalled,
          enabled: true,
        };
      });

      setExtensions(items);
    } catch (err: any) {
      console.error("Error fetching extensions:", err);
      setError(err?.message || "Failed to load extensions from registry.");
    } finally {
      setLoading(false);
    }
  }, [installedList]);

  // Debounced search
  useEffect(() => {
    const handler = setTimeout(() => {
      void fetchMarketplace(searchQuery);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery, fetchMarketplace]);

  const handleInstall = async (ext: ExtensionMetadata, e: React.MouseEvent) => {
    e.stopPropagation();
    const lowerId = ext.id.toLowerCase();
    setInstallingIds((prev) => new Set(prev).add(lowerId));
    try {
      const res = await ipcPlugins.installExtension({
        id: ext.id,
        download_url: ext.downloadUrl || "",
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
        console.error("Installation failed on backend:", res.error);
        await CustomDialog.alert(`Failed to install ${ext.displayName}: ${res.error?.message || "Unknown error"}`, "Installation Failed");
        return;
      }

      const updated: ExtensionMetadata = {
        ...ext,
        installed: true,
        enabled: true,
        installedAt: Date.now(),
      };

      setInstalledList((prev) => [updated, ...prev.filter((p) => p.id?.toLowerCase() !== lowerId)]);
      setExtensions((prev) =>
        prev.map((item) => (item.id?.toLowerCase() === lowerId ? { ...item, installed: true } : item))
      );
      window.dispatchEvent(new CustomEvent("csotic:extensions-changed", { detail: { id: ext.id, action: "install" } }));
    } catch (err: any) {
      console.error("Installation failed:", err);
    } finally {
      setInstallingIds((prev) => {
        const next = new Set(prev);
        next.delete(lowerId);
        next.delete(ext.id);
        return next;
      });
    }
  };

  const filteredInstalled = searchQuery.trim()
    ? installedList.filter(
        (ext) =>
          ext.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          ext.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
          ext.namespace.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : installedList;

  const renderExtensionItem = (ext: ExtensionMetadata) => {
    const isInstalled = installedList.some((inst) => inst.id?.toLowerCase() === ext.id?.toLowerCase());
    const isInstalling = installingIds.has(ext.id) || installingIds.has(ext.id?.toLowerCase());
    const isSelected = activeExtensionId === ext.id;

    return (
      <div
        key={ext.id}
        onClick={() => onOpenExtension?.(ext)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "6px 10px",
          cursor: "pointer",
          background: isSelected ? "var(--color-item-active, rgba(255,255,255,0.08))" : "transparent",
          borderLeft: isSelected ? "2px solid var(--ext-accent, #be123c)" : "2px solid transparent",
          userSelect: "none",
          transition: "background 0.1s ease",
        }}
        onMouseEnter={(e) => {
          if (!isSelected) e.currentTarget.style.background = "var(--color-item-hover, rgba(255,255,255,0.04))";
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.background = "transparent";
        }}
      >
        {/* Icon (32x32) */}
        <div style={{
          width: 32,
          height: 32,
          borderRadius: 4,
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
          ) : (ext.id?.toLowerCase().includes("claude") || ext.displayName?.toLowerCase().includes("claude")) ? (
            <ClaudeIcon size={20} />
          ) : (
            <Puzzle size={16} style={{ color: "#ef4444", opacity: 0.8 }} />
          )}
        </div>

        {/* Text Details (Title, 1-line description, Publisher) */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <div style={{
            fontWeight: 600,
            fontSize: "12px",
            color: "var(--color-text-primary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>
            {ext.displayName}
          </div>

          <div style={{
            fontSize: "10.5px",
            color: "var(--color-text-tertiary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            lineHeight: 1.2,
          }}>
            {ext.description}
          </div>

          <div style={{
            fontSize: "10px",
            color: "var(--color-text-tertiary)",
            display: "flex",
            alignItems: "center",
            gap: 4,
            marginTop: 1,
          }}>
            {ext.verified && <ShieldCheck size={11} style={{ color: "#38bdf8", flexShrink: 0 }} />}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {ext.namespace}
            </span>
          </div>
        </div>

        {/* Right Action: Gear when installed, or Install button when not */}
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
          {isInstalled ? (
            <button
              onClick={() => onOpenExtension?.(ext)}
              title="Manage extension"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--color-text-tertiary)",
                cursor: "pointer",
                padding: "4px",
                borderRadius: 3,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-text-primary)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-text-tertiary)")}
            >
              <Settings size={13} />
            </button>
          ) : (
            <button
              onClick={(e) => handleInstall(ext, e)}
              disabled={isInstalling}
              className="ext-primary-btn"
              style={{
                height: 20,
                padding: "0 8px",
                fontSize: "10px",
                fontWeight: 600,
                borderRadius: 3,
                border: "none",
                background: "var(--ext-btn-bg, #be123c)",
                color: "#ffffff",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 3,
                whiteSpace: "nowrap",
              }}
            >
              {isInstalling ? (
                <RotateCw size={9} className="animate-spin" />
              ) : (
                <Download size={9} />
              )}
              <span>Install</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      width: "100%",
      background: "var(--color-bg-base)",
      overflow: "hidden",
      fontSize: "12px",
    }}>
      {/* Header with Search and Filter Icon */}
      <div style={{
        padding: "8px 10px",
        borderBottom: "1px solid var(--color-border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        background: "var(--color-bg-surface)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: "var(--color-text-secondary)" }}>
            Extensions
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              className="btn btn--icon"
              onClick={() => {
                void loadInstalled();
                void fetchMarketplace(searchQuery);
              }}
              title="Refresh Marketplace"
              style={{ width: 22, height: 22, padding: 0 }}
            >
              <RotateCw size={12} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <Search size={12} style={{ position: "absolute", left: 7, color: "var(--color-text-tertiary)" }} />
          <input
            type="text"
            className="input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Extensions in Marketplace..."
            style={{
              width: "100%",
              padding: "4px 22px 4px 24px",
              fontSize: "11px",
              borderRadius: 3,
              background: "var(--color-input-bg, var(--color-bg-base))",
              border: "1px solid var(--color-border-subtle)",
            }}
          />
          {searchQuery ? (
            <button
              onClick={() => setSearchQuery("")}
              style={{
                position: "absolute",
                right: 5,
                background: "transparent",
                border: "none",
                color: "var(--color-text-tertiary)",
                cursor: "pointer",
                padding: 0,
                display: "flex",
              }}
            >
              <X size={11} />
            </button>
          ) : (
            <Filter size={11} style={{ position: "absolute", right: 6, color: "var(--color-text-tertiary)", pointerEvents: "none" }} />
          )}
        </div>
      </div>

      {/* Main Collapsible Lists (Installed & Marketplace) */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
      }}>
        {/* ── 1. Installed Section ── */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            onClick={() => setInstalledExpanded((prev) => !prev)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "5px 10px",
              background: "rgba(255, 255, 255, 0.02)",
              borderBottom: "1px solid var(--color-border-subtle)",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "11px", fontWeight: 700, color: "var(--color-text-secondary)" }}>
              {installedExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span>Installed</span>
            </div>
            <span style={{
              fontSize: "10px",
              padding: "1px 6px",
              borderRadius: 10,
              background: "var(--ext-btn-bg, #be123c)",
              color: "#ffffff",
              fontWeight: 600,
            }}>
              {filteredInstalled.length}
            </span>
          </div>

          {installedExpanded && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {filteredInstalled.length === 0 ? (
                <div style={{ padding: "12px 14px", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                  No installed extensions.
                </div>
              ) : (
                filteredInstalled.map(renderExtensionItem)
              )}
            </div>
          )}
        </div>

        {/* ── 2. Marketplace Section ── */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: 4 }}>
          <div
            onClick={() => setMarketplaceExpanded((prev) => !prev)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "5px 10px",
              background: "rgba(255, 255, 255, 0.02)",
              borderTop: "1px solid var(--color-border-subtle)",
              borderBottom: "1px solid var(--color-border-subtle)",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "11px", fontWeight: 700, color: "var(--color-text-secondary)" }}>
              {marketplaceExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span>{searchQuery ? "Search Results" : "Popular"}</span>
            </div>
            {loading && <RotateCw size={11} className="animate-spin" style={{ color: "var(--color-text-tertiary)" }} />}
          </div>

          {marketplaceExpanded && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {error ? (
                <div style={{ padding: "12px", color: "#f87171", fontSize: "11px" }}>
                  {error}
                </div>
              ) : extensions.length === 0 && !loading ? (
                <div style={{ padding: "12px 14px", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                  No extensions found.
                </div>
              ) : (
                extensions.map(renderExtensionItem)
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
