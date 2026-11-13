use std::sync::RwLock;
use once_cell::sync::Lazy;
use std::fs;
use std::path::Path;
use std::process::Command;

pub trait ForgePlugin: Send + Sync {
    fn name(&self) -> String;
    fn description(&self) -> String;
    fn project_path(&self) -> Option<String> { None }
    fn analyze(&self, _project_path: &str) -> Vec<String> { Vec::new() }
    fn get_tools(&self) -> Vec<serde_json::Value> { Vec::new() }
    fn execute_tool(&self, _name: &str, _args: &serde_json::Value) -> Option<Result<String, String>> { None }
}

pub struct PluginRegistry {
    pub plugins: Vec<Box<dyn ForgePlugin>>,
    pub loaded_workspaces: std::collections::HashSet<String>,
    pub trusted_workspaces: std::collections::HashSet<String>,
}

impl PluginRegistry {
    pub fn new() -> Self {
        Self { 
            plugins: Vec::new(),
            loaded_workspaces: std::collections::HashSet::new(),
            trusted_workspaces: std::collections::HashSet::new(),
        }
    }
    
    #[allow(dead_code)]
    pub fn register(&mut self, plugin: Box<dyn ForgePlugin>) {
        self.plugins.push(plugin);
    }
    
    pub fn run_analyzers(&self, project_path: &str) -> Vec<String> {
        let mut warnings = Vec::new();
        for p in &self.plugins {
            warnings.extend(p.analyze(project_path));
        }
        warnings
    }
    
    pub fn get_all_tools(&self) -> Vec<serde_json::Value> {
        let mut tools = Vec::new();
        for p in &self.plugins {
            tools.extend(p.get_tools());
        }
        tools
    }
    
    pub fn execute_tool(&self, name: &str, args: &serde_json::Value) -> Option<Result<String, String>> {
        for p in &self.plugins {
            if let Some(res) = p.execute_tool(name, args) {
                return Some(res);
            }
        }
        None
    }
}

pub static REGISTRY: Lazy<RwLock<PluginRegistry>> = Lazy::new(|| {
    let reg = PluginRegistry::new();
    RwLock::new(reg)
});

#[allow(dead_code)]
pub fn register_plugin(plugin: Box<dyn ForgePlugin>) {
    if let Ok(mut reg) = REGISTRY.write() {
        reg.register(plugin);
    }
}

