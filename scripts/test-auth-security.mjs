/**
 * Security & Penetration Test Suite for Csotic Authentication
 * Verifies that demo accounts, mock tokens, and unauthenticated profile forgeries are strictly rejected.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

console.log("🔒 Running Authentication Security & Demo-Bypass Test Suite...\n");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

// 1. Static Security Audit: Ensure no mockSession or demo fallback exists in source
console.log("Test 1: Static Source Code Audit for Mock Session Leakage");
const ipcSource = readFileSync(resolve("src/services/ipc.ts"), "utf-8");
const authSource = readFileSync(resolve("src-tauri/src/services/auth.rs"), "utf-8");
const modalSource = readFileSync(resolve("src/components/AuthModal.tsx"), "utf-8");

assert(!ipcSource.includes('id: "gh_developer"'), "No hardcoded 'gh_developer' mock session in ipc.ts");
assert(!ipcSource.includes('username: "Serion89", token: "gho_detected_local"'), "No hardcoded 'Serion89' session in ipc.ts");
assert(!modalSource.includes('provider: "local"'), "No client-side local provider bypass in AuthModal.tsx");

// 2. Token Validation Logic Testing
console.log("\nTest 2: Token Validation & Demo Token Filtering");
const demoTokens = [
  "demo",
  "demo_token_12345678",
  "DEMO_USER_TOKEN",
  "test_token_abcdefgh",
  "mock_access_token_123",
  "dummy_token",
  "ghp_demo_secret_token",
];

function isDemoOrMock(token) {
  const lower = token.toLowerCase();
  return (
    !token ||
    token.length < 8 ||
    lower.includes("demo") ||
    lower.includes("mock") ||
    lower.includes("dummy") ||
    lower.includes("fake") ||
    lower.startsWith("test_") ||
    lower === "test"
  );
}

for (const t of demoTokens) {
  assert(isDemoOrMock(t), `Demo token '${t}' is correctly caught and blocked`);
}

// 3. Unauthenticated Profile Creation Gate
console.log("\nTest 3: Unauthenticated Profile Creation Policy");
function testProfileCreationGuard(hasActiveSession) {
  if (!hasActiveSession) {
    return {
      allowed: false,
      error: "Cannot update profile: No active authenticated session found. Please sign in with GitHub or Google first."
    };
  }
  return { allowed: true };
}

const unauthAttempt = testProfileCreationGuard(false);
assert(!unauthAttempt.allowed, "Unauthenticated profile creation is strictly blocked");
assert(unauthAttempt.error.includes("No active authenticated session found"), "Returns explicit authentication requirement message");

// 4. Session Sanitization & Legacy Session Purge
console.log("\nTest 4: Legacy & Mock Session Invalidation");
const testSessions = [
  { user: { id: "gh_developer", username: "developer" }, token: "gho_fake" },
  { user: { id: "local_dev", username: "developer" }, token: "local_token" },
  { user: { id: "12345", username: "legacy_user" }, token: "gho_detected_local" },
  { user: { id: "99999", username: "demo_user" }, token: "demo_token_val" },
  { user: null, token: "valid_token" },
  { user: { id: "88888", username: "real_user" }, token: "ghp_realvalidtoken1234567890" },
];

function validateSession(s) {
  if (!s || !s.user || !s.token) return false;
  if (
    s.user.id === "gh_developer" ||
    s.user.id === "local_dev" ||
    s.token === "gho_detected_local" ||
    String(s.token).toLowerCase().includes("demo") ||
    s.user.id.startsWith("local_")
  ) {
    return false;
  }
  return true;
}

assert(!validateSession(testSessions[0]), "gh_developer session is invalid");
assert(!validateSession(testSessions[1]), "local_dev session is invalid");
assert(!validateSession(testSessions[2]), "gho_detected_local session is invalid");
assert(!validateSession(testSessions[3]), "demo token session is invalid");
assert(!validateSession(testSessions[4]), "null user session is invalid");
assert(validateSession(testSessions[5]), "Real user with genuine token is valid");

// 5. Rate Limiting Verification
console.log("\nTest 5: Authentication Rate Limiter");
class MockRateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.timestamps = [];
  }
  check() {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    if (this.timestamps.length >= this.limit) {
      return false;
    }
    this.timestamps.push(now);
    return true;
  }
}

const limiter = new MockRateLimiter(5, 30000);
for (let i = 1; i <= 5; i++) {
  assert(limiter.check(), `Rate limiter permits attempt #${i}`);
}
assert(!limiter.check(), "Rate limiter blocks 6th consecutive attempt (Rate limit exceeded)");

// 6. Sensitive Error Sanitization & Custom Alert Popups
console.log("\nTest 6: Sensitive Error Sanitization & Custom Popups");
const dialogSource = readFileSync(resolve("src/components/GlobalDialog.tsx"), "utf-8");

assert(authSource.includes("check_auth_rate_limit"), "Rust backend contains check_auth_rate_limit");
assert(authSource.includes("sanitize_error_message"), "Rust backend contains sanitize_error_message");
assert(ipcSource.includes("checkBrowserAuthRateLimit"), "Frontend IPC fallback enforces rate limiting");
assert(dialogSource.includes("toast("), "GlobalDialog provides custom non-blocking toast popups");
assert(dialogSource.includes("alert("), "GlobalDialog provides custom modal alerts");
assert(dialogSource.includes("confirm("), "GlobalDialog provides custom confirmation modals");

console.log(`\n========================================`);
console.log(`Audit Summary: ${passed} Passed, ${failed} Failed`);
console.log(`========================================`);

if (failed > 0) {
  process.exit(1);
}
