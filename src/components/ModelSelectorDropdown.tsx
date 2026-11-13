import { useState, useRef, useEffect, useMemo } from "react";
import { ModelMetadata } from "../types/ipc";
export type { ModelMetadata };
import { 
  ChevronDown, 
  Search, 
  Check, 
  X, 
  Key 
} from "lucide-react";
import { getModelBrandLogo } from "./ModelBrandIcons";

export interface ModelSelectorDropdownProps {
  modelsList?: ModelMetadata[];
  activeModel: string | null;
  onSelectModel: (modelId: string) => void;
  onOpenSettings?: () => void;
  alignRight?: boolean;
  compact?: boolean;
  dropUp?: boolean;
  triggerStyle?: React.CSSProperties;
  maxHeight?: number | string;
}

export const DEFAULT_AI_MODELS: ModelMetadata[] = [
  {
    id: "anthropic/claude-3-7-sonnet",
    name: "Claude 3.7 Sonnet",
    provider: "anthropic",
    version: "3.7",
    context_window: 200000,
    status: "ready",
  },
  {
    id: "anthropic/claude-3-5-sonnet",
    name: "Claude 3.5 Sonnet",
    provider: "anthropic",
    version: "3.5",
    context_window: 200000,
    status: "ready",
  },
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    version: "4o",
    context_window: 128000,
    status: "ready",
  },
  {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    version: "4o-mini",
    context_window: 128000,
    status: "ready",
    is_free: true,
  },
  {
    id: "google/gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "gemini",
    version: "2.0",
    context_window: 1048576,
    status: "ready",
    is_free: true,
  },
  {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek V3",
    provider: "deepseek",
    version: "V3",
    context_window: 64000,
    status: "ready",
  },
  {
    id: "deepseek/deepseek-reasoner",
    name: "DeepSeek R1",
    provider: "deepseek",
    version: "R1",
    context_window: 64000,
    status: "ready",
  },
  {
    id: "ollama/qwen2.5-coder:7b",
    name: "Qwen 2.5 Coder 7B (Local)",
    provider: "ollama",
    version: "2.5",
    context_window: 32768,
    status: "ready",
    is_free: true,
  },
  {
    id: "ollama/llama3.3",
    name: "Llama 3.3 70B (Local)",
    provider: "ollama",
    version: "3.3",
    context_window: 131072,
    status: "ready",
    is_free: true,
  },
];

interface ProviderMeta {
  id: string;
  name: string;
  shortName: string;
  keyLabel: string;
  description: string;
  color: string;
  badgeBg: string;
  icon: string;
  freeTier: boolean;
}