pub async fn handle(action: &str, payload: &serde_json::Value) -> Result<serde_json::Value, String> {
    match action {
        "get_plugins" => {
            let mut p_info = Vec::new();
            if let Ok(reg) = REGISTRY.read() {
                for p in &reg.plugins {
                    p_info.push(serde_json::json!({
                        "name": p.name(),
                        "description": p.description(),
                    }));
                }
            }
            Ok(serde_json::json!({ "plugins": p_info }))
        }
        "install_extension" => {
            let id = payload.get("id").and_then(|v| v.as_str()).ok_or("Missing extension 'id'")?;
            let download_url = payload.get("download_url").and_then(|v| v.as_str()).unwrap_or("");
            install_extension(id, download_url, payload.clone()).await
        }
        "uninstall_extension" => {
            let id = payload.get("id").and_then(|v| v.as_str()).ok_or("Missing extension 'id'")?;
            uninstall_extension(id)
        }
        "get_installed_extensions" => {
            get_installed_extensions()
        }
        "trust_workspace" => {
            if let Some(project_path) = payload.get("project_path").and_then(|v| v.as_str()) {
                if let Ok(mut reg) = REGISTRY.write() {
                    reg.trusted_workspaces.insert(project_path.to_string());
                }
                reload_workspace_plugins(project_path);
                Ok(serde_json::json!({ "trusted": true }))
            } else {
                Err("Missing project_path".to_string())
            }
        }
        "is_workspace_trusted" => {
            let project_path = payload.get("project_path").and_then(|v| v.as_str()).unwrap_or("");
            let trusted = if let Ok(reg) = REGISTRY.read() {
                reg.trusted_workspaces.contains(project_path)
            } else {
                false
            };
            Ok(serde_json::json!({ "trusted": trusted }))
        }
        "untrust_workspace" => {
            if let Some(project_path) = payload.get("project_path").and_then(|v| v.as_str()) {
                if let Ok(mut reg) = REGISTRY.write() {
                    reg.trusted_workspaces.remove(project_path);
                    reg.plugins.retain(|p| p.project_path().as_deref() != Some(project_path));
                    reg.loaded_workspaces.remove(project_path);
                }
                Ok(serde_json::json!({ "trusted": false }))
            } else {
                Err("Missing project_path".to_string())
            }
        }
        "scaffold_plugin" => {
            if let Some(project_path) = payload.get("project_path").and_then(|v| v.as_str()) {
                let plugins_dir = Path::new(project_path).join(".forge").join("plugins");
                if let Err(e) = fs::create_dir_all(&plugins_dir) {
                    return Err(format!("Failed to create plugins directory: {}", e));
                }
                let template = serde_json::json!({
                    "name": "My Custom Plugin",
                    "description": "Custom tools for this project",
                    "tools": [
                        {
                            "name": "run_custom_script",
                            "description": "Executes my custom script",
                            "command": "echo 'Hello from custom tool!'",
                            "parameters": {
                                "type": "object",
                                "properties": {},
                                "required": []
                            }
                        }
                    ]
                });
                let template_str = serde_json::to_string_pretty(&template)
                    .map_err(|e| format!("Failed to serialize template: {e}"))?;
                let file_path = plugins_dir.join("my_custom_plugin.json");
                if let Err(e) = fs::write(&file_path, template_str) {
                    return Err(format!("Failed to write plugin template: {}", e));
                }
                // Reload workspace plugins so the newly created plugin is immediately registered
                reload_workspace_plugins(project_path);
                
                Ok(serde_json::json!({ "success": true, "path": file_path.to_string_lossy().to_string() }))
            } else {
                Err("Missing project_path".to_string())
            }
        }
        _ => Err(format!("Unknown plugins action: {action}")),
    }
}

fn get_global_extensions_dir() -> std::path::PathBuf {
    let base = if let Ok(home) = std::env::var("USERPROFILE") {
        std::path::PathBuf::from(home)
    } else if let Ok(home) = std::env::var("HOME") {
        std::path::PathBuf::from(home)
    } else {
        std::path::PathBuf::from(".")
    };
    base.join(".forge").join("extensions")
}

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), dst.join(entry.file_name()))?;
        }
    }
    Ok(())
}

fn read_extensions_index(index_file: &Path) -> Vec<serde_json::Value> {
    if !index_file.exists() {
        return Vec::new();
    }
    let content = match fs::read_to_string(index_file) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    if let Ok(list) = serde_json::from_str::<Vec<serde_json::Value>>(&content) {
        return list;
    }
    if let Ok(single) = serde_json::from_str::<serde_json::Value>(&content) {
        if single.is_object() {
            return vec![single];
        }
    }
    Vec::new()
}

