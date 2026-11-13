export interface SmartTaskActions {
  runLabel: string;
  runCmd: string;
  runTitle: string;
  buildLabel: string;
  buildCmd: string;
  buildTitle: string;
  hasBuild: boolean;
}

function sanitizeArg(name: string): string {
  if (name.includes(" ")) {
    return `"${name}"`;
  }
  return name;
}

export function getSmartTaskActions(activeFile?: string | null): SmartTaskActions {
  if (!activeFile) {
    return {
      runLabel: "Dev",
      runCmd: "npm run dev",
      runTitle: "Run Dev Server (npm run dev)",
      buildLabel: "Build",
      buildCmd: "npm run build",
      buildTitle: "Build Project (npm run build)",
      hasBuild: true,
    };
  }

  const cleanPath = activeFile.replace(/\\/g, "/");
  const fileName = cleanPath.split("/").pop() || "";
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase() : "";
  const baseName = fileName.replace(/\.[^/.]+$/, "");
  // Strip leading punctuation and delimiters (e.g. `==`, `,`, `;`) so cmd.exe never misinterprets the binary name
  const safeBase = baseName.replace(/^[^a-zA-Z0-9]+/, "").replace(/[^a-zA-Z0-9_-]/g, "_") || "out";
  const fileArg = sanitizeArg(fileName);
  const outArg = sanitizeArg(`${safeBase}.exe`);

  switch (ext) {
    case ".c":
      return {
        runLabel: `Run`,
        runCmd: `gcc ${fileArg} -o ${outArg} && ${outArg}`,
        runTitle: `Compile & Run ${fileName} (gcc ${fileArg} -o ${outArg} && ${outArg})`,
        buildLabel: `Build`,
        buildCmd: `gcc ${fileArg} -o ${outArg}`,
        buildTitle: `Compile ${fileName} (gcc ${fileArg} -o ${outArg})`,
        hasBuild: true,
      };
    case ".cpp":
    case ".cc":
    case ".cxx":
      return {
        runLabel: `Run`,
        runCmd: `g++ ${fileArg} -o ${outArg} && ${outArg}`,
        runTitle: `Compile & Run ${fileName} (g++ ${fileArg} -o ${outArg} && ${outArg})`,
        buildLabel: `Build`,
        buildCmd: `g++ ${fileArg} -o ${outArg}`,
        buildTitle: `Compile ${fileName} (g++ ${fileArg} -o ${outArg})`,
        hasBuild: true,
      };
    case ".py":
      return {
        runLabel: `Run`,
        runCmd: `python ${fileArg}`,
        runTitle: `Run Python Script (python ${fileArg})`,
        buildLabel: `Build`,
        buildCmd: `python -m py_compile ${fileArg}`,
        buildTitle: `Bytecode Compile ${fileArg}`,
        hasBuild: false,
      };
    case ".rs":
      return {
        runLabel: `Run`,
        runCmd: `cargo run`,
        runTitle: `Run Rust (cargo run)`,
        buildLabel: `Build`,
        buildCmd: `cargo build`,
        buildTitle: `Build Rust (cargo build)`,
        hasBuild: true,
      };
    case ".go":
      return {
        runLabel: `Run`,
        runCmd: `go run ${fileArg}`,
        runTitle: `Run Go file (go run ${fileArg})`,
        buildLabel: `Build`,
        buildCmd: `go build ${fileArg}`,
        buildTitle: `Build Go binary (go build ${fileArg})`,
        hasBuild: true,
      };
    case ".java":
      return {
        runLabel: `Run`,
        runCmd: `java ${fileArg}`,
        runTitle: `Run Java class (java ${fileArg})`,
        buildLabel: `Build`,
        buildCmd: `javac ${fileArg}`,
        buildTitle: `Compile Java (javac ${fileArg})`,
        hasBuild: true,
      };
    case ".js":
    case ".mjs":
    case ".cjs":
      return {
        runLabel: `Run`,
        runCmd: `node ${fileArg}`,
        runTitle: `Run JavaScript with Node (node ${fileArg})`,
        buildLabel: `Build`,
        buildCmd: `npm run build`,
        buildTitle: `Build Project (npm run build)`,
        hasBuild: true,
      };
    case ".ts":
      return {
        runLabel: `Run`,
        runCmd: `npx tsx ${fileArg}`,
        runTitle: `Run TypeScript file (npx tsx ${fileArg})`,
        buildLabel: `Build`,
        buildCmd: `npm run build`,
        buildTitle: `Build Project (npm run build)`,
        hasBuild: true,
      };
    case ".sh":
      return {
        runLabel: `Run`,
        runCmd: `bash ${fileArg}`,
        runTitle: `Run Shell Script (bash ${fileArg})`,
        buildLabel: `Build`,
        buildCmd: ``,
        buildTitle: ``,
        hasBuild: false,
      };
    case ".sal":
    case ".salivo":
      return {
        runLabel: `Run`,
        runCmd: `sf run ${fileArg}`,
        runTitle: `Run Salivo file (sf run ${fileArg})`,
        buildLabel: `Build`,
        buildCmd: `sf build ${fileArg}`,
        buildTitle: `Build Salivo file (sf build ${fileArg})`,
        hasBuild: true,
      };
    case ".ps1":
      return {
        runLabel: `Run`,
        runCmd: `powershell -ExecutionPolicy Bypass -File ${fileArg}`,
        runTitle: `Run PowerShell Script`,
        buildLabel: `Build`,
        buildCmd: ``,
        buildTitle: ``,
        hasBuild: false,
      };
    default:
      return {
        runLabel: "Dev",
        runCmd: "npm run dev",
        runTitle: "Run Dev Server (npm run dev)",
        buildLabel: "Build",
        buildCmd: "npm run build",
        buildTitle: "Build Project (npm run build)",
        hasBuild: true,
      };
  }
}

export function runTask(kind: "run" | "build", activeFile?: string | null, projectPath?: string): void {
  const actions = getSmartTaskActions(activeFile);
  const command = kind === "run" ? actions.runCmd : actions.buildCmd;
  if (!command) return;

  const isFileTask = !!activeFile && !activeFile.includes("://") && !/^npm /.test(command);
  const fileDir = activeFile ? activeFile.replace(/\\/g, "/").replace(/\/[^/]*$/, "") : "";
  const cwd = isFileTask && fileDir ? fileDir : projectPath;

  window.dispatchEvent(new CustomEvent("csotic:open-terminal", { detail: { cmd: command, cwd } }));
}