const PROVIDER_METAS: Record<string, ProviderMeta> = {
  openrouter: {
    id: "openrouter",
    name: "OpenRouter Universal",
    shortName: "OpenRouter",
    keyLabel: "OpenRouter API Key (sk-or-...)",
    description: "Gateway providing 200+ frontier models, free cloud router, and top tier LLMs.",
    color: "#a855f7",
    badgeBg: "rgba(168, 85, 247, 0.15)",
    icon: "🟣",
    freeTier: true,
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    shortName: "Gemini",
    keyLabel: "Google AI Studio Key (AIza...)",
    description: "Gemini 2.0 Flash, 1.5 Pro & Thinking Exp with massive 1M-2M context.",
    color: "#38bdf8",
    badgeBg: "rgba(56, 189, 248, 0.15)",
    icon: "🔵",
    freeTier: true,
  },
  groq: {
    id: "groq",
    name: "Groq Cloud",
    shortName: "Groq",
    keyLabel: "Groq Cloud Key (gsk_...)",
    description: "Ultra-fast LPUs providing LLaMA 3.3 70B, Qwen 2.5 Coder & Mixtral.",
    color: "#f97316",
    badgeBg: "rgba(249, 115, 22, 0.15)",
    icon: "🟠",
    freeTier: true,
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    shortName: "OpenAI",
    keyLabel: "OpenAI API Key (sk-...)",
    description: "Official OpenAI GPT-4o, GPT-4o-mini, o1-preview & reasoning models.",
    color: "#10a37f",
    badgeBg: "rgba(16, 163, 127, 0.15)",
    icon: "🟢",
    freeTier: false,
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic Claude",
    shortName: "Anthropic",
    keyLabel: "Anthropic Key (sk-ant-...)",
    description: "Direct Claude 3.5 Sonnet, Claude 3.5 Haiku, and Claude 3 Opus.",
    color: "#d97706",
    badgeBg: "rgba(217, 119, 6, 0.15)",
    icon: "🟤",
    freeTier: false,
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    shortName: "DeepSeek",
    keyLabel: "DeepSeek Key (sk-...)",
    description: "DeepSeek V3 Chat, DeepSeek R1 Reasoning & Coder V2.",
    color: "#3b82f6",
    badgeBg: "rgba(59, 130, 246, 0.15)",
    icon: "🔷",
    freeTier: false,
  },
  ollama: {
    id: "ollama",
    name: "Local Ollama",
    shortName: "Local",
    keyLabel: "Local Offline (No Key Needed)",
    description: "Models running 100% privately and offline on your local hardware.",
    color: "#a3a3a3",
    badgeBg: "rgba(163, 163, 163, 0.15)",
    icon: "💻",
    freeTier: true,
  },
  custom: {
    id: "custom",
    name: "Custom Endpoints",
    shortName: "Custom",
    keyLabel: "Custom Base URL & Key",
    description: "Custom OpenAI-compatible API endpoints configured in Settings.",
    color: "#ec4899",
    badgeBg: "rgba(236, 72, 153, 0.15)",
    icon: "🔧",
    freeTier: false,
  },
};