pub async fn install_extension(
    id: &str,
    download_url: &str,
    meta: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let ext_dir = get_global_extensions_dir();
    let target_dir = ext_dir.join(id);

    // 1. Fast path: If already exists on disk and has package.json, instantly succeed!
    let existing_dir = if target_dir.join("package.json").exists() {
        Some(target_dir.clone())
    } else if let Ok(entries) = fs::read_dir(&ext_dir) {
        entries.flatten().find(|e| {
            e.path().is_dir() 
                && e.file_name().to_string_lossy().to_lowercase() == id.to_lowercase() 
                && e.path().join("package.json").exists()
        }).map(|e| e.path())
    } else {
        None
    };

    if let Some(found_path) = existing_dir {
        let index_file = ext_dir.join("extensions.json");
        let mut current_list = read_extensions_index(&index_file);
        current_list.retain(|item| item.get("id").and_then(|v| v.as_str()).map(|s| s.to_lowercase()) != Some(id.to_lowercase()));
        let mut meta_obj = meta;
        if let Some(obj) = meta_obj.as_object_mut() {
            obj.insert("installed".to_string(), serde_json::Value::Bool(true));
            obj.insert("enabled".to_string(), serde_json::Value::Bool(true));
        }
        current_list.push(meta_obj);
        if let Ok(json_str) = serde_json::to_string_pretty(&current_list) {
            let _ = fs::write(&index_file, json_str);
        }
        return Ok(serde_json::json!({
            "success": true,
            "id": id,
            "path": found_path.to_string_lossy().to_string(),
            "already_installed": true
        }));
    }

    // 2. Fast path: Check if installed in standard ~/.vscode/extensions/
    let base_home = if let Ok(home) = std::env::var("USERPROFILE") {
        std::path::PathBuf::from(home)
    } else if let Ok(home) = std::env::var("HOME") {
        std::path::PathBuf::from(home)
    } else {
        std::path::PathBuf::from(".")
    };
    let vscode_ext_dir = base_home.join(".vscode").join("extensions");
    if vscode_ext_dir.exists() {
        let id_lower = id.to_lowercase();
        if let Ok(entries) = fs::read_dir(&vscode_ext_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string().to_lowercase();
                if name.starts_with(&id_lower) || id_lower.starts_with(&name) {
                    let pkg_p = entry.path().join("package.json");
                    if pkg_p.exists() {
                        let _ = copy_dir_all(&entry.path(), &target_dir);
                        if target_dir.join("package.json").exists() {
                            let index_file = ext_dir.join("extensions.json");
                            let mut current_list = read_extensions_index(&index_file);
                            current_list.retain(|item| item.get("id").and_then(|v| v.as_str()).map(|s| s.to_lowercase()) != Some(id.to_lowercase()));
                            let mut meta_obj = meta;
                            if let Some(obj) = meta_obj.as_object_mut() {
                                obj.insert("installed".to_string(), serde_json::Value::Bool(true));
                                obj.insert("enabled".to_string(), serde_json::Value::Bool(true));
                            }
                            current_list.push(meta_obj);
                            if let Ok(json_str) = serde_json::to_string_pretty(&current_list) {
                                let _ = fs::write(&index_file, json_str);
                            }
                            return Ok(serde_json::json!({
                                "success": true,
                                "id": id,
                                "path": target_dir.to_string_lossy().to_string(),
                                "imported_from_vscode": true
                            }));
                        }
                    }
                }
            }
        }
    }

    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;

    // Determine download URL (fallback to resolving metadata if missing)
    let url_to_use = if !download_url.is_empty() {
        download_url.to_string()
    } else {
        let parts: Vec<&str> = id.split('.').collect();
        if parts.len() == 2 {
            let meta_url = format!("https://open-vsx.org/api/{}/{}", parts[0], parts[1]);
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Csotic/0.1.0")
                .build()
                .map_err(|e| format!("Client creation error: {e}"))?;
            if let Ok(resp) = client.get(&meta_url).send().await {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    json.pointer("/files/download")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_default()
                } else {
                    String::new()
                }
            } else {
                String::new()
            }
        } else {
            String::new()
        }
    };

    if url_to_use.is_empty() {
        return Err(format!("Could not resolve download URL for extension: {id}"));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Csotic/0.1.0")
        .build()
        .map_err(|e| format!("Client error: {e}"))?;

    let response = client
        .get(&url_to_use)
        .send()
        .await
        .map_err(|e| format!("Download error: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read bytes: {e}"))?;

    // Unpack VSIX in a background thread to prevent blocking async executor
    let target_dir_clone = target_dir.clone();
    tokio::task::spawn_blocking(move || {
        let reader = std::io::Cursor::new(bytes);
        let mut archive = zip::ZipArchive::new(reader)
            .map_err(|e| format!("Invalid VSIX/ZIP archive: {e}"))?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i)
                .map_err(|e| format!("Error reading archive index {i}: {e}"))?;
            
            let raw_path = match file.enclosed_name() {
                Some(path) => path.to_owned(),
                None => continue,
            };

            // In VSIX packages, the actual extension payload is located inside "extension/"
            let relative_path = if let Ok(stripped) = raw_path.strip_prefix("extension") {
                stripped.to_path_buf()
            } else {
                raw_path
            };

            if relative_path.as_os_str().is_empty() {
                continue;
            }

            let outpath = target_dir_clone.join(relative_path);
            if file.is_dir() {
                let _ = fs::create_dir_all(&outpath);
            } else {
                if let Some(p) = outpath.parent() {
                    let _ = fs::create_dir_all(p);
                }
                if let Ok(mut outfile) = fs::File::create(&outpath) {
                    let _ = std::io::copy(&mut file, &mut outfile);
                }
            }
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Unpack task error: {e}"))??;

    // Update extensions.json index
    let index_file = ext_dir.join("extensions.json");
    let mut current_list = read_extensions_index(&index_file);
    current_list.retain(|item| item.get("id").and_then(|v| v.as_str()).map(|s| s.to_lowercase()) != Some(id.to_lowercase()));
    let mut meta_obj = meta;
    if let Some(obj) = meta_obj.as_object_mut() {
        obj.insert("installed".to_string(), serde_json::Value::Bool(true));
        obj.insert("enabled".to_string(), serde_json::Value::Bool(true));
    }
    current_list.push(meta_obj);

    if let Ok(json_str) = serde_json::to_string_pretty(&current_list) {
        let _ = fs::write(&index_file, json_str);
    }

    Ok(serde_json::json!({
        "success": true,
        "id": id,
        "path": target_dir.to_string_lossy().to_string()
    }))
}

pub fn uninstall_extension(id: &str) -> Result<serde_json::Value, String> {
    let ext_dir = get_global_extensions_dir();
    let target_dir = ext_dir.join(id);
    if target_dir.exists() {
        let _ = fs::remove_dir_all(&target_dir);
    }
    if let Ok(entries) = fs::read_dir(&ext_dir) {
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().to_lowercase() == id.to_lowercase() {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }

    let index_file = ext_dir.join("extensions.json");
    let mut current_list = read_extensions_index(&index_file);
    current_list.retain(|item| item.get("id").and_then(|v| v.as_str()).map(|s| s.to_lowercase()) != Some(id.to_lowercase()));
    if let Ok(json_str) = serde_json::to_string_pretty(&current_list) {
        let _ = fs::write(&index_file, json_str);
    }

    Ok(serde_json::json!({ "success": true, "id": id }))
}

pub fn get_installed_extensions() -> Result<serde_json::Value, String> {
    let ext_dir = get_global_extensions_dir();
    let index_file = ext_dir.join("extensions.json");
    let mut list = read_extensions_index(&index_file);

    // Scan the filesystem to discover any extensions in the directory that might be missing from the index
    if let Ok(entries) = fs::read_dir(&ext_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let id = entry.file_name().to_string_lossy().to_string();
                if !list.iter().any(|item| item.get("id").and_then(|v| v.as_str()).map(|s| s.to_lowercase()) == Some(id.to_lowercase())) {
                    let pkg_file = entry.path().join("package.json");
                    if pkg_file.exists() {
                        if let Ok(content) = fs::read_to_string(&pkg_file) {
                            if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
                                let parts: Vec<&str> = id.split('.').collect();
                                let namespace = parts.first().copied().unwrap_or("");
                                let name = parts.get(1).copied().unwrap_or(&id);
                                let display_name = pkg.get("displayName").and_then(|v| v.as_str())
                                    .or_else(|| pkg.get("name").and_then(|v| v.as_str()))
                                    .unwrap_or(&id);
                                let desc = pkg.get("description").and_then(|v| v.as_str()).unwrap_or("");
                                let version = pkg.get("version").and_then(|v| v.as_str()).unwrap_or("1.0.0");

                                list.push(serde_json::json!({
                                    "id": id,
                                    "namespace": namespace,
                                    "name": name,
                                    "displayName": display_name,
                                    "description": desc,
                                    "version": version,
                                    "installed": true,
                                    "enabled": true,
                                }));
                            }
                        }
                    }
                }
            }
        }
    }

    for item in list.iter_mut() {
        if let Some(obj) = item.as_object_mut() {
            obj.insert("installed".to_string(), serde_json::Value::Bool(true));
        }
    }

    Ok(serde_json::json!({ "extensions": list }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic Workspace Plugin Loader
// ─────────────────────────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct PluginJsonSchema {
    name: String,
    description: String,
    tools: Vec<PluginToolDef>,
}

#[derive(serde::Deserialize, Clone)]
pub struct PluginToolDef {
    pub name: String,
    pub description: String,
    pub command: String,
    pub parameters: Option<serde_json::Value>,
}

pub struct DynamicWorkspacePlugin {
    pub name: String,
    pub description: String,
    pub project_path: String,
    pub tools: Vec<PluginToolDef>,
}

impl ForgePlugin for DynamicWorkspacePlugin {
    fn name(&self) -> String { self.name.clone() }
    fn description(&self) -> String { self.description.clone() }
    fn project_path(&self) -> Option<String> { Some(self.project_path.clone()) }
    
    fn get_tools(&self) -> Vec<serde_json::Value> {
        let mut llm_tools = Vec::new();
        for t in &self.tools {
            let params = t.parameters.clone().unwrap_or_else(|| serde_json::json!({
                "type": "object",
                "properties": {}
            }));
            
            llm_tools.push(serde_json::json!({
                "type": "function",
                "function": {
                    "name": t.name.clone(),
                    "description": t.description.clone(),
                    "parameters": params
                }
            }));
        }
        llm_tools
    }
    
    fn execute_tool(&self, name: &str, args: &serde_json::Value) -> Option<Result<String, String>> {
        if let Some(tool_def) = self.tools.iter().find(|t| t.name == name) {
            // Check workspace trust
            if let Ok(reg) = REGISTRY.read() {
                if !reg.trusted_workspaces.contains(&self.project_path) {
                    return Some(Err("Workspace is not trusted to execute dynamic plugin commands.".to_string()));
                }
            }

            // Replace {arg} in command with actual values if provided
            let mut cmd_str = tool_def.command.clone();
            if let Some(obj) = args.as_object() {
                for (k, v) in obj {
                    let val_str = v.as_str().map(|s| s.to_string()).unwrap_or_else(|| v.to_string());
                    cmd_str = cmd_str.replace(&format!("{{{}}}", k), &val_str);
                }
            }

            // Dangerous system destructive patterns check
            let lower_cmd = cmd_str.to_lowercase();
            if lower_cmd.contains("rm -rf /") || lower_cmd.contains("mkfs") || lower_cmd.contains("format c:") || lower_cmd.contains("del /s /q c:\\") {
                return Some(Err("Command contains potentially destructive system instructions.".to_string()));
            }
            
            // Execute in project directory
            #[cfg(target_os = "windows")]
            let output = {
                use std::os::windows::process::CommandExt;
                let mut pcmd = Command::new("powershell");
                pcmd.arg("-NoProfile")
                    .arg("-NonInteractive")
                    .arg("-WindowStyle")
                    .arg("Hidden")
                    .arg("-Command")
                    .arg(&cmd_str)
                    .current_dir(&self.project_path)
                    .creation_flags(0x08000000);
                pcmd.output()
            };
                
            #[cfg(not(target_os = "windows"))]
            let output = Command::new("sh")
                .arg("-c")
                .arg(&cmd_str)
                .current_dir(&self.project_path)
                .output();
                
            match output {
                Ok(out) => {
                    let mut res = String::from_utf8_lossy(&out.stdout).to_string();
                    if !out.stderr.is_empty() {
                        res.push_str("\n[STDERR]: ");
                        res.push_str(&String::from_utf8_lossy(&out.stderr));
                    }
                    Some(Ok(res))
                }
                Err(e) => Some(Err(format!("Failed to execute tool command: {}", e)))
            }
        } else {
            None
        }
    }
}

pub fn load_workspace_plugins(project_path: &str) {
    if let Ok(mut reg) = REGISTRY.write() {
        if reg.loaded_workspaces.contains(project_path) {
            return; // Already loaded for this workspace
        }

        // Only load dynamic workspace plugins if workspace is trusted
        if !reg.trusted_workspaces.contains(project_path) {
            return;
        }
        
        let plugins_dir = Path::new(project_path).join(".forge").join("plugins");
        if let Ok(entries) = fs::read_dir(&plugins_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                if entry.path().extension().and_then(|s| s.to_str()) == Some("json") {
                    if let Ok(content) = fs::read_to_string(entry.path()) {
                        if let Ok(schema) = serde_json::from_str::<PluginJsonSchema>(&content) {
                            let dyn_plugin = DynamicWorkspacePlugin {
                                name: schema.name,
                                description: schema.description,
                                project_path: project_path.to_string(),
                                tools: schema.tools,
                            };
                            reg.plugins.push(Box::new(dyn_plugin));
                        }
                    }
                }
            }
        }
        reg.loaded_workspaces.insert(project_path.to_string());
    }
}

