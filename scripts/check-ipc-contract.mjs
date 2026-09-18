import fs from "fs";
import path from "path";

const rootDir = process.cwd();
const srcDir = path.join(rootDir, "src");
const tauriSrcDir = path.join(rootDir, "src-tauri", "src");

function findFiles(dir, exts) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".git" && entry.name !== "target") {
        results = results.concat(findFiles(fullPath, exts));
      }
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

// 1. Extract frontend IPC calls
const tsFiles = findFiles(srcDir, [".ts", ".tsx"]);
const frontendCalls = new Map(); // key: "service:action" => Set of source files

const ipcCallRegex = /ipcRequest\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g;

for (const file of tsFiles) {
  const content = fs.readFileSync(file, "utf-8");
  let match;
  while ((match = ipcCallRegex.exec(content)) !== null) {
    const service = match[1];
    const action = match[2];
    const key = `${service}:${action}`;
    if (!frontendCalls.has(key)) {
      frontendCalls.set(key, { service, action, files: new Set() });
    }
    frontendCalls.get(key).files.add(path.relative(rootDir, file));
  }
}

console.log(`Found ${frontendCalls.size} unique frontend IPC calls.`);

// 2. Read backend files
const commandsFile = path.join(tauriSrcDir, "ipc", "commands.rs");
const commandsContent = fs.readFileSync(commandsFile, "utf-8");

const serviceFiles = new Map();
const servicesDir = path.join(tauriSrcDir, "services");
if (fs.existsSync(servicesDir)) {
  for (const entry of fs.readdirSync(servicesDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".rs")) {
      const name = entry.name.replace(".rs", "");
      serviceFiles.set(name, fs.readFileSync(path.join(servicesDir, entry.name), "utf-8"));
    }
  }
}

// 3. Verify each frontend call has a backend arm
const missing = [];
const verified = [];

for (const [key, { service, action, files }] of frontendCalls) {
  // Check if service exists in commands.rs
  const serviceRegex = new RegExp(`"${service}"\\s*=>`);
  if (!serviceRegex.test(commandsContent)) {
    missing.push({ service, action, reason: `Service "${service}" not found in commands.rs`, files: Array.from(files) });
    continue;
  }

  // If commands.rs handles actions inline (e.g. changeset, window, project_state)
  if (service === "project_state") {
    // project_state has single handler
    verified.push(key);
    continue;
  }

  const actionPattern = `"${action}"`;

  // Check inline handling in commands.rs
  if (commandsContent.includes(`"${service}"`) && commandsContent.includes(actionPattern)) {
    verified.push(key);
    continue;
  }

  // Check service file
  const serviceContent = serviceFiles.get(service);
  if (!serviceContent) {
    missing.push({ service, action, reason: `Backend service file for "${service}" not found`, files: Array.from(files) });
    continue;
  }

  if (serviceContent.includes(actionPattern)) {
    verified.push(key);
  } else {
    missing.push({ service, action, reason: `Action "${action}" not found in services/${service}.rs`, files: Array.from(files) });
  }
}

console.log(`\nVerified ${verified.length} / ${frontendCalls.size} IPC contracts.`);

if (missing.length > 0) {
  console.error(`\nFAILED: Found ${missing.length} unmatched IPC call(s):`);
  for (const item of missing) {
    console.error(`  - [${item.service}:${item.action}]: ${item.reason} (called in ${item.files.join(", ")})`);
  }
  process.exit(1);
} else {
  console.log("SUCCESS: All frontend IPC calls match backend handlers!");
  process.exit(0);
}
