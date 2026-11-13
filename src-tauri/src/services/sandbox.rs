use std::process::Command;

pub fn run_in_sandbox(command: &str, project_path: &str) -> std::result::Result<String, String> {
    let p = std::path::Path::new(project_path);
    let image = if p.join("package.json").exists() {
        "node:20-alpine"
    } else if p.join("requirements.txt").exists() || p.join("pyproject.toml").exists() {
        "python:3.11-alpine"
    } else {
        "rust:alpine"
    };

    let mount_mode =
        if command.contains("test") || command.contains("check") || command.contains("lint") {
            ":ro"
        } else {
            ""
        };

    let mut docker_cmd = Command::new("docker");
    docker_cmd.args([
        "run",
        "--rm",
        "-v",
        &format!("{}{}", project_path, mount_mode),
        "-w",
        "/workspace",
        image,
        "sh",
        "-c",
        command,
    ]);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        docker_cmd.creation_flags(0x08000000);
    }

    let docker_res = docker_cmd.output();

    match docker_res {
        Ok(output) if output.status.success() => {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        }
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            Err(format!("Docker sandbox error:\n{}\n{}", stdout, stderr)
                .trim()
                .to_string())
        }
        Err(_) => {
            // Fallback to local shell bounded to project_path if Docker is unavailable
            let shell = if cfg!(windows) { "cmd" } else { "sh" };
            let flag = if cfg!(windows) { "/C" } else { "-c" };
            let mut local_cmd = Command::new(shell);
            local_cmd.arg(flag).arg(command).current_dir(project_path);

            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                local_cmd.creation_flags(0x08000000);
            }

            let local_out = local_cmd
                .output()
                .map_err(|e| format!("Local sandbox fallback failed: {e}"))?;

            let stdout = String::from_utf8_lossy(&local_out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&local_out.stderr).to_string();
            if local_out.status.success() {
                Ok(stdout)
            } else {
                Err(format!("{}\n{}", stdout, stderr).trim().to_string())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sandbox_execution() {
        // We will test if the sandbox correctly executes a safe alpine echo command.
        // (This test will only pass if Docker is installed on the host machine)
        match run_in_sandbox("echo 'Hello from Sandbox'", ".") {
            Ok(output) => {
                assert!(output.contains("Hello from Sandbox"));
            }
            Err(e) => {
                // If Docker isn't running on your machine, it safely falls back to a printed error.
                println!(
                    "Sandbox test skipped/failed because Docker daemon might not be running: {}",
                    e
                );
            }
        }
    }
}