pub fn reload_workspace_plugins(project_path: &str) {
    if let Ok(mut reg) = REGISTRY.write() {
        reg.plugins.retain(|p| p.project_path().as_deref() != Some(project_path));
        reg.loaded_workspaces.remove(project_path);
    }
    load_workspace_plugins(project_path);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_workspace_trust_lifecycle() {
        let fake_path = "C:/fake/workspace/test_path";

        // Initial state: not trusted
        let check_res = handle("is_workspace_trusted", &serde_json::json!({ "project_path": fake_path })).await.unwrap();
        assert_eq!(check_res["trusted"], false);

        // Trust workspace
        let trust_res = handle("trust_workspace", &serde_json::json!({ "project_path": fake_path })).await.unwrap();
        assert_eq!(trust_res["trusted"], true);

        // Verify trusted
        let check_res2 = handle("is_workspace_trusted", &serde_json::json!({ "project_path": fake_path })).await.unwrap();
        assert_eq!(check_res2["trusted"], true);

        // Untrust workspace
        let untrust_res = handle("untrust_workspace", &serde_json::json!({ "project_path": fake_path })).await.unwrap();
        assert_eq!(untrust_res["trusted"], false);

        // Verify untrusted
        let check_res3 = handle("is_workspace_trusted", &serde_json::json!({ "project_path": fake_path })).await.unwrap();
        assert_eq!(check_res3["trusted"], false);
    }

    #[test]
    fn test_get_installed_extensions() {
        let res = get_installed_extensions().unwrap();
        assert!(res.get("extensions").is_some());
        let list = res["extensions"].as_array().unwrap();
        println!("Installed extensions count: {}", list.len());
    }

    #[tokio::test]
    async fn test_install_extension_fastpath() {
        let ext_dir = get_global_extensions_dir();
        let sample_id = "test.sample-extension";
        let target = ext_dir.join(sample_id);
        std::fs::create_dir_all(&target).ok();
        std::fs::write(target.join("package.json"), "{}").ok();

        let meta = serde_json::json!({
            "id": sample_id,
            "name": "sample-extension",
            "displayName": "Sample Extension",
            "version": "1.0.0"
        });
        let res = install_extension(sample_id, "", meta).await.unwrap();
        assert_eq!(res.get("success").and_then(|v| v.as_bool()), Some(true));
        assert!(res.get("already_installed").is_some() || res.get("imported_from_vscode").is_some());

        let _ = std::fs::remove_dir_all(&target);
    }
}
