# Csotic

High-performance, local-first artificial intelligence software engineering environment and desktop IDE.

Csotic is a local-first software engineering workbench built on Tauri v2, Rust, React 19, and TypeScript. It bridges native developer workflows with autonomous model orchestration, AST code indexing, compensating transaction changesets, Obsidian-compatible brain vaults, and dynamic extension hosting while enforcing strict architectural and path-traversal security boundaries.

---

## Architectural Highlights

### Compensating Transaction Changeset Engine (Saga Pattern)
- Filesystem mutations follow a strict saga lifecycle: `Planned` -> `Reading` -> `Validating` -> `Ready` -> `Applying` -> `Applied` / `RolledBack`.
- Pre-flight invariant validation verifies workspace hash integrity against active runtime state prior to committing edits to disk.
- Synchronous SQLite undo journaling (`rollback_journal_entries`) records full before-states and SHA-256 hashes, ensuring crash resilience.
- Single-turn and multi-turn session rollback capabilities enable immediate reversion of agent-generated mutations.

### Universal Model Orchestration and Cryptographic Vault
- Local-first offline inference support via Ollama with automated model discovery, pulling, and streaming.
- Multi-provider cloud routing for OpenAI, Anthropic Claude, DeepSeek, Groq, Google Gemini, and OpenRouter.
- Hardware-salted XOR encryption (`enc_v1:`) using machine entropy (`HOSTNAME` + `USERNAME` + SHA-256) for secure local credential storage.
- Interface-level credential masking to prevent token leakage.

### Autonomous Multi-Turn Coding Agent and Context Engine
- Multi-step reasoning loop with intent-filtered tool calling: `read_file`, `create_file`, `modify_file`, `patch_file`, `replace_file`, `delete_file`, `move_file`, `copy_file`, `run_command`, and `git_commit`.
- Dynamic context budgeting that prioritizes runtime error logs, security alerts, and semantic relationships over static file data.
- Structured reasoning streams rendered in collapsible thought sections for complete execution transparency.

### Knowledge Graph and Vault Architecture
- Obsidian-compatible markdown vault (`.forge/brain`) supporting bidirectional wikilinks (`[[document.md]]`) and Architectural Decision Records (ADRs).
- Real-time 2D interactive node-edge graph visualization with active source-code link verification.

### Workbench and Integrated Monaco Editor
- Monaco code editor with multi-tab split layouts, breadcrumbs, unified diff views, live web preview, and markdown preview.
- Inline AI Copilot (`Ctrl+K`) for surgical, in-place code transformations.
- Streaming asynchronous terminal with real-time output parsing, risk classification (Critical, High, Medium, Low), and container sandbox support.

### Tree-Sitter AST Code Indexing
- Deep structural parsing for Rust, TypeScript, JavaScript, Python, and C/C++.
- Extracts functions, structs, classes, interfaces, traits, and enums with line-level coordinates into embedded SQLite for sub-millisecond retrieval.

### Security and Path-Traversal Guardrails
- IPC-layer path normalization and canonicalization locking file operations strictly within project boundaries.
- Rate-limited authentication safeguards and static security scanners detecting exposed secrets, SQL injections, and command injections.

---

## Distribution Packages

Ready-to-use production installers are maintained in the [`dist-installer/`](./dist-installer/) directory:

| Platform | Package Format | Binary / Installer | Build Command |
| :--- | :--- | :--- | :--- |
| Windows | NSIS Setup Executable | `dist-installer/Csotic-Setup-v0.1.0-win-x64.exe` | `npm run build:installer:win` |
| Windows | WiX MSI Installer | `dist-installer/Csotic-Setup-v0.1.0-win-x64.msi` | `npm run build:installer:win` |
| Linux (Ubuntu / Debian) | Debian Package (`.deb`) | Generated via script | `bash scripts/package-linux.sh` |
| Linux (Generic) | Standalone AppImage | Generated via script | `bash scripts/package-linux.sh` |
| macOS | Disk Image (`.dmg`) & App Bundle | Generated via script | `bash scripts/package-macos.sh` |

---

## Development and Verification

### Prerequisites
- Node.js (version 20 or later recommended)
- Rust (version 1.75 or later with Cargo)
- WebView2 runtime (standard on Windows 10/11)

### Commands
```bash
# Install frontend dependencies
npm install

# Start development server with live reload
npm run dev

# Verify IPC contract integrity
npm run check:ipc

# Execute authentication and security test suite
npm run test:auth

# Compile production frontend bundle
npm run build
```

---

## Author and Credits

Csotic was conceived, designed, and developed by **Ciel-441**. Full credit for project architecture, implementation, and maintenance belongs to the author.

[![Author: Ciel-441](https://img.shields.io/badge/Author%20%26%20Architect-Ciel--441-0D1117?style=for-the-badge&logo=github&logoColor=ffffff&labelColor=161B22&color=1F6FEB)](https://github.com/Ciel-441)
[![GitHub Profile](https://img.shields.io/badge/GitHub-Ciel--441-238636?style=for-the-badge&logo=github&logoColor=ffffff)](https://github.com/Ciel-441)

Repository: [https://github.com/Ciel-441](https://github.com/Ciel-441)

---

## License

Distributed under the MIT License. See [`LICENSE`](./LICENSE) for full details.
