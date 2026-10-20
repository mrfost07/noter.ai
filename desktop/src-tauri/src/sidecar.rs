//! Owned Go sidecar discovery, startup, readiness, and shutdown.

use std::env;
use std::fs;
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use tauri::Manager;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::smoke::SmokeTestPaths;
use crate::state::SidecarState;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn prepare_private_data_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|error| format!("Could not create the application data folder: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("Could not protect the application data folder: {error}"))?;
    }
    Ok(())
}

pub(crate) fn stop_owned_sidecar(state: &SidecarState) -> Result<(), String> {
    let mut guard = state
        .child
        .lock()
        .map_err(|_| "Could not access the owned local server.".to_string())?;
    if let Some(child) = guard.as_mut() {
        if child
            .try_wait()
            .map_err(|error| format!("Could not inspect the owned local server: {error}"))?
            .is_none()
        {
            child
                .kill()
                .map_err(|error| format!("Could not stop the owned local server: {error}"))?;
            child
                .wait()
                .map_err(|error| format!("Could not reap the owned local server: {error}"))?;
        }
        *guard = None;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn get_server_url(state: tauri::State<'_, SidecarState>) -> String {
    format!("http://127.0.0.1:{}", state.port)
}

pub(crate) fn pick_port(preferred: u16) -> u16 {
    if TcpListener::bind(("127.0.0.1", preferred)).is_ok() {
        return preferred;
    }
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(preferred)
}

fn sidecar_candidates(
    exe_dir: &Path,
    resource_dir: Option<&Path>,
    os: &str,
    arch: &str,
) -> Vec<PathBuf> {
    let mut names = match os {
        "windows" => vec![
            "memos-server.exe".to_string(),
            format!("memos-server-{arch}-pc-windows-msvc.exe"),
            format!("memos-server-{arch}-pc-windows-gnu.exe"),
            "memos.exe".to_string(),
        ],
        "macos" => vec![
            "memos-server".to_string(),
            format!("memos-server-{arch}-apple-darwin"),
            "memos-server-universal-apple-darwin".to_string(),
        ],
        "linux" => vec![
            "memos-server".to_string(),
            format!("memos-server-{arch}-unknown-linux-gnu"),
            format!("memos-server-{arch}-unknown-linux-musl"),
        ],
        _ => return Vec::new(),
    };
    names.dedup();
    let mut directories = vec![exe_dir.to_path_buf(), exe_dir.join("binaries")];
    if let Some(resources) = resource_dir {
        directories.extend([resources.to_path_buf(), resources.join("binaries")]);
    }
    let mut candidates = Vec::new();
    for directory in directories
        .into_iter()
        .filter(|directory| directory.is_absolute())
    {
        for name in &names {
            let path = directory.join(name);
            if !candidates.contains(&path) {
                candidates.push(path);
            }
        }
    }
    candidates
}

fn find_sidecar(candidates: Vec<PathBuf>, is_file: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    candidates.into_iter().find(|path| is_file(path))
}

fn resolve_sidecar_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let executable = env::current_exe()
        .map_err(|error| format!("Could not locate the Noter.ai application: {error}"))?;
    let exe_dir = executable
        .parent()
        .ok_or("Could not locate the Noter.ai application folder.")?;
    let resources = app.path().resource_dir().ok();
    find_sidecar(
        sidecar_candidates(exe_dir, resources.as_deref(), env::consts::OS, env::consts::ARCH),
        Path::is_file,
    )
    .ok_or_else(|| "The bundled Noter.ai local server is missing. Reinstall or extract the complete application package; keep its server beside the application.".into())
}

fn default_library_root(home: Option<PathBuf>, app_data: &Path) -> PathBuf {
    home.filter(|directory| directory.is_absolute())
        .unwrap_or_else(|| app_data.to_path_buf())
        .join("Noter.ai")
}

pub(crate) fn wait_for_server(
    app: &tauri::AppHandle,
    port: u16,
    timeout: Duration,
) -> Result<(), String> {
    let start = Instant::now();
    while start.elapsed() < timeout {
        let state = app.state::<SidecarState>();
        let mut guard = state.child.lock().map_err(|error| error.to_string())?;
        let child = guard
            .as_mut()
            .ok_or("The Noter.ai local server did not start.")?;
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            return Err(format!("The Noter.ai local server stopped during startup ({status}). Close the app and retry. If this continues, check that the application data folder is writable and reinstall the complete package."));
        }
        drop(guard);
        if TcpStream::connect_timeout(
            &format!("127.0.0.1:{}", port).parse().unwrap(),
            Duration::from_millis(150),
        )
        .is_ok()
        {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(80));
    }
    Err("The Noter.ai local server did not become ready within 30 seconds. Close the app and retry. Your existing notes remain in the application data folder.".into())
}