export function ModelSelectorDropdown({
  modelsList,
  activeModel,
  onSelectModel,
  onOpenSettings,
  alignRight = false,
  compact = false,
  dropUp = false,
  triggerStyle,
  maxHeight,
}: ModelSelectorDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeProviderFilter, setActiveProviderFilter] = useState<string>("all");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const selectedModelRef = useRef<HTMLDivElement>(null);

  // Fallback to rich curated default models if modelsList is empty
  const effectiveModels = useMemo(() => {
    if (modelsList && modelsList.length > 0) return modelsList;
    return DEFAULT_AI_MODELS;
  }, [modelsList]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      setTimeout(() => searchInputRef.current?.focus(), 50);
      setTimeout(() => {
        selectedModelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }, 100);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Keyboard navigation & Esc to close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Find active model object
  const currentModel = useMemo(() => {
    return effectiveModels.find((m) => m.id === activeModel) || null;
  }, [effectiveModels, activeModel]);

  // Clean and format model name
  const formatModelName = (name: string) => {
    return name
      .replace(/\[FREE\]/gi, "")
      .replace(/\[FREE TIER\]/gi, "")
      .replace(/\(ollama\)/gi, "")
      .replace(/\(openrouter\)/gi, "")
      .replace(/\(gemini\)/gi, "")
      .replace(/\(groq\)/gi, "")
      .replace(/\(anthropic\)/gi, "")
      .replace(/\(openai\)/gi, "")
      .replace(/\(deepseek\)/gi, "")
      .trim();
  };

  // Calculate counts per provider
  const providerCounts = useMemo(() => {
    const counts: Record<string, number> = { all: effectiveModels.length, free: 0 };
    for (const m of effectiveModels) {
      const p = m.provider || "other";
      counts[p] = (counts[p] || 0) + 1;
      const isFree = m.provider === "ollama" || m.is_free || m.name.includes("FREE") || m.id.endsWith(":free");
      if (isFree) counts.free = (counts.free || 0) + 1;
    }
    return counts;
  }, [effectiveModels]);

  // Providers list present in effectiveModels
  const availableProviders = useMemo(() => {
    const provs = new Set(effectiveModels.map((m) => m.provider));
    return Object.keys(PROVIDER_METAS).filter((p) => provs.has(p));
  }, [effectiveModels]);

  // Filter models based on search and active provider tab
  const filteredModels = useMemo(() => {
    let list = effectiveModels;

    if (activeProviderFilter === "free") {
      list = list.filter((m) => m.provider === "ollama" || m.is_free || m.name.includes("FREE") || m.id.endsWith(":free"));
    } else if (activeProviderFilter !== "all") {
      list = list.filter((m) => m.provider === activeProviderFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          m.provider.toLowerCase().includes(q)
      );
    }
    return list;
  }, [modelsList, activeProviderFilter, searchQuery]);

  // Group filtered models by provider for structured display
  const groupedByProvider = useMemo(() => {
    const groups: { provider: string; meta: ProviderMeta; models: ModelMetadata[] }[] = [];
    const providerOrder = ["openrouter", "gemini", "groq", "openai", "anthropic", "deepseek", "ollama", "custom"];
    
    // Put ordered providers first
    for (const p of providerOrder) {
      const provModels = filteredModels.filter((m) => m.provider === p);
      if (provModels.length > 0) {
        const meta = PROVIDER_METAS[p] || {
          id: p,
          name: p.toUpperCase(),
          shortName: p,
          keyLabel: `${p} API Key`,
          description: `Models provided by ${p}`,
          color: "#94a3b8",
          badgeBg: "rgba(148, 163, 184, 0.15)",
          icon: "🔑",
          freeTier: false,
        };
        groups.push({ provider: p, meta, models: provModels });
      }
    }

    // Add any remaining providers
    const otherModels = filteredModels.filter((m) => !providerOrder.includes(m.provider));
    if (otherModels.length > 0) {
      groups.push({
        provider: "other",
        meta: {
          id: "other",
          name: "Other Providers",
          shortName: "Other",
          keyLabel: "API Key",
          description: "Other connected models",
          color: "#94a3b8",
          badgeBg: "rgba(148, 163, 184, 0.15)",
          icon: "🌐",
          freeTier: false,
        },
        models: otherModels,
      });
    }

    return groups;
  }, [filteredModels]);

  const displayName = currentModel ? formatModelName(currentModel.name) : (activeModel ? formatModelName(activeModel) : "Select AI Model");
  const isCurrentFree = currentModel ? (currentModel.is_free || currentModel.name.includes("FREE") || currentModel.id.endsWith(":free") || currentModel.provider === "ollama") : false;
  const currentProvider = currentModel?.provider || "ai";
  const currentModelId = currentModel?.id || activeModel || "";
  const currentMeta = PROVIDER_METAS[currentProvider];

  return (
    <div ref={dropdownRef} style={{ position: "relative", display: "inline-block" }}>
      {/* Sleek Trigger Pill */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: compact ? 5 : 7,
          height: compact ? 24 : 28,
          padding: compact ? "0 7px 0 6px" : "0 10px 0 8px",
          background: isOpen 
            ? "rgba(239, 68, 68, 0.18)" 
            : (!activeModel ? "rgba(239, 68, 68, 0.12)" : "rgba(255, 255, 255, 0.04)"),
          border: isOpen 
            ? "1px solid rgba(239, 68, 68, 0.55)" 
            : (!activeModel ? "1px solid rgba(239, 68, 68, 0.45)" : "1px solid rgba(255, 255, 255, 0.08)"),
          borderRadius: 6,
          color: !activeModel ? "#fca5a5" : "var(--color-text-primary)",
          fontSize: compact ? "11px" : "11.5px",
          fontWeight: 500,
          cursor: "pointer",
          transition: "all 0.15s ease",
          maxWidth: compact ? 180 : 240,
          boxShadow: (!activeModel || isOpen) ? "0 0 10px rgba(239, 68, 68, 0.2)" : "none",
          ...triggerStyle,
        }}
        title={`Active Model: ${displayName} (Key: ${currentMeta?.keyLabel || currentProvider})`}
      >
        {/* Model Brand Logo */}
        <div style={{ width: compact ? 13 : 16, height: compact ? 13 : 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {getModelBrandLogo(currentModelId, displayName, currentProvider, compact ? 12 : 15)}
        </div>

        {/* Model Label */}
        <span
          style={{
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: compact ? 110 : 130,
            textAlign: "left",
            fontWeight: 600,
            color: !activeModel ? "#fca5a5" : "var(--color-text-primary)",
          }}
        >
          {displayName}
        </span>

        {/* Free Tag Pill */}
        {isCurrentFree && !compact && (
          <span
            style={{
              fontSize: "9px",
              fontWeight: 700,
              padding: "1px 4px",
              borderRadius: 3,
              background: "rgba(16, 185, 129, 0.15)",
              color: "#34d399",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            FREE
          </span>
        )}

        {/* Rotating Chevron */}
        <ChevronDown
          size={11}
          style={{
            opacity: 0.6,
            marginLeft: "auto",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
            flexShrink: 0,
          }}
        />
      </button>

      {/* Glassmorphic Dropdown Menu */}
      {isOpen && (
        <div
          className="animate-pop-in"
          style={{
            position: "absolute",
            top: dropUp ? "auto" : "calc(100% + 6px)",
            bottom: dropUp ? "calc(100% + 6px)" : "auto",
            right: alignRight ? 0 : "auto",
            left: alignRight ? "auto" : 0,
            width: compact ? 320 : 360,
            maxWidth: "calc(100vw - 24px)",
            maxHeight: maxHeight ?? (dropUp ? "min(480px, calc(100vh - 160px))" : "min(520px, calc(100vh - 90px))"),
            background: "var(--color-modal-bg, #202024)",
            border: "1px solid var(--color-border-default, #2e2e34)",
            borderRadius: 8,
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.5)",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            overscrollBehavior: "contain",
          }}
        >
          {/* Top Bar: Search & Manage Keys Link */}
          <div
            style={{
              padding: "10px 10px 8px 10px",
              borderBottom: "1px solid rgba(255, 255, 255, 0.07)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              background: "rgba(255, 255, 255, 0.02)",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ position: "relative", display: "flex", alignItems: "center", flex: 1 }}>
                <Search size={13} style={{ position: "absolute", left: 9, opacity: 0.5, color: "var(--color-text-secondary)" }} />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search Gemini, Claude, GPT, LLaMA..."
                  style={{
                    width: "100%",
                    height: 28,
                    padding: "0 24px 0 28px",
                    background: "rgba(0, 0, 0, 0.5)",
                    border: "1px solid rgba(255, 255, 255, 0.09)",
                    borderRadius: 6,
                    color: "#ffffff",
                    fontSize: "11.5px",
                    outline: "none",
                  }}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    style={{ position: "absolute", right: 6, opacity: 0.6, cursor: "pointer", display: "flex" }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {onOpenSettings && (
                <button
                  onClick={() => {
                    setIsOpen(false);
                    onOpenSettings();
                  }}
                  title="Configure API Keys in Settings"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    height: 28,
                    padding: "0 8px",
                    background: "rgba(255, 255, 255, 0.06)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: 6,
                    color: "var(--color-text-secondary)",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#ffffff";
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.12)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--color-text-secondary)";
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)";
                  }}
                >
                  <Key size={11} style={{ color: "#ef4444" }} />
                  <span>Keys</span>
                </button>
              )}
            </div>

            {/* Provider Filter Tabs Bar with Key Badges */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 5,
                paddingBottom: 2,
              }}
            >
              {/* All tab */}
              <button
                onClick={() => setActiveProviderFilter("all")}
                style={{
                  padding: "3px 8px",
                  borderRadius: 5,
                  fontSize: "10.5px",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  background: activeProviderFilter === "all" ? "rgba(239, 68, 68, 0.22)" : "rgba(255, 255, 255, 0.04)",
                  color: activeProviderFilter === "all" ? "#f87171" : "var(--color-text-tertiary)",
                  border: activeProviderFilter === "all" ? "1px solid rgba(239, 68, 68, 0.4)" : "1px solid transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  transition: "all 0.12s ease",
                }}
              >
                <span>All</span>
                <span style={{ fontSize: "9.5px", opacity: 0.7 }}>({effectiveModels.length})</span>
              </button>

              {/* Free tab */}
              {providerCounts.free > 0 && (
                <button
                  onClick={() => setActiveProviderFilter("free")}
                  style={{
                    padding: "3px 8px",
                    borderRadius: 5,
                    fontSize: "10.5px",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    background: activeProviderFilter === "free" ? "rgba(16, 185, 129, 0.22)" : "rgba(255, 255, 255, 0.04)",
                    color: activeProviderFilter === "free" ? "#34d399" : "var(--color-text-tertiary)",
                    border: activeProviderFilter === "free" ? "1px solid rgba(16, 185, 129, 0.4)" : "1px solid transparent",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    transition: "all 0.12s ease",
                  }}
                >
                  <span>🎁 Free</span>
                  <span style={{ fontSize: "9.5px", opacity: 0.7 }}>({providerCounts.free})</span>
                </button>
              )}

              {/* Individual Provider Tabs */}
              {availableProviders.map((pId) => {
                const meta = PROVIDER_METAS[pId];
                if (!meta) return null;
                const count = providerCounts[pId] || 0;
                const isActive = activeProviderFilter === pId;

                return (
                  <button
                    key={pId}
                    onClick={() => setActiveProviderFilter(pId)}
                    style={{
                      padding: "3px 8px",
                      borderRadius: 5,
                      fontSize: "10.5px",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      background: isActive ? meta.badgeBg : "rgba(255, 255, 255, 0.04)",
                      color: isActive ? meta.color : "var(--color-text-tertiary)",
                      border: isActive ? `1px solid ${meta.color}66` : "1px solid transparent",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      transition: "all 0.12s ease",
                    }}
                  >
                    <span>{meta.icon}</span>
                    <span>{meta.shortName}</span>
                    <span style={{ fontSize: "9.5px", opacity: 0.7 }}>({count})</span>
                  </button>
                );
              })}
            </div>

            {/* Provider Key Specification Banner */}
            {activeProviderFilter !== "all" && activeProviderFilter !== "free" && PROVIDER_METAS[activeProviderFilter] && (
              <div
                style={{
                  background: "rgba(0, 0, 0, 0.35)",
                  border: `1px solid ${PROVIDER_METAS[activeProviderFilter].color}33`,
                  borderRadius: 6,
                  padding: "6px 8px",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 7,
                }}
              >
                <Key size={13} style={{ color: PROVIDER_METAS[activeProviderFilter].color, marginTop: 1, flexShrink: 0 }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: PROVIDER_METAS[activeProviderFilter].color }}>
                      {PROVIDER_METAS[activeProviderFilter].name} Key
                    </span>
                    <span style={{ fontSize: "9.5px", color: "var(--color-text-tertiary)" }}>
                      ({providerCounts[activeProviderFilter] || 0} models provided)
                    </span>
                  </div>
                  <span style={{ fontSize: "10px", color: "var(--color-text-secondary)", lineHeight: 1.3 }}>
                    {PROVIDER_METAS[activeProviderFilter].description}
                  </span>
                </div>
              </div>
            )}

            {activeProviderFilter === "all" && (
              <div
                style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                  borderRadius: 5,
                  padding: "4px 8px",
                  fontSize: "10px",
                  color: "var(--color-text-tertiary)",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <span>💡</span>
                <span>Click any provider tab above to see what models that specific API key provides.</span>
              </div>
            )}
          </div>

          {/* Model Items Scroll Area */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              padding: "6px 6px",
              overscrollBehavior: "contain",
            }}
          >
            {filteredModels.length === 0 ? (
              <div style={{ padding: "28px 12px", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "11.5px" }}>
                No matching models found
              </div>
            ) : (
              groupedByProvider.map((group) => (
                <div key={group.provider} style={{ marginBottom: 10 }}>
                  {/* Provider Key Group Section Header */}
                  <div
                    style={{
                      padding: "4px 8px 3px 8px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
                      marginBottom: 4,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span>{group.meta.icon}</span>
                      <span style={{ fontSize: "10.5px", fontWeight: 700, color: group.meta.color, letterSpacing: "0.3px" }}>
                        {group.meta.name}
                      </span>
                      <span
                        style={{
                          fontSize: "9px",
                          fontWeight: 600,
                          padding: "1px 5px",
                          borderRadius: 3,
                          background: group.meta.badgeBg,
                          color: group.meta.color,
                        }}
                      >
                        {group.provider === "ollama" ? "OFFLINE" : "API KEY"}
                      </span>
                    </div>

                    <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", fontWeight: 600 }}>
                      {group.models.length} {group.models.length === 1 ? "model" : "models"}
                    </span>
                  </div>

                  {/* Model Rows */}
                  {group.models.map((m) => renderModelRow(m, group.meta))}
                </div>
              ))
            )}
          </div>

          {/* Bottom Footer: Fast Key Management */}
          {onOpenSettings && (
            <div
              style={{
                padding: "6px 10px",
                borderTop: "1px solid rgba(255, 255, 255, 0.07)",
                background: "rgba(0, 0, 0, 0.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "10px", color: "var(--color-text-tertiary)" }}>
                <Key size={11} style={{ color: "#ef4444" }} />
                <span>Want to add or change an API key?</span>
              </div>
              <button
                onClick={() => {
                  setIsOpen(false);
                  onOpenSettings();
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#ef4444",
                  fontSize: "10.5px",
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: "2px 4px",
                  textDecoration: "underline",
                }}
              >
                Open Settings →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  function renderModelRow(m: ModelMetadata, meta: ProviderMeta) {
    const isSelected = activeModel === m.id;
    const isFree = m.provider === "ollama" || m.is_free || m.name.includes("FREE") || m.id.endsWith(":free");
    const formattedName = formatModelName(m.name);
    const contextK = m.context_window ? `${Math.round(m.context_window / 1000)}k` : "";

    return (
      <div
        key={m.id}
        ref={isSelected ? selectedModelRef : undefined}
        onClick={() => {
          onSelectModel(m.id);
          setIsOpen(false);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "7px 8px",
          borderRadius: 6,
          background: isSelected ? "rgba(239, 68, 68, 0.14)" : "transparent",
          border: isSelected ? "1px solid rgba(239, 68, 68, 0.35)" : "1px solid transparent",
          cursor: "pointer",
          transition: "all 0.12s ease",
          marginBottom: 2,
        }}
        onMouseEnter={(e) => {
          if (!isSelected) e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.background = "transparent";
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, overflow: "hidden", flex: 1 }}>
          {/* Brand Logo Container */}
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {getModelBrandLogo(m.id, m.name, m.provider, 15)}
          </div>

          {/* Model info */}
          <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
            <span
              style={{
                fontSize: "12px",
                fontWeight: isSelected ? 600 : 500,
                color: isSelected ? "#ef4444" : "var(--color-text-primary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {formattedName}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "10px", color: "var(--color-text-tertiary)" }}>
              <span style={{ color: meta.color, fontWeight: 500 }}>
                {meta.shortName}
              </span>
              {contextK && (
                <>
                  <span>·</span>
                  <span>{contextK} ctx</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right side: Free badge & checkmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: 8 }}>
          {isFree && (
            <span
              style={{
                fontSize: "9px",
                fontWeight: 700,
                padding: "1px 5px",
                borderRadius: 3,
                background: "rgba(16, 185, 129, 0.12)",
                color: "#34d399",
                border: "1px solid rgba(16, 185, 129, 0.25)",
                letterSpacing: "0.2px",
              }}
            >
              FREE
            </span>
          )}

          {isSelected && (
            <Check size={14} style={{ color: "#ef4444", strokeWidth: 2.5 }} />
          )}
        </div>
      </div>
    );
  }
}

