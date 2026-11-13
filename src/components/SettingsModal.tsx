import { useState, useEffect } from "react";
import { system, models } from "../services/ipc";
import { ModelMetadata } from "../types/ipc";
import { Plus, Trash2, CheckCircle, AlertCircle, Key, Server, Cpu, Palette, Database, Globe, BookOpen, Sparkles, Eye, EyeOff, X, User, Cloud, ShieldCheck, LogOut } from "lucide-react";
import type { AuthSession } from "../types/auth";
import { 
  OpenAILogo, 
  ClaudeLogo, 
  DeepSeekLogo, 
  GroqLogo, 
  OpenRouterLogo, 
  GeminiLogo 
} from "./ModelBrandIcons";

interface CustomEndpoint {
  name: string;
  base_url: string;
  api_key: string;
  model_id: string;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeModel?: string | null;
  backgroundModel?: string | null;
  modelsList?: ModelMetadata[];
  onSelectModel?: (modelId: string) => void;
  onSelectBackgroundModel?: (modelId: string) => void;
  onRefreshModels?: () => void;
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
  session?: AuthSession | null;
  onOpenAuthModal?: () => void;
  onLogout?: () => void;
  initialTab?: SettingsTab;
}

type SettingsTab = "models" | "keys" | "rules" | "accounts" | "general";

export const DEFAULT_GLOBAL_RULES = `1. EXPERT PAIR PROGRAMMER: Think through problems step-by-step with deep technical understanding and clear, articulate communication.
2. PRODUCTION-GRADE CODE: Write robust, secure, maintainable, and clean code that fits naturally into the existing project architecture without omitting logic.
3. STRUCTURED REASONING: Reason carefully before acting. Use a concise <thought>...</thought> block for internal planning when needed.
4. PROACTIVE PROBLEM SOLVING: Identify edge cases, bugs, and system implications to ensure complete, verified implementations.`;

const RULE_PRESETS = [
  {
    name: "Frontier Pair Programmer",
    desc: "Balanced, intelligent, and proactive software engineering with clear communication.",
    rules: DEFAULT_GLOBAL_RULES,
  },
  {
    name: "Senior Software Architect",
    desc: "Focus on clean system design, design patterns, modularity, and high-performance architecture.",
    rules: `1. Act as a Principal Software Architect.
2. Prioritize clean system design, modularity, and high-performance algorithms.
3. Identify edge cases, race conditions, security vulnerabilities, and scalability bottlenecks.
4. Reason thoroughly and provide complete, fully typed, production-ready solutions.`,
  },
  {
    name: "Direct & Minimal",
    desc: "Laser-focused implementation with minimal conversational preamble.",
    rules: `1. Be concise and direct. Focus on clean code, exact file edits, and necessary commands.
2. Minimize conversational filler while preserving high technical accuracy and clarity.
3. Directly output complete, working solutions.`,
  },
];

const PROVIDERS = [
  { 
    id: "openai", 
    label: "OpenAI", 
    subtitle: "GPT-4o, GPT-4o Mini, o3-mini, o1, GPT-4 Turbo", 
    placeholder: "sk-proj-...", 
    color: "#10a37f", 
    renderLogo: (size = 18) => <OpenAILogo size={size} /> 
  },
  { 
    id: "anthropic", 
    label: "Anthropic Claude", 
    subtitle: "Claude 3.7 Sonnet, Claude 3.5 Sonnet, Claude 3.5 Haiku", 
    placeholder: "sk-ant-...", 
    color: "#d97706", 
    renderLogo: (size = 18) => <ClaudeLogo size={size} /> 
  },
  { 
    id: "deepseek", 
    label: "DeepSeek", 
    subtitle: "DeepSeek V3 Chat, DeepSeek R1 Reasoning", 
    placeholder: "sk-...", 
    color: "#3b82f6", 
    renderLogo: (size = 18) => <DeepSeekLogo size={size} /> 
  },
  { 
    id: "groq", 
    label: "Groq Cloud", 
    subtitle: "LLaMA 3.3 70B, Qwen 2.5 Coder 32B, Mixtral", 
    placeholder: "gsk_...", 
    color: "#f97316", 
    renderLogo: (size = 18) => <GroqLogo size={size} /> 
  },
  { 
    id: "openrouter", 
    label: "OpenRouter Universal", 
    subtitle: "Gateway for 200+ Frontier Models & Free Tiers", 
    placeholder: "sk-or-...", 
    color: "#8b5cf6", 
    renderLogo: (size = 18) => <OpenRouterLogo size={size} /> 
  },
  { 
    id: "gemini", 
    label: "Google Gemini", 
    subtitle: "Gemini 2.0 Flash, Gemini 1.5 Pro, Thinking Exp", 
    placeholder: "AIza...", 
    color: "#4285f4", 
    renderLogo: (size = 18) => <GeminiLogo size={size} /> 
  },
] as const;

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 36px 8px 12px",
  background: "var(--color-bg-inset)",
  border: "1px solid var(--color-border-default)",
  color: "var(--color-text-primary)",
  borderRadius: "var(--radius-sm)",
  fontSize: "12.5px",
  outline: "none",
  transition: "border-color 0.2s",
};

