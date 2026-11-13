import { useRef, useEffect } from "react";
import { 
  User, 
  Settings, 
  LogOut, 
  Cloud 
} from "lucide-react";
import type { AuthSession } from "../types/auth";

interface AccountFlyoutProps {
  isOpen: boolean;
  onClose: () => void;
  session: AuthSession | null;
  onOpenAuthModal: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

export function AccountFlyout({
  isOpen,
  onClose,
  session,
  onOpenAuthModal,
  onOpenSettings,
  onLogout,
}: AccountFlyoutProps) {
  const flyoutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (flyoutRef.current && !flyoutRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("mousedown", handleOutsideClick);
    return () => window.removeEventListener("mousedown", handleOutsideClick);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={flyoutRef}
      style={{
        position: "fixed",
        bottom: 52,
        left: 56,
        zIndex: 9998,
        width: 280,
        background: "var(--color-flyout-bg, #14121a)",
        border: "1px solid var(--color-modal-border, #2f283a)",
        borderRadius: 10,
        boxShadow: "0 16px 40px rgba(0,0,0,0.9), 0 0 1px 1px rgba(255, 255, 255, 0.08)",
        overflow: "hidden",
        animation: "slideInUp 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {session?.user ? (
        /* Logged In State */
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{
            padding: "14px",
            borderBottom: "1px solid var(--color-modal-border-subtle, #241f2d)",
            background: "var(--color-modal-header-bg, #17141f)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}>
            {session.user.avatarUrl ? (
              <img
                src={session.user.avatarUrl}
                alt={session.user.name}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  objectFit: "cover",
                  border: "2px solid #ef4444",
                }}
              />
            ) : (
              <div style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "rgba(239, 68, 68, 0.2)",
                border: "2px solid #ef4444",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ffffff",
                fontWeight: 700,
                fontSize: "14px",
              }}>
                {session.user.name.charAt(0).toUpperCase()}
              </div>
            )}

            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontWeight: 700, fontSize: "13px", color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {session.user.name}
                </span>
              </div>
              <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                @{session.user.username}
              </div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 3, marginTop: 3 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} />
                <span style={{ fontSize: "9.5px", color: "#10b981", fontWeight: 600 }}>
                  {session.provider === "github" ? "GitHub Connected" : session.provider === "google" ? "Google Connected" : "Local Profile"}
                </span>
              </div>
            </div>
          </div>

          {/* Sync Status Banner */}
          <div style={{
            padding: "8px 14px",
            background: "var(--color-modal-card-bg, #191622)",
            borderBottom: "1px solid var(--color-modal-border-subtle, #241f2d)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "11px",
            color: "var(--color-text-secondary)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Cloud size={13} style={{ color: "#34d399" }} />
              <span>Settings Sync is On</span>
            </div>
            <span style={{ fontSize: "9.5px", color: "var(--color-text-tertiary)" }}>Active</span>
          </div>

          {/* Action List */}
          <div style={{ padding: "4px", display: "flex", flexDirection: "column", gap: 2 }}>
            <button
              onClick={() => { onClose(); onOpenAuthModal(); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                fontSize: "12px",
                fontWeight: 500,
                color: "var(--color-text-primary)",
                background: "transparent",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.1s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-flyout-item-hover, #211c2a)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <User size={14} style={{ color: "var(--color-text-secondary)" }} />
              <span>Manage Profile & Accounts</span>
            </button>

            <button
              onClick={() => { onClose(); onOpenSettings(); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                fontSize: "12px",
                fontWeight: 500,
                color: "var(--color-text-primary)",
                background: "transparent",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.1s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-flyout-item-hover, #211c2a)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <Settings size={14} style={{ color: "var(--color-text-secondary)" }} />
              <span>Settings & Preferences</span>
            </button>

            <div style={{ height: 1, background: "var(--color-modal-border-subtle, #241f2d)", margin: "2px 0" }} />

            <button
              onClick={() => { onClose(); onLogout(); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                fontSize: "12px",
                fontWeight: 500,
                color: "#f87171",
                background: "transparent",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.1s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <LogOut size={14} />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      ) : (
        /* Logged Out State */
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{
            padding: "16px 14px 12px",
            borderBottom: "1px solid var(--color-modal-border-subtle, #241f2d)",
            background: "var(--color-modal-header-bg, #17141f)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <div style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "var(--color-modal-card-bg, #191622)",
                border: "1px solid var(--color-modal-border-subtle, #241f2d)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--color-text-tertiary)",
              }}>
                <User size={15} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: "13px", color: "var(--color-text-primary)" }}>
                  Sign in to Csotic
                </div>
                <div style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)" }}>
                  Sync settings, keybindings, and extensions
                </div>
              </div>
            </div>
          </div>

          <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: 6 }}>
            <button
              onClick={() => { onClose(); onOpenAuthModal(); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                fontSize: "12px",
                fontWeight: 600,
                color: "#ffffff",
                background: "linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                justifyContent: "center",
                boxShadow: "0 2px 8px rgba(239, 68, 68, 0.3)",
              }}
            >
              {/* GitHub SVG */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
              <span>Sign in with GitHub / Google</span>
            </button>

            <button
              onClick={() => { onClose(); onOpenSettings(); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                fontSize: "11.5px",
                color: "var(--color-text-secondary)",
                background: "transparent",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-flyout-item-hover, #211c2a)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <Settings size={13} />
              <span>Open Settings</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