pub(crate) fn start_sidecar(
    app: &tauri::App,
    port: u16,
    smoke_paths: Option<&SmokeTestPaths>,
) -> Result<(), String> {
    let app_data_dir = smoke_paths
        .as_ref()
        .map(|paths| paths.data.clone())
        .or_else(|| env::var_os("NOTER_DATA_DIR").map(PathBuf::from))
        .map(Ok)
        .unwrap_or_else(|| app.path().app_data_dir())
        .map_err(|error| format!("Could not locate the application data folder: {error}"))?;
    prepare_private_data_directory(&app_data_dir)?;
    let sidecar_bin = resolve_sidecar_path(app.handle())?;
    let mut cmd = Command::new(sidecar_bin);
    let home = env::var_os(if cfg!(target_os = "windows") {
        "USERPROFILE"
    } else {
        "HOME"
    })
    .map(PathBuf::from)
    .or_else(|| app.path().home_dir().ok());
    let library_root = smoke_paths
        .as_ref()
        .map(|paths| paths.library.clone())
        .or_else(|| env::var_os("NOTER_LIBRARY_ROOT").map(PathBuf::from))
        .unwrap_or_else(|| default_library_root(home, &app_data_dir));
    cmd.env("NOTER_LIBRARY_ROOT", library_root)
        .env("NOTER_DESKTOP", "1");
    cmd.args([
        "--addr",
        "127.0.0.1",
        "--port",
        &port.to_string(),
        "--data",
        &app_data_dir.to_string_lossy(),
    ])
    .stdout(Stdio::null())
    .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let child = cmd.spawn().map_err(|error| format!("Could not start the bundled Noter.ai local server: {error}. Reinstall the complete application package."))?;
    let state = app.state::<SidecarState>();
    *state.child.lock().map_err(|error| error.to_string())? = Some(child);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn application_dir() -> PathBuf {
        env::temp_dir().join("noter-sidecar-selection-tests")
    }

    #[cfg(unix)]
    #[test]
    fn private_profile_excludes_other_users_before_credentials_are_saved() {
        use std::os::unix::fs::PermissionsExt;
        let directory = env::temp_dir().join(format!(
            "noter-private-profile-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        assert!(directory.starts_with(env::temp_dir()));
        fs::create_dir(&directory).unwrap();
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o777)).unwrap();
        prepare_private_data_directory(&directory).unwrap();
        assert_eq!(
            fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
        fs::remove_dir(&directory).unwrap();
    }

    #[test]
    fn windows_prefers_the_bundled_server_and_keeps_legacy_support() {
        let directory = application_dir();
        let candidates = sidecar_candidates(&directory, None, "windows", "x86_64");
        let generic = directory.join("memos-server.exe");
        let legacy = directory.join("memos.exe");
        assert_eq!(candidates.first(), Some(&generic));
        assert!(candidates.contains(&legacy));
        assert!(candidates.contains(&directory.join("memos-server-x86_64-pc-windows-msvc.exe")));
        assert_eq!(
            find_sidecar(candidates, |path| path == generic || path == legacy),
            Some(generic)
        );
    }

    #[test]
    fn macos_finds_the_server_in_application_bundle_resources() {
        let bundle = application_dir().join("Noter.ai.app").join("Contents");
        let executable_dir = bundle.join("MacOS");
        let resources = bundle.join("Resources");
        let expected = resources.join("memos-server-aarch64-apple-darwin");
        let candidates = sidecar_candidates(&executable_dir, Some(&resources), "macos", "aarch64");
        assert_eq!(
            find_sidecar(candidates, |path| path == expected),
            Some(expected)
        );
    }

    #[test]
    fn linux_uses_native_architecture_names_without_windows_extensions() {
        let directory = application_dir();
        let candidates = sidecar_candidates(&directory, None, "linux", "x86_64");
        assert!(candidates.contains(&directory.join("memos-server-x86_64-unknown-linux-gnu")));
        assert!(candidates.contains(&directory.join("memos-server-x86_64-unknown-linux-musl")));
        assert!(candidates.iter().all(|path| {
            let name = path.file_name().unwrap().to_string_lossy();
            !name.ends_with(".exe") && !name.contains("aarch64")
        }));
    }

    #[test]
    fn executable_sibling_takes_precedence_over_resource_copy() {
        let directory = application_dir();
        let resources = directory.join("resources");
        let expected = directory.join("memos-server");
        let candidates = sidecar_candidates(&directory, Some(&resources), "linux", "x86_64");
        assert_eq!(
            find_sidecar(candidates, |path| path.file_name().unwrap()
                == "memos-server"),
            Some(expected)
        );
    }

    #[test]
    fn relative_working_directory_paths_cannot_supply_a_sidecar() {
        assert!(sidecar_candidates(
            Path::new("."),
            Some(Path::new("binaries")),
            "linux",
            "x86_64"
        )
        .is_empty());
        let candidates = sidecar_candidates(
            &application_dir(),
            Some(Path::new("binaries")),
            "linux",
            "x86_64",
        );
        assert!(candidates.iter().all(|path| path.is_absolute()));
        assert!(find_sidecar(candidates, |_| false).is_none());
    }

    #[test]
    fn unsupported_platform_has_no_sidecar_candidates() {
        assert!(sidecar_candidates(&application_dir(), None, "unsupported", "x86_64").is_empty());
    }

    #[test]
    fn library_defaults_to_home_and_only_falls_back_when_home_is_unavailable() {
        let base = application_dir();
        let home = base.join("home");
        let app_data = base.join("app-data");
        assert_eq!(
            default_library_root(Some(home.clone()), &app_data),
            home.join("Noter.ai")
        );
        assert_eq!(
            default_library_root(None, &app_data),
            app_data.join("Noter.ai")
        );
        assert_eq!(
            default_library_root(Some(PathBuf::from("")), &app_data),
            app_data.join("Noter.ai")
        );
    }
}
