import { useState, useEffect } from "react";
import { 
  X, 
  Check, 
  ExternalLink, 
  Key, 
  User, 
  Sparkles, 
  RefreshCw, 
  LogOut,
  ShieldCheck,
  Eye,
  EyeOff
} from "lucide-react";
import type { AuthSession, UserProfile } from "../types/auth";
import { auth as ipcAuth } from "../services/ipc";
import { CustomDialog } from "./GlobalDialog";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: AuthSession | null;
  onSessionChange: (session: AuthSession | null) => void;
}

export function AuthModal({
  isOpen,
  onClose,
  session,
  onSessionChange,
}: AuthModalProps) {
  const [activeTab, setActiveTab] = useState<"github" | "google" | "local">("github");
  const [githubToken, setGithubToken] = useState("");
  const [googleToken, setGoogleToken] = useState("");
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [showGoogleToken, setShowGoogleToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local profile form states
  const [localName, setLocalName] = useState(session?.user?.name || "");
  const [localUsername, setLocalUsername] = useState(session?.user?.username || "");
  const [localEmail, setLocalEmail] = useState(session?.user?.email || "");
  const [localAvatar, setLocalAvatar] = useState(session?.user?.avatarUrl || "");
  const [localBio, setLocalBio] = useState(session?.user?.bio || "");

  // Real local identity detected on machine (gh CLI & git config)
  const [detectedIdentity, setDetectedIdentity] = useState<{
    gh?: {
      available: boolean;
      login?: string;
      name?: string;
      email?: string;
      avatar_url?: string;
      company?: string;
      bio?: string;
    } | null;
    git?: {
      name?: string;
      email?: string;
    } | null;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    ipcAuth.detectLocalIdentity().then((res: any) => {
      if (res?.success && res?.data) {
        setDetectedIdentity(res.data);
        if (res.data.git?.name && !localName) {
          setLocalName(res.data.git.name);
        }
        if (res.data.git?.email && !localEmail) {
          setLocalEmail(res.data.git.email);
        }
        if (res.data.gh?.login && !localUsername) {
          setLocalUsername(res.data.gh.login);
        }
      }
    }).catch(console.warn);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConnectGhCli = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await ipcAuth.loginGhCli();
      if (res.success && res.data && (res.data as any).session) {
        const newSession = (res.data as any).session as AuthSession;
        onSessionChange(newSession);
        onClose();
      } else {
        setError(res.error?.message || "Failed to authenticate via GitHub CLI ('gh')");
      }
    } catch (e: any) {
      setError(e?.message || "Failed to execute GitHub CLI authentication");
    } finally {
      setLoading(false);
    }
  };

  const handleGitHubConnect = async (tokenToUse?: string) => {
    const token = (tokenToUse || githubToken).trim();
    if (!token) {
      setError("Please enter a valid GitHub Personal Access Token");
      return;
    }

    const lower = token.toLowerCase();
    if (lower.includes("demo") || lower.includes("mock") || lower.includes("dummy") || lower.includes("fake") || lower.startsWith("test_") || lower === "test") {
      setError("Demo and mock tokens are strictly rejected. Please provide an authentic GitHub Personal Access Token.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await ipcAuth.loginGitHubToken(token);
      if (res.success && res.data && (res.data as any).session) {
        const newSession = (res.data as any).session as AuthSession;
        onSessionChange(newSession);
        setGithubToken("");
        onClose();
      } else {
        setError(res.error?.message || "Failed to authenticate with GitHub. Verify your token permissions.");
      }
    } catch (e: any) {
      setError(e?.message || "An unexpected error occurred connecting to GitHub");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleConnect = async () => {
    const token = googleToken.trim();
    if (!token) {
      setError("Please enter a Google OAuth Access Token to verify with Google API.");
      return;
    }

    const lower = token.toLowerCase();
    if (lower.includes("demo") || lower.includes("mock") || lower.includes("dummy") || lower.includes("fake") || lower.startsWith("test_") || lower === "test") {
      setError("Demo and mock tokens are strictly rejected. Please provide an authentic Google OAuth 2.0 Access Token.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await ipcAuth.loginGoogle(token);
      if (res.success && res.data && (res.data as any).session) {
        const newSession = (res.data as any).session as AuthSession;
        onSessionChange(newSession);
        setGoogleToken("");
        onClose();
      } else {
        setError(res.error?.message || "Google authentication failed. Please verify your token.");
      }
    } catch (e: any) {
      setError(e?.message || "Google connection failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveLocalProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user) {
      setError("Active authentication required. Demo and unauthenticated profile creation is disabled for security. Please sign in with GitHub or Google first.");
      return;
    }

    if (!localName.trim()) {
      setError("Display Name is required");
      return;
    }

    setLoading(true);
    setError(null);

    const profile: UserProfile = {
      id: session.user.id,
      username: localUsername.trim() || session.user.username,
      name: localName.trim(),
      email: localEmail.trim() || session.user.email,
      avatarUrl: localAvatar.trim() || session.user.avatarUrl,
      provider: session.provider,
      bio: localBio.trim() || session.user.bio || "Local Developer",
      createdAt: session.user.createdAt || new Date().toISOString(),
    };

    try {
      const res = await ipcAuth.saveProfile(profile);
      if (res.success && res.data && (res.data as any).session) {
        onSessionChange((res.data as any).session);
        CustomDialog.toast("Developer profile updated successfully!", "success");
      } else {
        setError(res.error?.message || "Failed to save developer profile.");
      }
    } catch {
      setError("Failed to save developer profile. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    const confirmed = await CustomDialog.confirm(
      "Are you sure you want to sign out from Csotic?",
      "Sign Out",
      true,
      "Sign Out",
      "Cancel"
    );
    if (!confirmed) return;

    try {
      await ipcAuth.logout();
      onSessionChange(null);
    } catch (e: any) {
      console.error("Logout failed:", e);
    }
  };

  return (
    <div 
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.5)",
        animation: "fadeIn 0.15s ease",
      }}
      onClick={onClose}
    >
      <div 
        style={{
          width: "100%",
          maxWidth: 540,
          background: "var(--color-modal-bg, #121117)",
          border: "1px solid var(--color-modal-border, #2f283a)",
          borderRadius: 12,
          boxShadow: "0 24px 70px rgba(0,0,0,0.95), 0 0 1px 1px rgba(255, 255, 255, 0.08)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          maxHeight: "90vh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--color-modal-border-subtle, #241f2d)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "var(--color-modal-header-bg, #17141f)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 10px rgba(239, 68, 68, 0.35)",
            }}>
              <Sparkles size={16} style={{ color: "#ffffff" }} />
            </div>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                {session?.user ? "Account & Developer Profile" : "Sign In to Csotic"}
              </div>
              <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                Sync settings, connect GitHub repositories, and pair with AI models
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--color-text-tertiary)",
              cursor: "pointer",
              padding: 4,
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* If user is already signed in, show profile card */}
        {session?.user && (
          <div style={{
            padding: "16px 20px",
            background: "var(--color-modal-card-bg, #191622)",
            borderBottom: "1px solid var(--color-modal-border-subtle, #241f2d)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ position: "relative" }}>
                {session.user.avatarUrl ? (
                  <img
                    src={session.user.avatarUrl}
                    alt={session.user.name}
                    style={{
                      width: 46,
                      height: 46,
                      borderRadius: "50%",
                      objectFit: "cover",
                      border: "2px solid rgba(239, 68, 68, 0.6)",
                    }}
                  />
                ) : (
                  <div style={{
                    width: 46,
                    height: 46,
                    borderRadius: "50%",
                    background: "rgba(239, 68, 68, 0.2)",
                    border: "2px solid rgba(239, 68, 68, 0.6)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#ef4444",
                    fontWeight: 700,
                  }}>
                    {session.user.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <span style={{
                  position: "absolute",
                  bottom: 0,
                  right: 0,
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: "#10b981",
                  border: "2px solid var(--color-modal-card-bg, #191622)",
                }} />
              </div>

              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                    {session.user.name}
                  </span>
                  <span style={{
                    fontSize: "10px",
                    fontWeight: 600,
                    padding: "1px 6px",
                    borderRadius: 10,
                    background: session.provider === "github" ? "#27272a" : session.provider === "google" ? "#1e3a5f" : "#451a1a",
                    color: session.provider === "google" ? "#60a5fa" : "#ffffff",
                    textTransform: "capitalize",
                  }}>
                    {session.provider}
                  </span>
                </div>
                <div style={{ fontSize: "11.5px", color: "var(--color-text-secondary)" }}>
                  @{session.user.username} · {session.user.email}
                </div>
                {session.user.bio && (
                  <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: 2 }}>
                    {session.user.bio}
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={handleLogout}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "6px 12px",
                fontSize: "11.5px",
                fontWeight: 600,
                color: "#f87171",
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.4)",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              <LogOut size={13} />
              <span>Sign Out</span>
            </button>
          </div>
        )}

        {/* Tab Navigation */}
        <div style={{
          display: "flex",
          borderBottom: "1px solid var(--color-modal-border-subtle, #241f2d)",
          padding: "0 16px",
          gap: 6,
          background: "var(--color-modal-header-bg, #17141f)",
        }}>
          <button
            onClick={() => { setActiveTab("github"); setError(null); }}
            style={{
              padding: "10px 14px",
              fontSize: "12px",
              fontWeight: 600,
              color: activeTab === "github" ? "#ffffff" : "var(--color-text-tertiary)",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === "github" ? "2px solid #ef4444" : "2px solid transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {/* GitHub Octocat Icon */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            <span>GitHub</span>
          </button>

          <button
            onClick={() => { setActiveTab("google"); setError(null); }}
            style={{
              padding: "10px 14px",
              fontSize: "12px",
              fontWeight: 600,
              color: activeTab === "google" ? "#ffffff" : "var(--color-text-tertiary)",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === "google" ? "2px solid #ef4444" : "2px solid transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {/* Google G Icon */}
            <svg width="13" height="13" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
              <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"/>
              <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
              <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
            </svg>
            <span>Google</span>
          </button>

          <button
            onClick={() => { setActiveTab("local"); setError(null); }}
            style={{
              padding: "10px 14px",
              fontSize: "12px",
              fontWeight: 600,
              color: activeTab === "local" ? "#ffffff" : "var(--color-text-tertiary)",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === "local" ? "2px solid #ef4444" : "2px solid transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <User size={13} />
            <span>Developer Profile</span>
          </button>
        </div>

        {/* Tab Body */}
        <div style={{ padding: "20px", overflowY: "auto", background: "var(--color-modal-bg, #121117)" }}>
          {error && (
            <div style={{
              padding: "10px 14px",
              background: "#2a1012",
              border: "1px solid #7f1d1d",
              borderRadius: 6,
              color: "#fca5a5",
              fontSize: "12px",
              marginBottom: 16,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* TAB 1: GITHUB */}
          {activeTab === "github" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Detected GitHub CLI Session */}
              {detectedIdentity?.gh?.available && (
                <div style={{
                  padding: "14px 16px",
                  background: "#0c2014",
                  border: "1px solid #166534",
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {detectedIdentity.gh.avatar_url ? (
                      <img
                        src={detectedIdentity.gh.avatar_url}
                        alt="GitHub"
                        style={{ width: 42, height: 42, borderRadius: "50%", border: "2px solid #22c55e", objectFit: "cover" }}
                      />
                    ) : (
                      <div style={{ width: 42, height: 42, borderRadius: "50%", background: "#22c55e", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700 }}>
                        {detectedIdentity.gh.login?.charAt(0)}
                      </div>
                    )}
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: "13.5px", fontWeight: 700, color: "#f3f4f6" }}>
                          {detectedIdentity.gh.name || detectedIdentity.gh.login}
                        </span>
                        <span style={{ fontSize: "10px", background: "#14532d", color: "#4ade80", padding: "1px 6px", borderRadius: 4, fontWeight: 700, border: "1px solid #166534" }}>
                          GH CLI DETECTED
                        </span>
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginTop: 2 }}>
                        @{detectedIdentity.gh.login} · {detectedIdentity.gh.email}
                      </div>
                      {detectedIdentity.gh.company && (
                        <div style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)" }}>
                          {detectedIdentity.gh.company}
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleConnectGhCli}
                    disabled={loading}
                    style={{
                      padding: "8px 16px",
                      background: "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
                      border: "none",
                      borderRadius: 6,
                      color: "#ffffff",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      boxShadow: "0 2px 10px rgba(34, 197, 94, 0.35)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {loading ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
                    <span>1-Click Connect</span>
                  </button>
                </div>
              )}

              {detectedIdentity?.gh?.available && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 0" }}>
                  <div style={{ flex: 1, height: 1, background: "var(--color-modal-border-subtle, #241f2d)" }} />
                  <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", fontWeight: 700, textTransform: "uppercase" }}>
                    or enter personal access token
                  </span>
                  <div style={{ flex: 1, height: 1, background: "var(--color-modal-border-subtle, #241f2d)" }} />
                </div>
              )}

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 6 }}>
                  GitHub Personal Access Token (Classic or Fine-Grained)
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <Key size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--color-text-tertiary)" }} />
                    <input
                      type={showGithubToken ? "text" : "password"}
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      value={githubToken}
                      onChange={(e) => setGithubToken(e.target.value)}
                      style={{
                        width: "100%",
                        height: 36,
                        padding: "0 36px 0 32px",
                        background: "var(--color-modal-input-bg, #1e1a29)",
                        border: "1px solid var(--color-modal-border, #2f283a)",
                        borderRadius: 6,
                        color: "var(--color-text-primary)",
                        fontSize: "12px",
                        outline: "none",
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleGitHubConnect();
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowGithubToken(!showGithubToken)}
                      style={{
                        position: "absolute",
                        right: 8,
                        top: 9,
                        background: "transparent",
                        border: "none",
                        color: "var(--color-text-tertiary)",
                        cursor: "pointer",
                        padding: 2,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      title={showGithubToken ? "Hide token" : "Show token"}
                    >
                      {showGithubToken ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <button
                    onClick={() => handleGitHubConnect()}
                    disabled={loading || !githubToken.trim()}
                    style={{
                      height: 36,
                      padding: "0 16px",
                      background: "linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)",
                      border: "none",
                      borderRadius: 6,
                      color: "#ffffff",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: loading || !githubToken.trim() ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      opacity: !githubToken.trim() ? 0.6 : 1,
                    }}
                  >
                    {loading ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
                    <span>Connect Token</span>
                  </button>
                </div>
              </div>

              {/* Instructions & Help */}
              <div style={{
                padding: "12px 14px",
                background: "var(--color-modal-card-bg, #191622)",
                border: "1px solid var(--color-modal-border-subtle, #241f2d)",
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}>
                <div style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--color-text-secondary)" }}>
                  How to generate a real token on GitHub:
                </div>
                <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", lineHeight: "18px" }}>
                  1. Go to <strong style={{ color: "var(--color-text-secondary)" }}>GitHub → Settings → Developer Settings → Personal Access Tokens</strong>.<br />
                  2. Select <strong style={{ color: "var(--color-text-secondary)" }}>Tokens (classic)</strong> → Generate new token.<br />
                  3. Check scopes: <code style={{ color: "#ef4444", background: "rgba(239, 68, 68, 0.1)", padding: "1px 4px", borderRadius: 3 }}>repo</code>, <code style={{ color: "#ef4444", background: "rgba(239, 68, 68, 0.1)", padding: "1px 4px", borderRadius: 3 }}>read:user</code>, <code style={{ color: "#ef4444", background: "rgba(239, 68, 68, 0.1)", padding: "1px 4px", borderRadius: 3 }}>user:email</code>.
                </div>
                <a
                  href="https://github.com/settings/tokens/new"
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: "11px",
                    color: "#60a5fa",
                    textDecoration: "none",
                    marginTop: 2,
                  }}
                >
                  <span>Open GitHub Token Generator</span>
                  <ExternalLink size={11} />
                </a>
              </div>
            </div>
          )}

          {/* TAB 2: GOOGLE */}
          {activeTab === "google" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                background: "var(--color-modal-card-bg, #191622)",
                border: "1px solid var(--color-modal-border-subtle, #241f2d)",
                borderRadius: 8,
              }}>
                <div style={{
                  width: 42,
                  height: 42,
                  borderRadius: "50%",
                  background: "#1f2937",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <svg width="22" height="22" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"/>
                    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
                  </svg>
                </div>

                <div>
                  <div style={{ fontSize: "13.5px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                    Real Google OAuth Authentication
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: 2 }}>
                    Authenticates live with Google UserInfo API (<code style={{ color: "#60a5fa" }}>googleapis.com/oauth2/v3/userinfo</code>).
                  </div>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 6 }}>
                  Google OAuth 2.0 Access Token
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <Key size={14} style={{ position: "absolute", left: 10, top: 11, color: "var(--color-text-tertiary)" }} />
                    <input
                      type={showGoogleToken ? "text" : "password"}
                      placeholder="ya29.a0AcM612..."
                      value={googleToken}
                      onChange={(e) => setGoogleToken(e.target.value)}
                      style={{
                        width: "100%",
                        height: 36,
                        padding: "0 36px 0 32px",
                        background: "var(--color-modal-input-bg, #1e1a29)",
                        border: "1px solid var(--color-modal-border, #2f283a)",
                        borderRadius: 6,
                        color: "var(--color-text-primary)",
                        fontSize: "12px",
                        outline: "none",
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleGoogleConnect();
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowGoogleToken(!showGoogleToken)}
                      style={{
                        position: "absolute",
                        right: 8,
                        top: 9,
                        background: "transparent",
                        border: "none",
                        color: "var(--color-text-tertiary)",
                        cursor: "pointer",
                        padding: 2,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      title={showGoogleToken ? "Hide token" : "Show token"}
                    >
                      {showGoogleToken ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <button
                    onClick={handleGoogleConnect}
                    disabled={loading || !googleToken.trim()}
                    style={{
                      height: 36,
                      padding: "0 16px",
                      background: "linear-gradient(135deg, #4285F4 0%, #1a73e8 100%)",
                      border: "none",
                      borderRadius: 6,
                      color: "#ffffff",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: loading || !googleToken.trim() ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      opacity: !googleToken.trim() ? 0.6 : 1,
                    }}
                  >
                    {loading ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
                    <span>Verify & Sign In</span>
                  </button>
                </div>
              </div>

              {/* Instructions on getting Google Token */}
              <div style={{
                padding: "12px 14px",
                background: "#0f1c2e",
                border: "1px solid #1e3a5f",
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}>
                <div style={{ fontSize: "11.5px", fontWeight: 600, color: "#60a5fa" }}>
                  How to generate a real Google OAuth Access Token:
                </div>
                <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", lineHeight: "18px" }}>
                  1. Open <a href="https://developers.google.com/oauthplayground" target="_blank" rel="noreferrer" style={{ color: "#60a5fa", textDecoration: "underline" }}>Google OAuth 2.0 Playground <ExternalLink size={10} style={{ display: "inline" }} /></a>.<br />
                  2. In Step 1, expand <strong style={{ color: "var(--color-text-secondary)" }}>Google OAuth2 API v2</strong> and select <code style={{ color: "#60a5fa" }}>userinfo.email</code> and <code style={{ color: "#60a5fa" }}>userinfo.profile</code>.<br />
                  3. Click <strong style={{ color: "var(--color-text-secondary)" }}>Authorize APIs</strong> and sign in with your real Google account.<br />
                  4. In Step 2, click <strong style={{ color: "var(--color-text-secondary)" }}>Exchange authorization code for tokens</strong> and copy the <strong style={{ color: "var(--color-text-secondary)" }}>Access token</strong>.
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: LOCAL DEVELOPER PROFILE */}
          {activeTab === "local" && (
            !session?.user ? (
              <div style={{
                padding: "24px 20px",
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 14,
                background: "var(--color-modal-card-bg, #191622)",
                border: "1px solid var(--color-modal-border, #2f283a)",
                borderRadius: 8,
              }}>
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  background: "rgba(239, 68, 68, 0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#ef4444",
                }}>
                  <ShieldCheck size={24} />
                </div>
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 4 }}>
                    Active Authentication Required
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", maxWidth: 360, lineHeight: "18px" }}>
                    Demo accounts, mock identities, and unauthenticated profiles are disabled for security. Please sign in with a verified GitHub or Google account to link your developer profile.
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                  <button
                    type="button"
                    onClick={() => { setActiveTab("github"); setError(null); }}
                    style={{
                      padding: "8px 16px",
                      background: "linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)",
                      border: "none",
                      borderRadius: 6,
                      color: "#ffffff",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Sign in with GitHub
                  </button>
                  <button
                    type="button"
                    onClick={() => { setActiveTab("google"); setError(null); }}
                    style={{
                      padding: "8px 16px",
                      background: "var(--color-modal-card-bg, #1e1a29)",
                      border: "1px solid var(--color-modal-border, #2f283a)",
                      borderRadius: 6,
                      color: "var(--color-text-primary)",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Sign in with Google
                  </button>
                </div>
              </div>
            ) : (
            <form onSubmit={handleSaveLocalProfile} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {detectedIdentity?.git?.name && (
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  background: "var(--color-modal-card-bg, #191622)",
                  border: "1px solid var(--color-modal-border-subtle, #241f2d)",
                  borderRadius: 6,
                  fontSize: "11px",
                }}>
                  <div style={{ color: "var(--color-text-tertiary)" }}>
                    Found local Git author: <strong style={{ color: "var(--color-text-secondary)" }}>{detectedIdentity.git.name}</strong> ({detectedIdentity.git.email})
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (detectedIdentity.git?.name) setLocalName(detectedIdentity.git.name);
                      if (detectedIdentity.git?.email) setLocalEmail(detectedIdentity.git.email);
                      if (detectedIdentity.gh?.login) setLocalUsername(detectedIdentity.gh.login);
                      if (detectedIdentity.gh?.avatar_url) setLocalAvatar(detectedIdentity.gh.avatar_url);
                      if (detectedIdentity.gh?.bio) setLocalBio(detectedIdentity.gh.bio);
                    }}
                    style={{
                      background: "rgba(239, 68, 68, 0.15)",
                      border: "1px solid rgba(239, 68, 68, 0.4)",
                      color: "#f87171",
                      padding: "2px 8px",
                      borderRadius: 4,
                      cursor: "pointer",
                      fontSize: "11px",
                      fontWeight: 600,
                    }}
                  >
                    Auto-Fill
                  </button>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 4 }}>
                    Full / Display Name *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Linus Torvalds"
                    value={localName}
                    onChange={(e) => setLocalName(e.target.value)}
                    style={{
                      width: "100%",
                      height: 32,
                      padding: "0 10px",
                      background: "var(--color-modal-input-bg, #1e1a29)",
                      border: "1px solid var(--color-modal-border, #2f283a)",
                      borderRadius: 4,
                      color: "var(--color-text-primary)",
                      fontSize: "12px",
                      outline: "none",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 4 }}>
                    Username
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. torvalds"
                    value={localUsername}
                    onChange={(e) => setLocalUsername(e.target.value)}
                    style={{
                      width: "100%",
                      height: 32,
                      padding: "0 10px",
                      background: "var(--color-modal-input-bg, #1e1a29)",
                      border: "1px solid var(--color-modal-border, #2f283a)",
                      borderRadius: 4,
                      color: "var(--color-text-primary)",
                      fontSize: "12px",
                      outline: "none",
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 4 }}>
                  Git Committer Email
                </label>
                <input
                  type="email"
                  placeholder="developer@example.com"
                  value={localEmail}
                  onChange={(e) => setLocalEmail(e.target.value)}
                  style={{
                    width: "100%",
                    height: 32,
                    padding: "0 10px",
                    background: "var(--color-modal-input-bg, #1e1a29)",
                    border: "1px solid var(--color-modal-border, #2f283a)",
                    borderRadius: 4,
                    color: "var(--color-text-primary)",
                    fontSize: "12px",
                    outline: "none",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 4 }}>
                  Avatar Image URL (optional)
                </label>
                <input
                  type="text"
                  placeholder="https://example.com/avatar.png"
                  value={localAvatar}
                  onChange={(e) => setLocalAvatar(e.target.value)}
                  style={{
                    width: "100%",
                    height: 32,
                    padding: "0 10px",
                    background: "var(--color-modal-input-bg, #1e1a29)",
                    border: "1px solid var(--color-modal-border, #2f283a)",
                    borderRadius: 4,
                    color: "var(--color-text-primary)",
                    fontSize: "12px",
                    outline: "none",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 4 }}>
                  Bio / Status
                </label>
                <input
                  type="text"
                  placeholder="Building frontier apps with Csotic"
                  value={localBio}
                  onChange={(e) => setLocalBio(e.target.value)}
                  style={{
                    width: "100%",
                    height: 32,
                    padding: "0 10px",
                    background: "var(--color-modal-input-bg, #1e1a29)",
                    border: "1px solid var(--color-modal-border, #2f283a)",
                    borderRadius: 4,
                    color: "var(--color-text-primary)",
                    fontSize: "12px",
                    outline: "none",
                  }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    height: 34,
                    padding: "0 18px",
                    background: "linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)",
                    border: "none",
                    borderRadius: 6,
                    color: "#ffffff",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Save Profile
                </button>
              </div>
            </form>
            )
          )}
        </div>

        {/* Modal Footer */}
        <div style={{
          padding: "12px 20px",
          borderTop: "1px solid var(--color-modal-border-subtle, #241f2d)",
          background: "var(--color-modal-header-bg, #17141f)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "11px",
          color: "var(--color-text-tertiary)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <ShieldCheck size={14} style={{ color: "#10b981" }} />
            <span style={{ color: "var(--color-text-secondary)", fontWeight: 500 }}>
              Hardware-Salted Encryption · Zero Cloud Leakage
            </span>
          </div>

          <button
            onClick={onClose}
            style={{
              background: "var(--color-modal-card-bg, #191622)",
              border: "1px solid var(--color-modal-border, #2f283a)",
              color: "var(--color-text-primary)",
              padding: "5px 14px",
              borderRadius: 5,
              cursor: "pointer",
              fontSize: "11.5px",
              fontWeight: 500,
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