export function SettingsModal({
  isOpen,
  onClose,
  activeModel,
  backgroundModel,
  modelsList = [],
  onSelectModel,
  onSelectBackgroundModel,
  onRefreshModels,
  theme = "dark",
  onToggleTheme,
  session,
  onOpenAuthModal,
  onLogout,
  initialTab,
}: SettingsModalProps) {
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab || "keys");
  const [syncSettings, setSyncSettings] = useState({
    settings: true,
    rules: true,
    extensions: true,
    history: false,
  });

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab, isOpen]);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [initialKeys, setInitialKeys] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [customEndpoints, setCustomEndpoints] = useState<CustomEndpoint[]>([]);
  const [initialEndpoints, setInitialEndpoints] = useState<CustomEndpoint[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [showAddEndpoint, setShowAddEndpoint] = useState(false);
  const [newEndpoint, setNewEndpoint] = useState<CustomEndpoint>({ name: "", base_url: "", api_key: "", model_id: "" });
  const [globalRules, setGlobalRules] = useState<string>(() => {
    return localStorage.getItem("forge.global_ai_rules") ?? DEFAULT_GLOBAL_RULES;
  });

  const hasChanges = () => {
    for (const p of PROVIDERS) {
      if ((keys[p.id] || "").trim() !== (initialKeys[p.id] || "")) return true;
    }
    if (JSON.stringify(customEndpoints) !== JSON.stringify(initialEndpoints)) return true;
    return false;
  };

  const handleSave = async () => {
    setSaveStatus("saving");
    try {
      localStorage.setItem("forge.global_ai_rules", globalRules);
      const payload: Record<string, string> = {};
      for (const p of PROVIDERS) {
        // Send key value (including empty string to allow deletion/unsaving)
        payload[p.id] = (keys[p.id] || "").trim();
      }
      payload.custom_endpoints = JSON.stringify(customEndpoints);
      await models.saveApiKeys(payload as any);
      setInitialKeys({ ...keys });
      setInitialEndpoints([...customEndpoints]);
      setSaveStatus("saved");
      onRefreshModels?.();
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  };

  const handleSaveAndClose = async () => {
    localStorage.setItem("forge.global_ai_rules", globalRules);
    if (hasChanges()) {
      await handleSave();
    }
    onClose();
  };

  const handleClearKey = (providerId: string) => {
    setKeys((prev) => ({ ...prev, [providerId]: "" }));
  };

  const handleAddEndpoint = () => {
    if (!newEndpoint.name.trim() || !newEndpoint.base_url.trim() || !newEndpoint.model_id.trim()) return;
    setCustomEndpoints((prev) => [...prev, { ...newEndpoint }]);
    setNewEndpoint({ name: "", base_url: "", api_key: "", model_id: "" });
    setShowAddEndpoint(false);
  };

  const handleRemoveEndpoint = (idx: number) => {
    setCustomEndpoints((prev) => prev.filter((_, i) => i !== idx));
  };

  useEffect(() => {
    if (isOpen) {
      system.diagnostics().then((res) => {
        if (res.success) setDiagnostics(res.data);
      });
      models.getApiKeys().then((res) => {
        if (res.success && res.data) {
          const data = res.data as any;
          const loaded: Record<string, string> = {};
          for (const p of PROVIDERS) {
            if (data[p.id]) loaded[p.id] = data[p.id];
          }
          setKeys(loaded);
          setInitialKeys({ ...loaded });
          if (data.custom_endpoints) {
            try {
              const ep = JSON.parse(data.custom_endpoints);
              if (Array.isArray(ep)) {
                setCustomEndpoints(ep);
                setInitialEndpoints(ep);
              }
            } catch {}
          }
        }
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: "keys", label: "API Keys", icon: <Key size={14} /> },
    { id: "models", label: "Models", icon: <Cpu size={14} /> },
    { id: "rules", label: "Global Rules", icon: <BookOpen size={14} /> },
    { id: "accounts", label: "Accounts & Sync", icon: <User size={14} /> },
    { id: "general", label: "General", icon: <Palette size={14} /> },
  ];

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }} onClick={onClose}>
      <div
        className="animate-pop-in"
        style={{
          background: "var(--color-bg-surface)", border: "1px solid var(--color-border-default)",
          borderRadius: "var(--radius-lg)", width: 680, maxHeight: "88vh",
          display: "flex", flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "16px 20px 0 20px",
        }}>
          <h3 style={{ margin: 0, color: "var(--color-text-primary)", fontSize: "16px", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <Server size={18} style={{ color: "#ef4444" }} />
            Settings
          </h3>
          <button className="btn btn--icon" onClick={onClose} style={{ fontSize: "16px", cursor: "pointer" }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex", gap: 0, padding: "12px 20px 0 20px",
          borderBottom: "1px solid var(--color-border-default)",
        }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 16px", fontSize: "12.5px", fontWeight: 500,
                color: activeTab === t.id ? "var(--color-accent-primary)" : "var(--color-text-tertiary)",
                background: "none", border: "none", cursor: "pointer",
                borderBottom: activeTab === t.id ? "2px solid var(--color-accent-primary)" : "2px solid transparent",
                transition: "all 0.2s",
              }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          {activeTab === "keys" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Provider API Keys */}
              <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: 4 }}>
                Enter your API keys below. Keys are stored locally and never sent to any third-party server.
              </div>

              {PROVIDERS.map((p) => {
                const currentVal = keys[p.id] || "";
                const isConfigured = Boolean(currentVal.trim());
                const isMasked = currentVal.includes("•") || currentVal.includes("****");
                const isVisible = Boolean(showKeys[p.id]);

                return (
                  <div key={p.id} style={{
                    display: "flex", flexDirection: "column", gap: 10,
                    padding: "14px", borderRadius: "var(--radius-md)",
                    background: "var(--color-item-hover, rgba(255,255,255,0.02))", 
                    border: `1px solid var(--color-border-subtle)`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ 
                          width: 28, height: 28, borderRadius: 6, 
                          display: "flex", alignItems: "center", justifyContent: "center", 
                          background: "rgba(255,255,255,0.04)", 
                          border: "1px solid rgba(255,255,255,0.08)",
                          flexShrink: 0 
                        }}>
                          {p.renderLogo(20)}
                        </div>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <strong style={{ color: "var(--color-text-primary)", fontSize: "13.5px" }}>{p.label}</strong>
                            {p.id === "openai" && (
                              <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: 4, background: "rgba(16, 163, 127, 0.15)", color: "#10a37f", fontWeight: 700 }}>
                                OFFICIAL
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: 1 }}>
                            {p.subtitle}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {isConfigured ? (
                          <>
                            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "11px", color: "#34d399", fontWeight: 600, background: "rgba(52, 211, 153, 0.1)", padding: "3px 8px", borderRadius: 4 }}>
                              <CheckCircle size={12} />
                              <span>Configured</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleClearKey(p.id)}
                              title={`Clear / Remove ${p.label} API Key`}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                background: "rgba(239, 68, 68, 0.12)",
                                border: "1px solid rgba(239, 68, 68, 0.3)",
                                color: "#f87171",
                                padding: "3px 8px",
                                borderRadius: 4,
                                fontSize: "11px",
                                fontWeight: 500,
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(239, 68, 68, 0.25)")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(239, 68, 68, 0.12)")}
                            >
                              <Trash2 size={11} />
                              <span>Clear / Unsave</span>
                            </button>
                          </>
                        ) : (
                          initialKeys[p.id] ? (
                            <span style={{ fontSize: "10.5px", color: "#f87171", fontStyle: "italic" }}>
                              Key cleared (Click Save)
                            </span>
                          ) : null
                        )}
                      </div>
                    </div>

                    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                      <input
                        type={isVisible ? "text" : "password"}
                        placeholder={p.placeholder}
                        value={currentVal}
                        onChange={(e) => setKeys((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        style={inputStyle}
                        onFocus={(e) => {
                          e.target.style.borderColor = p.color;
                          // If current value is the masked placeholder, select all so typing replaces it easily
                          if (isMasked) {
                            e.target.select();
                          }
                        }}
                        onBlur={(e) => (e.target.style.borderColor = "var(--color-border-default)")}
                      />

                      <div style={{ position: "absolute", right: 8, display: "flex", alignItems: "center", gap: 4 }}>
                        {currentVal && (
                          <button
                            type="button"
                            onClick={() => setShowKeys((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                            style={{
                              background: "none",
                              border: "none",
                              color: "var(--color-text-tertiary)",
                              cursor: "pointer",
                              padding: 4,
                              display: "flex",
                              alignItems: "center",
                            }}
                            title={isVisible ? "Hide Key" : "Show Key"}
                          >
                            {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        )}
                        {currentVal && (
                          <button
                            type="button"
                            onClick={() => handleClearKey(p.id)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "var(--color-text-tertiary)",
                              cursor: "pointer",
                              padding: 4,
                              display: "flex",
                              alignItems: "center",
                            }}
                            title="Clear Input"
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Custom Endpoints */}
              <div style={{
                borderTop: "1px solid var(--color-border-default)", paddingTop: 16,
                display: "flex", flexDirection: "column", gap: 8,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Globe size={14} style={{ color: "#c084fc" }} />
                    <strong style={{ color: "var(--color-text-primary)", fontSize: "12.5px" }}>Custom Endpoints</strong>
                  </div>
                  <button
                    className="btn btn--secondary"
                    onClick={() => setShowAddEndpoint(true)}
                    style={{ fontSize: "11px", padding: "4px 10px", display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <Plus size={12} /> Add Endpoint
                  </button>
                </div>
                <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                  Connect any OpenAI-compatible API: vLLM, LM Studio, Ollama remote, Together AI, Mistral, etc.
                </div>

                {customEndpoints.map((ep, idx) => (
                  <div key={idx} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 12px", borderRadius: "var(--radius-sm)",
                    background: "rgba(192, 132, 252, 0.06)", border: "1px solid rgba(192, 132, 252, 0.15)",
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)" }}>{ep.name}</div>
                      <div style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)" }}>
                        {ep.base_url} · Model: {ep.model_id}
                      </div>
                    </div>
                    <button
                      className="btn btn--icon"
                      onClick={() => handleRemoveEndpoint(idx)}
                      style={{ color: "#f87171", width: 24, height: 24, padding: 0 }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}

                {/* Add Endpoint Form */}
                {showAddEndpoint && (
                  <div style={{
                    display: "flex", flexDirection: "column", gap: 8,
                    padding: "12px", borderRadius: "var(--radius-md)",
                    background: "rgba(255,255,255,0.03)", border: "1px solid var(--color-border-default)",
                  }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <label style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: 2, display: "block" }}>Name</label>
                        <input placeholder="My vLLM Server" value={newEndpoint.name} onChange={(e) => setNewEndpoint((prev) => ({ ...prev, name: e.target.value }))} style={inputStyle} />
                      </div>
                      <div>
                        <label style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: 2, display: "block" }}>Model ID</label>
                        <input placeholder="meta-llama/Llama-3-70B" value={newEndpoint.model_id} onChange={(e) => setNewEndpoint((prev) => ({ ...prev, model_id: e.target.value }))} style={inputStyle} />
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: 2, display: "block" }}>Base URL</label>
                      <input placeholder="http://localhost:8000/v1" value={newEndpoint.base_url} onChange={(e) => setNewEndpoint((prev) => ({ ...prev, base_url: e.target.value }))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: 2, display: "block" }}>API Key (optional for local)</label>
                      <input type="password" placeholder="Bearer token or leave empty" value={newEndpoint.api_key} onChange={(e) => setNewEndpoint((prev) => ({ ...prev, api_key: e.target.value }))} style={inputStyle} />
                    </div>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button className="btn btn--secondary" onClick={() => setShowAddEndpoint(false)} style={{ fontSize: "11px", padding: "5px 12px" }}>Cancel</button>
                      <button className="btn btn--primary" onClick={handleAddEndpoint} style={{ fontSize: "11px", padding: "5px 12px" }}>Add Endpoint</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "models" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, fontSize: "var(--text-caption)", color: "var(--color-text-secondary)" }}>
              <div>
                <strong style={{ color: "var(--color-text-primary)" }}>Chat Model:</strong>
                <div style={{ marginTop: 4 }}>
                  <select
                    className="input"
                    value={activeModel || ""}
                    onChange={(e) => onSelectModel?.(e.target.value)}
                    style={{ ...inputStyle, cursor: "pointer" }}
                  >
                    {modelsList.filter((m) => m.provider === "ollama").length > 0 && (
                      <optgroup label="💻 Local Ollama Models" style={{ background: "var(--color-bg-surface)", color: "var(--color-text-primary)" }}>
                        {modelsList.filter((m) => m.provider === "ollama").map((m) => (
                          <option key={m.id} value={m.id}>{m.name} (ollama)</option>
                        ))}
                      </optgroup>
                    )}
                    {modelsList.filter((m) => m.provider !== "ollama" && m.provider !== "custom" && (m.is_free || m.name.includes("FREE") || m.id.endsWith(":free"))).length > 0 && (
                      <optgroup label="🎁 Free Cloud Models" style={{ background: "var(--color-bg-surface)", color: "var(--color-text-primary)" }}>
                        {modelsList.filter((m) => m.provider !== "ollama" && m.provider !== "custom" && (m.is_free || m.name.includes("FREE") || m.id.endsWith(":free"))).map((m) => (
                          <option key={m.id} value={m.id}>🎁 {m.name.replace(/\[FREE\]/g, "").replace(/\[FREE TIER\]/g, "").trim()} ({m.provider})</option>
                        ))}
                      </optgroup>
                    )}
                    {modelsList.filter((m) => m.provider !== "ollama" && m.provider !== "custom" && !m.is_free && !m.name.includes("FREE") && !m.id.endsWith(":free")).length > 0 && (
                      <optgroup label="⚡ Flagship & API Models" style={{ background: "var(--color-bg-surface)", color: "var(--color-text-primary)" }}>
                        {modelsList.filter((m) => m.provider !== "ollama" && m.provider !== "custom" && !m.is_free && !m.name.includes("FREE") && !m.id.endsWith(":free")).map((m) => (
                          <option key={m.id} value={m.id}>⚡ {m.name} ({m.provider})</option>
                        ))}
                      </optgroup>
                    )}
                    {modelsList.filter((m) => m.provider === "custom").length > 0 && (
                      <optgroup label="🔧 Custom Endpoints" style={{ background: "var(--color-bg-surface)", color: "var(--color-text-primary)" }}>
                        {modelsList.filter((m) => m.provider === "custom").map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              </div>

              <div>
                <strong style={{ color: "var(--color-text-primary)" }}>Background Agent Model:</strong>
                <div style={{ marginTop: 4 }}>
                  <select
                    className="input"
                    value={backgroundModel || ""}
                    onChange={(e) => onSelectBackgroundModel?.(e.target.value)}
                    style={{ ...inputStyle, cursor: "pointer" }}
                  >
                    {modelsList.filter((m) => m.provider === "ollama").length > 0 && (
                      <optgroup label="💻 Local Ollama Models" style={{ background: "var(--color-bg-surface)", color: "var(--color-text-primary)" }}>
                        {modelsList.filter((m) => m.provider === "ollama").map((m) => (
                          <option key={m.id} value={m.id}>{m.name} (ollama)</option>
                        ))}
                      </optgroup>
                    )}
                    {modelsList.filter((m) => m.provider !== "ollama" && m.provider !== "custom" && (m.is_free || m.name.includes("FREE") || m.id.endsWith(":free"))).length > 0 && (
                      <optgroup label="🎁 Free Cloud Models" style={{ background: "var(--color-bg-surface)", color: "var(--color-text-primary)" }}>
                        {modelsList.filter((m) => m.provider !== "ollama" && m.provider !== "custom" && (m.is_free || m.name.includes("FREE") || m.id.endsWith(":free"))).map((m) => (
                          <option key={m.id} value={m.id}>🎁 {m.name.replace(/\[FREE\]/g, "").replace(/\[FREE TIER\]/g, "").trim()} ({m.provider})</option>
                        ))}
                      </optgroup>
                    )}
                    {modelsList.filter((m) => m.provider !== "ollama" && m.provider !== "custom" && !m.is_free && !m.name.includes("FREE") && !m.id.endsWith(":free")).length > 0 && (
                      <optgroup label="⚡ Flagship & API Models" style={{ background: "var(--color-bg-surface)", color: "var(--color-text-primary)" }}>
                        {modelsList.filter((m) => m.provider !== "ollama" && m.provider !== "custom" && !m.is_free && !m.name.includes("FREE") && !m.id.endsWith(":free")).map((m) => (
                          <option key={m.id} value={m.id}>⚡ {m.name} ({m.provider})</option>
                        ))}
                      </optgroup>
                    )}
                    {modelsList.filter((m) => m.provider === "custom").length > 0 && (
                      <optgroup label="🔧 Custom Endpoints" style={{ background: "var(--color-bg-surface)", color: "var(--color-text-primary)" }}>
                        {modelsList.filter((m) => m.provider === "custom").map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              </div>


              <div style={{
                padding: "12px", borderRadius: "var(--radius-md)", background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.2)", fontSize: "11.5px",
              }}>
                <strong style={{ color: "var(--color-text-primary)" }}>Discovered Models: {modelsList.length}</strong>
                <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {Array.from(new Set(modelsList.map((m) => m.provider))).map((provider) => (
                    <span key={provider} style={{
                      padding: "2px 8px", borderRadius: 12, fontSize: "10.5px", fontWeight: 600,
                      background: "rgba(255,255,255,0.06)", color: "var(--color-text-secondary)",
                      border: "1px solid var(--color-border-subtle)",
                    }}>
                      {provider}: {modelsList.filter((m) => m.provider === provider).length}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === "rules" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <strong style={{ color: "var(--color-text-primary)", fontSize: "13px", display: "flex", alignItems: "center", gap: 6 }}>
                    <Sparkles size={14} style={{ color: "var(--color-accent-primary)" }} />
                    Global AI Directives & Rules
                  </strong>
                  <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                    Applied across all models & chats
                  </span>
                </div>
                <div style={{ fontSize: "11.5px", color: "var(--color-text-secondary)", lineHeight: 1.4 }}>
                  These rules are automatically injected into the system prompt of every model (Claude, GPT-4o, DeepSeek, Gemini, local Ollama) across Csotic.
                </div>
              </div>

              {/* Presets */}
              <div>
                <div style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 6 }}>
                  Quick Rule Presets:
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  {RULE_PRESETS.map((preset, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setGlobalRules(preset.rules);
                        localStorage.setItem("forge.global_ai_rules", preset.rules);
                      }}
                      style={{
                        padding: "8px 10px",
                        textAlign: "left",
                        background: globalRules === preset.rules ? "rgba(239, 68, 68, 0.15)" : "var(--color-item-hover, rgba(255,255,255,0.03))",
                        border: globalRules === preset.rules ? "1px solid rgba(239, 68, 68, 0.4)" : "1px solid var(--color-border-subtle)",
                        borderRadius: "var(--radius-sm)",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      <span style={{ fontSize: "11.5px", fontWeight: 600, color: globalRules === preset.rules ? "#f87171" : "var(--color-text-primary)" }}>
                        {preset.name}
                      </span>
                      <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", lineHeight: 1.3 }}>
                        {preset.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Directives Textarea */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <label style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--color-text-primary)" }}>
                    Active Directives
                  </label>
                  <button
                    onClick={() => {
                      setGlobalRules(DEFAULT_GLOBAL_RULES);
                      localStorage.setItem("forge.global_ai_rules", DEFAULT_GLOBAL_RULES);
                    }}
                    style={{
                      background: "none", border: "none", color: "var(--color-accent-primary)",
                      fontSize: "11px", cursor: "pointer", padding: 0, textDecoration: "underline",
                    }}
                  >
                    Reset to Default
                  </button>
                </div>
                <textarea
                  value={globalRules}
                  onChange={(e) => {
                    setGlobalRules(e.target.value);
                    localStorage.setItem("forge.global_ai_rules", e.target.value);
                  }}
                  rows={9}
                  placeholder="Enter custom instructions, rules, or system constraints..."
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    background: "var(--color-bg-inset)",
                    border: "1px solid var(--color-border-default)",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--color-text-primary)",
                    fontSize: "12px",
                    lineHeight: 1.5,
                    fontFamily: "var(--font-mono, monospace)",
                    resize: "vertical",
                    outline: "none",
                  }}
                />
              </div>
            </div>
          )}

          {activeTab === "general" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, fontSize: "var(--text-caption)", color: "var(--color-text-secondary)" }}>
              <div>
                <strong style={{ color: "var(--color-text-primary)" }}>Theme mode:</strong>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    className={`btn ${theme === "dark" ? "btn--primary" : "btn--secondary"}`}
                    onClick={() => theme === "light" && onToggleTheme?.()}
                    style={{ fontSize: "12px", height: 30, borderRadius: 4 }}
                  >
                    Dark Obsidian Mode
                  </button>
                  <button
                    className={`btn ${theme === "light" ? "btn--primary" : "btn--secondary"}`}
                    onClick={() => theme === "dark" && onToggleTheme?.()}
                    style={{ fontSize: "12px", height: 30, borderRadius: 4 }}
                  >
                    Light Slate Mode
                  </button>
                </div>
              </div>

              <div>
                <strong style={{ color: "var(--color-text-primary)", display: "flex", alignItems: "center", gap: 6 }}>
                  <Database size={13} /> Local database:
                </strong>
                <div style={{
                  marginTop: 4, wordBreak: "break-all", background: "rgba(255,255,255,0.02)",
                  padding: "6px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-default)",
                  fontSize: "11.5px",
                }}>
                  {diagnostics?.active_project ? `${diagnostics.active_project}/data/forge.db` : "forge.db (SQLite connected)"}
                </div>
              </div>

              <div>
                <strong style={{ color: "var(--color-text-primary)" }}>System status:</strong>
                <div style={{ marginTop: 4 }}>Connected to trusted Rust runtime v{diagnostics?.version || "0.1.0"}</div>
              </div>
            </div>
          )}

          {activeTab === "accounts" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {/* Account Identity Card */}
              <div
                style={{
                  padding: 16,
                  borderRadius: "var(--radius-md)",
                  background: "var(--color-bg-base)",
                  border: "1px solid var(--color-border-subtle)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: "50%",
                        background: session?.user ? "rgba(239, 68, 68, 0.15)" : "rgba(255,255,255,0.05)",
                        border: session?.user ? "2px solid #ef4444" : "1px solid var(--color-border-default)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                        flexShrink: 0,
                      }}
                    >
                      {session?.user?.avatarUrl ? (
                        <img
                          src={session.user.avatarUrl}
                          alt={session.user.name || "User"}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        <User size={22} style={{ color: "var(--color-text-secondary)" }} />
                      )}
                    </div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <strong style={{ fontSize: 14, color: "var(--color-text-primary)" }}>
                          {session?.user?.name || session?.user?.username || "Not Signed In"}
                        </strong>
                        {session?.user && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              textTransform: "uppercase",
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: session.provider === "github" ? "rgba(255,255,255,0.1)" : "rgba(66, 133, 244, 0.15)",
                              color: session.provider === "github" ? "#f3f4f6" : "#60a5fa",
                              border: "1px solid rgba(255,255,255,0.1)",
                            }}
                          >
                            {session.provider === "github" ? "GitHub Connected" : session.provider === "google" ? "Google Account" : "Local Dev"}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                        {session?.user?.email || "Connect your GitHub or Google account to sync settings and AI rules"}
                      </div>
                    </div>
                  </div>

                  {session?.user ? (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={onOpenAuthModal}
                        className="btn btn--secondary"
                        style={{ fontSize: 12, padding: "5px 10px" }}
                      >
                        Manage Identity
                      </button>
                      <button
                        onClick={onLogout}
                        className="btn btn--secondary"
                        style={{ fontSize: 12, padding: "5px 10px", color: "#f87171" }}
                      >
                        <LogOut size={13} style={{ marginRight: 4 }} />
                        Sign Out
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={onOpenAuthModal}
                      className="btn btn--primary"
                      style={{ fontSize: 12, padding: "6px 14px", display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <User size={13} />
                      Sign In / Connect
                    </button>
                  )}
                </div>

                {session?.user && (
                  <div
                    style={{
                      display: "flex",
                      gap: 16,
                      paddingTop: 12,
                      borderTop: "1px solid var(--color-border-subtle)",
                      fontSize: 11,
                      color: "var(--color-text-tertiary)",
                    }}
                  >
                    <div><strong style={{ color: "var(--color-text-secondary)" }}>Login:</strong> @{session.user.username}</div>
                    <div><strong style={{ color: "var(--color-text-secondary)" }}>Auth Status:</strong> <span style={{ color: "#22c55e" }}>Active Token</span></div>
                    <div><strong style={{ color: "var(--color-text-secondary)" }}>Session Stored:</strong> ~/.forge/auth.json</div>
                  </div>
                )}
              </div>

              {/* Settings Sync Controls */}
              <div
                style={{
                  padding: 16,
                  borderRadius: "var(--radius-md)",
                  background: "var(--color-bg-base)",
                  border: "1px solid var(--color-border-subtle)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Cloud size={16} style={{ color: "#ef4444" }} />
                    <strong style={{ fontSize: 13, color: "var(--color-text-primary)" }}>Settings Sync & Backup</strong>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: session?.user ? "rgba(34, 197, 94, 0.1)" : "rgba(255,255,255,0.05)",
                      color: session?.user ? "#22c55e" : "var(--color-text-tertiary)",
                      fontWeight: 600,
                    }}
                  >
                    {session?.user ? "Sync Ready" : "Sign In to Sync"}
                  </span>
                </div>

                <div style={{ fontSize: 11.5, color: "var(--color-text-tertiary)" }}>
                  Synchronize your preferences across machines running Csotic IDE.
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
                  {[
                    { key: "settings", label: "Application Preferences & Themes", desc: "Font size, editor tab settings, UI theme" },
                    { key: "rules", label: "Global AI Persona & Rules", desc: "System prompts and reasoning instructions" },
                    { key: "extensions", label: "Installed Extensions Manifest", desc: "Claude Code and community plugins" },
                    { key: "history", label: "Pair Programming History", desc: "Synced AI chats and memory scratchpads" },
                  ].map((item) => (
                    <label
                      key={item.key}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        padding: 10,
                        borderRadius: 6,
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid var(--color-border-subtle)",
                        cursor: session?.user ? "pointer" : "default",
                        opacity: session?.user ? 1 : 0.6,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(syncSettings[item.key as keyof typeof syncSettings])}
                        disabled={!session?.user}
                        onChange={(e) => {
                          setSyncSettings((prev) => ({
                            ...prev,
                            [item.key]: e.target.checked,
                          }));
                        }}
                        style={{ marginTop: 2, accentColor: "#ef4444" }}
                      />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)" }}>
                          {item.label}
                        </div>
                        <div style={{ fontSize: 10.5, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                          {item.desc}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Git Committer Identity Card */}
              <div
                style={{
                  padding: 16,
                  borderRadius: "var(--radius-md)",
                  background: "var(--color-bg-base)",
                  border: "1px solid var(--color-border-subtle)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ShieldCheck size={16} style={{ color: "#22c55e" }} />
                  <strong style={{ fontSize: 13, color: "var(--color-text-primary)" }}>Git Committer Identity</strong>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--color-text-tertiary)" }}>
                  Git commits created in the Source Control panel will automatically use:
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 16,
                    padding: "8px 12px",
                    borderRadius: 6,
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid var(--color-border-subtle)",
                    fontSize: 12,
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                >
                  <div>Author: <span style={{ color: "#f3f4f6" }}>{session?.user?.name || "Local Developer"}</span></div>
                  <div>Email: <span style={{ color: "#f3f4f6" }}>{session?.user?.email || "developer@local"}</span></div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          borderTop: "1px solid var(--color-border-default)", padding: "12px 20px",
        }}>
          <div style={{ fontSize: "11px", display: "flex", alignItems: "center", gap: 6 }}>
            {saveStatus === "saved" && <><CheckCircle size={12} style={{ color: "#34d399" }} /> <span style={{ color: "#34d399" }}>Keys saved!</span></>}
            {saveStatus === "error" && <><AlertCircle size={12} style={{ color: "#f87171" }} /> <span style={{ color: "#f87171" }}>Save failed</span></>}
            {saveStatus === "saving" && <span style={{ color: "var(--color-text-tertiary)" }}>Saving...</span>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {activeTab === "keys" && hasChanges() && (
              <button className="btn btn--secondary" onClick={handleSave} style={{ fontSize: "12px" }}>
                Save Keys
              </button>
            )}
            <button className="btn btn--secondary" onClick={onClose} style={{ fontSize: "12px" }}>
              Cancel
            </button>
            <button className="btn btn--primary" onClick={handleSaveAndClose} style={{ fontSize: "12px" }}>
              Save & Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
