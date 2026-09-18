# Forge ⚒️

> **The Local-First, Security-Enforced AI Software Engineering Workbench.**

Forge is a high-performance desktop application and AI coding environment built on **Tauri v2**, **Rust**, **React**, and **TypeScript**. It bridges local developer workflows with autonomous LLM execution while maintaining strict security boundaries, real-time terminal streaming, and extensible workspace plugins.

---

## ⚡ Key Features

- **🛡️ Strict Path-Traversal Guard & Security Boundaries**:
  - Direct filesystem mutations are strictly contained within the active project directory using component-normalized path canonicalization.
  - Multi-profile permission model (`read_only`, `developer`, `full_automation`) enforced at the native IPC layer.

- **🤖 LLM Architecture & Multi-Agent Orchestration**:
  - **Planner Agent**: Reasoned, structured task-graph generation evaluating dependencies, risks, and complexity.
  - **Coding & Review Agents**: Automated implementation and review pipelines.
  - **Objective-Based Memory Retrieval**: Keyword-overlap relevance scoring to inject high-signal project conventions into prompts.
  - **Context Character Budgeting**: Intelligent priority-based context allocation (Runtime > Security > Predictive > Memory > Graph) preventing token blowouts.

- **💻 Real-Time Terminal Streaming**:
  - Line-by-line asynchronous stdout/stderr streaming via `tokio::io::BufReader`.
  - Sandboxed command execution with containerized Docker environments (`Node`, `Python`, `Rust`) and graceful local fallback.

- **📊 Dynamic Workspace Plugins**:
  - Zero-recompile extensibility. Define custom developer tools in `.forge/plugins/*.json` with live dynamic hot-reloading.

- **🔍 Integrated Diagnostics & Live Bottom Dock**:
  - Live **Problems Panel** powered by real-time Git status diagnostics.
  - Subsystem status tracking (**Tasks Panel**) and live output consoles.
  - Document & PDF context extraction integrated into chat prompts.

---

## 🏗️ Architecture Stack

- **Frontend**: React 18, TypeScript, Vite, Vanilla CSS Design Tokens (Dark Mode, Glassmorphism, Micro-animations)
- **Backend Core**: Tauri v2, Rust (Tokio, Rusqlite, Serde)
- **Database**: Embedded SQLite (Project Indexing, Graph Dependencies, Persistent Memories, Workspace Layouts)
- **Local AI Engine**: Ollama API integration + Cloud Model Routing Support

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/) (v1.75+)
- [Tauri CLI Prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/forge.git
   cd forge
   ```

2. **Install Frontend Dependencies:**
   ```bash
   npm install
   ```

3. **Run in Development Mode:**
   ```bash
   npm run tauri dev
   ```

4. **Build Production Application:**
   ```bash
   npm run tauri build
   ```

---

## 🧪 Testing

Run backend Rust unit tests:
```bash
cd src-tauri
cargo test
```

Run frontend type checking & production build verification:
```bash
npm run build
```

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](./LICENSE) for more information.
