// Prevents an extra console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::ffi::OsString;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{
    LogicalSize, Manager, PhysicalPosition, PhysicalSize, Position, RunEvent, Size, WebviewWindow,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Default)]
struct WindowCompanionState {
    prev_pos: Option<PhysicalPosition<i32>>,
    prev_size: Option<PhysicalSize<u32>>,
    is_meeting_mode: bool,
    is_collapsed: bool,
    prev_maximized: bool,
    prev_decorated: bool,
}

struct SidecarState {
    child: Mutex<Option<Child>>,
    port: u16,
    window_companion: Mutex<WindowCompanionState>,
    recording_active: Mutex<bool>,
    startup_error: Mutex<Option<String>>,
    smoke_paths: Option<SmokeTestPaths>,
    smoke_finished: Mutex<bool>,
}

#[derive(Clone)]
struct SmokeTestPaths {
    data: PathBuf,
    library: PathBuf,
    webview: PathBuf,
}

fn smoke_test_requested(arguments: &[OsString]) -> bool {
    arguments.iter().any(|argument| argument == "--smoke-test")
}

fn smoke_path_value(name: &str, value: Option<OsString>) -> Result<PathBuf, String> {
    let path = value
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| {
            format!("--smoke-test requires {name} to name a pre-created temporary directory.")
        })?;
    if !path.is_absolute()
        || path
            .components()
            .any(|component| component == Component::ParentDir)
    {
        return Err(format!(
            "--smoke-test requires {name} to be an absolute path without parent traversal."
        ));
    }
    Ok(path)
}

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

fn validate_smoke_sandbox(os: &str, disabled: Option<OsString>) -> Result<(), String> {
    if os == "linux" && disabled.is_some_and(|value| !value.is_empty()) {
        return Err("Smoke tests require the normal WebKit sandbox; remove WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS.".into());
    }
    Ok(())
}

fn validate_smoke_paths(paths: &[PathBuf; 3], temp_root: &Path) -> Result<(), String> {
    for path in paths {
        if !path.is_absolute()
            || path
                .components()
                .any(|component| component == Component::ParentDir)
            || !path.starts_with(temp_root)
            || path == temp_root
        {
            return Err("Smoke-test directories must be absolute subdirectories of the operating system temporary folder.".into());
        }
    }
    for (index, path) in paths.iter().enumerate() {
        if paths
            .iter()
            .skip(index + 1)
            .any(|other| path.starts_with(other) || other.starts_with(path))
        {
            return Err("Smoke-test data, library, and webview directories must be separate and must not overlap.".into());
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn windows_process_path(path: &Path) -> PathBuf {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    let wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    match path.components().next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            std::path::Prefix::VerbatimDisk(_) => PathBuf::from(OsString::from_wide(&wide[4..])),
            std::path::Prefix::VerbatimUNC(_, _) => {
                let mut normalized = vec![b'\\' as u16, b'\\' as u16];
                normalized.extend_from_slice(&wide[8..]);
                PathBuf::from(OsString::from_wide(&normalized))
            }
            _ => path.to_path_buf(),
        },
        _ => path.to_path_buf(),
    }
}

fn smoke_process_path(path: PathBuf) -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        // Go's SQLite URI handling rejects the verbatim prefix from canonicalize.
        // Recheck the normalized spelling so containment cannot change during conversion.
        let normalized = windows_process_path(&path);
        if normalized.canonicalize().ok().as_ref() != Some(&path) {
            return Err(
                "A smoke-test directory cannot be represented safely for the bundled server."
                    .into(),
            );
        }
        Ok(normalized)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(path)
    }
}

fn read_smoke_paths(requested: bool) -> Result<Option<SmokeTestPaths>, String> {
    if !requested {
        return Ok(None);
    }
    validate_smoke_sandbox(
        env::consts::OS,
        env::var_os("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS"),
    )?;
    let read_path = |name: &str| -> Result<PathBuf, String> {
        let path = smoke_path_value(name, env::var_os(name))?;
        let canonical = path
            .canonicalize()
            .map_err(|_| format!("--smoke-test requires {name} to be an existing directory."))?;
        if !canonical.is_dir() {
            return Err(format!(
                "--smoke-test requires {name} to be an existing directory."
            ));
        }
        Ok(canonical)
    };
    let paths = [
        read_path("NOTER_DATA_DIR")?,
        read_path("NOTER_LIBRARY_ROOT")?,
        read_path("NOTER_WEBVIEW_DATA_DIR")?,
    ];
    let temp_root = env::temp_dir()
        .canonicalize()
        .map_err(|_| "Could not locate the operating system temporary folder.".to_string())?;
    validate_smoke_paths(&paths, &temp_root)?;
    let [data, library, webview] = paths;
    Ok(Some(SmokeTestPaths {
        data: smoke_process_path(data)?,
        library: smoke_process_path(library)?,
        webview: smoke_process_path(webview)?,
    }))
}

fn selected_server_page(url: &tauri::Url, port: u16) -> bool {
    url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port_or_known_default() == Some(port)
        && url.username().is_empty()
        && url.password().is_none()
}

fn validate_smoke_http_page(response: &[u8]) -> Result<(), String> {
    let response = String::from_utf8_lossy(response);
    let (headers, body) = response
        .split_once("\r\n\r\n")
        .ok_or("The selected local server returned an incomplete HTTP response.")?;
    let status = headers.lines().next().unwrap_or_default();
    if !status.starts_with("HTTP/1.") || status.split_whitespace().nth(1) != Some("200") {
        return Err(
            "The selected local server did not return HTTP 200 for its application page.".into(),
        );
    }
    if !headers
        .to_ascii_lowercase()
        .contains("content-type: text/html")
        || !body.contains("<title>Noter.ai</title>")
        || !body.contains("id=\"root\"")
        || !body.contains("type=\"module\"")
    {
        return Err(
            "The selected local server did not return the bundled Noter.ai application page."
                .into(),
        );
    }
    Ok(())
}

fn verify_smoke_http_page(port: u16) -> Result<(), String> {
    let address = format!("127.0.0.1:{port}")
        .parse()
        .map_err(|_| "Invalid selected loopback address.".to_string())?;
    let mut stream =
        TcpStream::connect_timeout(&address, Duration::from_secs(1)).map_err(|_| {
            "Could not connect to the selected local server for HTTP verification.".to_string()
        })?;
    stream
        .set_write_timeout(Some(Duration::from_secs(1)))
        .map_err(|error| error.to_string())?;
    stream
        .write_all(
            format!("GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .map_err(|_| "Could not request the selected local application page.".to_string())?;
    let deadline = Instant::now() + Duration::from_secs(3);
    let mut response = Vec::new();
    let mut buffer = [0; 4096];
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("HTTP verification of the local application page timed out.".into());
        }
        stream
            .set_read_timeout(Some(remaining))
            .map_err(|error| error.to_string())?;
        let count = stream
            .read(&mut buffer)
            .map_err(|_| "Could not read the local application HTTP response.".to_string())?;
        if count == 0 {
            break;
        }
        response.extend_from_slice(&buffer[..count]);
        if response.len() > 512 * 1024 {
            return Err(
                "The local application HTTP response exceeded the smoke-test limit.".into(),
            );
        }
    }
    validate_smoke_http_page(&response)
}

fn stop_owned_sidecar(state: &SidecarState) -> Result<(), String> {
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

fn finish_smoke_test(app: &tauri::AppHandle, requested_code: i32, message: &str) {
    let state = app.state::<SidecarState>();
    let Some(paths) = state.smoke_paths.as_ref() else {
        return;
    };
    let Ok(mut finished) = state.smoke_finished.lock() else {
        app.exit(1);
        return;
    };
    if *finished {
        return;
    }
    *finished = true;
    drop(finished);
    let mut code = requested_code;
    let mut sidecar_pid = None;
    if code == 0 {
        if let Err(error) = verify_smoke_http_page(state.port) {
            eprintln!("Noter.ai smoke test failed: {error}");
            code = 1;
        }
    }
    if code == 0 {
        let healthy = state.child.lock().ok().and_then(|mut guard| {
            guard.as_mut().and_then(|child| match child.try_wait() {
                Ok(None) => Some(child.id()),
                _ => None,
            })
        });
        if let Some(pid) = healthy {
            sidecar_pid = Some(pid);
        } else {
            eprintln!("Noter.ai smoke test failed: local server exited before the application page loaded.");
            code = 1;
        }
    }
    if let Err(error) = stop_owned_sidecar(&state) {
        eprintln!("Noter.ai smoke test failed: {error}");
        code = 1;
    }
    if code == 0 {
        let report = serde_json::json!({
            "serverOrigin": format!("http://127.0.0.1:{}", state.port),
            "webviewLoaded": true,
            "httpStatus": 200,
            "noterPage": true,
            "sidecarHealthy": true,
            "sidecarPid": sidecar_pid,
            "sidecarStopped": true,
        });
        if fs::write(
            paths.data.join("noter-smoke-result.json"),
            report.to_string(),
        )
        .is_err()
        {
            eprintln!("Noter.ai smoke test failed: could not write its isolated result report.");
            code = 1;
        }
    }
    if code == 0 {
        println!(
            "Noter.ai smoke test passed: native window loaded the bundled server application."
        );
    } else {
        eprintln!("Noter.ai smoke test failed: {message}");
    }
    app.exit(code);
}

#[tauri::command]
fn set_recording_active(state: tauri::State<'_, SidecarState>, active: bool) -> Result<(), String> {
    *state.recording_active.lock().map_err(|e| e.to_string())? = active;
    Ok(())
}

#[tauri::command]
async fn pick_library_folder(window: WebviewWindow) -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let owner = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
        tauri::async_runtime::spawn_blocking(move || {
            // COM dialogs require an STA. Use a fresh thread instead of the runtime's
            // reusable worker, which may already have a different apartment type.
            thread::spawn(move || unsafe {
                use windows::core::{w, HRESULT};
                use windows::Win32::Foundation::{ERROR_CANCELLED, HWND};
                use windows::Win32::System::Com::{
                    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize,
                    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
                };
                use windows::Win32::UI::Shell::{
                    FileOpenDialog, IFileOpenDialog, FOS_FORCEFILESYSTEM, FOS_NOCHANGEDIR,
                    FOS_PATHMUSTEXIST, FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
                };
                CoInitializeEx(None, COINIT_APARTMENTTHREADED)
                    .ok()
                    .map_err(|e| e.to_string())?;
                struct Apartment;
                impl Drop for Apartment {
                    fn drop(&mut self) {
                        unsafe {
                            CoUninitialize();
                        }
                    }
                }
                let _apartment = Apartment;
                let dialog: IFileOpenDialog =
                    CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)
                        .map_err(|e| e.to_string())?;
                dialog
                    .SetOptions(
                        dialog.GetOptions().map_err(|e| e.to_string())?
                            | FOS_PICKFOLDERS
                            | FOS_FORCEFILESYSTEM
                            | FOS_PATHMUSTEXIST
                            | FOS_NOCHANGEDIR,
                    )
                    .map_err(|e| e.to_string())?;
                dialog
                    .SetTitle(w!("Choose an empty folder for your Noter.ai library"))
                    .map_err(|e| e.to_string())?;
                if let Err(error) = dialog.Show(Some(HWND(owner as *mut _))) {
                    if error.code() == HRESULT::from_win32(ERROR_CANCELLED.0) {
                        return Ok(None);
                    }
                    return Err(error.to_string());
                }
                let item = dialog.GetResult().map_err(|e| e.to_string())?;
                let path = item
                    .GetDisplayName(SIGDN_FILESYSPATH)
                    .map_err(|e| e.to_string())?;
                let selected = path.to_string().map_err(|e| e.to_string());
                CoTaskMemFree(Some(path.0.cast()));
                selected.map(Some)
            })
            .join()
            .map_err(|_| "The folder picker could not be opened.".to_string())?
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        Err("Folder selection is currently supported by the Windows desktop app.".into())
    }
}

fn registered_library_path(app: &tauri::AppHandle, root: &str) -> Result<PathBuf, String> {
    let data = env::var_os("NOTER_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or(app.path().app_data_dir().map_err(|e| e.to_string())?);
    let root_path = PathBuf::from(root);
    let canonical_root = root_path.canonicalize().map_err(|e| e.to_string())?;
    let allowed = fs::read_dir(data)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .any(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("noter-library-") || !name.ends_with(".json") {
                return false;
            }
            let value = fs::read(entry.path())
                .ok()
                .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
            value
                .and_then(|v| v.get("root").and_then(|v| v.as_str()).map(PathBuf::from))
                .and_then(|p| p.canonicalize().ok())
                .is_some_and(|p| p == canonical_root)
        });
    if !allowed {
        return Err("This folder is not a registered Noter.ai library.".into());
    }
    Ok(canonical_root)
}

#[tauri::command]
fn open_library_folder(
    app: tauri::AppHandle,
    root: String,
    relative: String,
) -> Result<(), String> {
    let canonical_root = registered_library_path(&app, &root)?;
    let root_path = PathBuf::from(root);
    let target = root_path
        .join(relative)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !target.starts_with(&canonical_root) || !target.is_dir() {
        return Err("The folder is outside this library.".into());
    }
    let opener = folder_opener(env::consts::OS)?;
    Command::new(opener)
        .arg(target)
        .spawn()
        .map_err(|error| format!("Could not open the library folder with {opener}: {error}"))?;
    Ok(())
}

fn folder_opener(os: &str) -> Result<&'static str, String> {
    match os {
        "windows" => Ok("explorer.exe"),
        "macos" => Ok("open"),
        "linux" => Ok("xdg-open"),
        _ => Err("Opening a library folder is not supported on this operating system.".into()),
    }
}

#[derive(serde::Serialize)]
struct LibraryDiskSpace {
    available: u64,
    total: u64,
}

#[tauri::command]
fn library_disk_space(app: tauri::AppHandle, root: String) -> Result<LibraryDiskSpace, String> {
    let path = registered_library_path(&app, &root)?;
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" {
            fn GetDiskFreeSpaceExW(
                directory: *const u16,
                available: *mut u64,
                total: *mut u64,
                free: *mut u64,
            ) -> i32;
        }
        let directory: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let (mut available, mut total, mut free) = (0, 0, 0);
        if unsafe { GetDiskFreeSpaceExW(directory.as_ptr(), &mut available, &mut total, &mut free) }
            == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(LibraryDiskSpace { available, total })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("Disk space reporting is currently available on Windows.".into())
    }
}

#[tauri::command]
fn get_server_url(state: tauri::State<'_, SidecarState>) -> String {
    format!("http://127.0.0.1:{}", state.port)
}

fn dock_companion(window: &WebviewWindow, width: f64) -> Result<(), String> {
    let apply = |result: tauri::Result<()>| result.map_err(|error| error.to_string());
    apply(window.set_min_size(Some(Size::Logical(LogicalSize::new(56.0, 120.0)))))?;
    if let Some(monitor) = window
        .current_monitor()
        .map_err(|error| error.to_string())?
    {
        let area = monitor.work_area();
        let physical_width = (width * monitor.scale_factor()).round() as u32;
        apply(window.set_size(Size::Physical(PhysicalSize::new(
            physical_width,
            area.size.height,
        ))))?;
        apply(
            window.set_position(Position::Physical(PhysicalPosition::new(
                area.position.x + area.size.width as i32 - physical_width as i32,
                area.position.y,
            ))),
        )?;
    } else {
        apply(window.set_size(Size::Logical(LogicalSize::new(width, 800.0))))?;
    }
    Ok(())
}

#[tauri::command]
fn set_meeting_mode(
    window: WebviewWindow,
    state: tauri::State<'_, SidecarState>,
    enabled: bool,
) -> Result<bool, String> {
    let mut comp = state
        .window_companion
        .lock()
        .map_err(|error| error.to_string())?;
    if enabled {
        if !comp.is_meeting_mode {
            comp.prev_pos = window.outer_position().ok();
            comp.prev_size = window.inner_size().ok();
            comp.prev_maximized = window.is_maximized().unwrap_or(false);
            comp.prev_decorated = window.is_decorated().unwrap_or(true);
        }
        window.unmaximize().map_err(|error| error.to_string())?;
        window
            .set_decorations(false)
            .map_err(|error| error.to_string())?;
        window
            .set_always_on_top(true)
            .map_err(|error| error.to_string())?;
        dock_companion(&window, 440.0)?;
        comp.is_meeting_mode = true;
        comp.is_collapsed = false;
    } else if comp.is_meeting_mode {
        window
            .set_always_on_top(false)
            .map_err(|error| error.to_string())?;
        window
            .set_decorations(comp.prev_decorated)
            .map_err(|error| error.to_string())?;
        if let (Some(pos), Some(size)) = (comp.prev_pos, comp.prev_size) {
            window
                .set_size(Size::Physical(size))
                .map_err(|error| error.to_string())?;
            window
                .set_position(Position::Physical(pos))
                .map_err(|error| error.to_string())?;
        } else {
            window
                .set_size(Size::Logical(LogicalSize::new(1320.0, 860.0)))
                .map_err(|error| error.to_string())?;
            window.center().map_err(|error| error.to_string())?;
        }
        if comp.prev_maximized {
            window.maximize().map_err(|error| error.to_string())?;
        }
        comp.is_meeting_mode = false;
        comp.is_collapsed = false;
    }
    Ok(enabled)
}

#[tauri::command]
fn toggle_meeting_collapsed(
    window: WebviewWindow,
    state: tauri::State<'_, SidecarState>,
    collapsed: bool,
) -> Result<bool, String> {
    let mut comp = state
        .window_companion
        .lock()
        .map_err(|error| error.to_string())?;
    if !comp.is_meeting_mode {
        return Err("Meeting mode is not active".into());
    }
    dock_companion(&window, if collapsed { 56.0 } else { 440.0 })?;
    comp.is_collapsed = collapsed;
    Ok(collapsed)
}

fn pick_port(preferred: u16) -> u16 {
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

fn show_startup_error(app: &tauri::AppHandle, message: &str) {
    let state = app.state::<SidecarState>();
    if state.smoke_paths.is_some() {
        finish_smoke_test(app, 1, message);
        return;
    }
    if let Ok(mut error) = state.startup_error.lock() {
        *error = Some(message.to_string());
    }
    if let Some(window) = app.get_webview_window("main") {
        // Use textContent and JSON encoding: file paths and OS errors are data, not script.
        let message = serde_json::to_string(message)
            .unwrap_or_else(|_| "\"The local server could not start.\"".into());
        let script = format!(
            "(() => {{ const show = () => {{ const title = document.querySelector('.title'); const detail = document.querySelector('.sub'); const spinner = document.querySelector('.spinner'); if (title) title.textContent = 'Noter.ai could not open'; if (detail) {{ detail.textContent = {message}; detail.style.maxWidth = '36rem'; detail.style.padding = '0 24px'; detail.style.textAlign = 'center'; }} if (spinner) spinner.hidden = true; }}; if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, {{ once: true }}); else show(); }})();"
        );
        let _ = window.eval(&script);
    }
}

fn wait_for_server(app: &tauri::AppHandle, port: u16, timeout: Duration) -> Result<(), String> {
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

fn main() {
    let smoke_requested = smoke_test_requested(&env::args_os().skip(1).collect::<Vec<_>>());
    let smoke_paths = match read_smoke_paths(smoke_requested) {
        Ok(paths) => paths,
        Err(error) => {
            eprintln!("Noter.ai smoke test configuration error: {error}");
            std::process::exit(1);
        }
    };
    let preferred = env::var("NOTER_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0)
        .unwrap_or(5230);
    let port = pick_port(preferred);

    let application = tauri::Builder::default()
        .manage(SidecarState {
            child: Mutex::new(None),
            port,
            window_companion: Mutex::new(WindowCompanionState::default()),
            recording_active: Mutex::new(false),
            startup_error: Mutex::new(None),
            smoke_paths,
            smoke_finished: Mutex::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            get_server_url,
            set_meeting_mode,
            toggle_meeting_collapsed,
            pick_library_folder,
            open_library_folder,
            set_recording_active,
            library_disk_space
        ])
        .setup(move |app| {
            let smoke_paths = app.state::<SidecarState>().smoke_paths.clone();
            if smoke_paths.is_some() {
                let handle = app.handle().clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_secs(45));
                    finish_smoke_test(&handle, 1, "The native application page did not finish loading within 45 seconds.");
                });
            }
            let mut main_window = tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?;
            if let Some(paths) = smoke_paths.as_ref() {
                // WKWebView ignores data_directory; a nonpersistent store keeps smoke runs isolated on macOS too.
                main_window = main_window.data_directory(paths.webview.clone()).incognito(true).visible(false);
            } else if let Some(directory) = env::var_os("NOTER_WEBVIEW_DATA_DIR") { main_window = main_window.data_directory(PathBuf::from(directory)); }
            main_window = main_window.on_page_load(|window, payload| {
                if payload.event() == tauri::webview::PageLoadEvent::Finished {
                    let state = window.state::<SidecarState>();
                    if state.smoke_paths.is_some() && selected_server_page(payload.url(), state.port) {
                        finish_smoke_test(window.app_handle(), 0, "The application page loaded.");
                        return;
                    }
                    let error = window.state::<SidecarState>().startup_error.lock().ok().and_then(|error| error.clone());
                    if let Some(message) = error { show_startup_error(window.app_handle(), &message); }
                }
            });
            main_window.build()?;

            // Only this app's selected loopback server can use desktop IPC.
            app.add_capability(tauri::ipc::CapabilityBuilder::new("noter-local-server")
                .window("main").local(false).remote(format!("http://127.0.0.1:{}/*", port))
                .permission("core:default")
                .permission("allow-get-server-url")
                .permission("allow-set-meeting-mode")
                .permission("allow-toggle-meeting-collapsed")
                .permission("allow-pick-library-folder")
                .permission("allow-open-library-folder")
                .permission("allow-set-recording-active")
                .permission("allow-library-disk-space"))?;
            let started = (|| -> Result<(), String> {
                let app_data_dir = smoke_paths.as_ref().map(|paths| paths.data.clone()).or_else(|| env::var_os("NOTER_DATA_DIR").map(PathBuf::from)).map(Ok).unwrap_or_else(|| app.path().app_data_dir())
                    .map_err(|error| format!("Could not locate the application data folder: {error}"))?;
                prepare_private_data_directory(&app_data_dir)?;
                let sidecar_bin = resolve_sidecar_path(app.handle())?;
                let mut cmd = Command::new(sidecar_bin);
                let home = env::var_os(if cfg!(target_os = "windows") { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
                    .or_else(|| app.path().home_dir().ok());
                let library_root = smoke_paths.as_ref().map(|paths| paths.library.clone()).or_else(|| env::var_os("NOTER_LIBRARY_ROOT").map(PathBuf::from)).unwrap_or_else(|| default_library_root(home, &app_data_dir));
                cmd.env("NOTER_LIBRARY_ROOT", library_root).env("NOTER_DESKTOP", "1");
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
            })();
            if let Err(error) = started {
                show_startup_error(app.handle(), &error);
                return Ok(());
            }

            let handle = app.handle().clone();
            thread::spawn(move || {
                match wait_for_server(&handle, port, Duration::from_secs(30)) {
                    Ok(()) => {
                        if let Some(window) = handle.get_webview_window("main") {
                            let url = format!("http://127.0.0.1:{}", port);
                            if let Err(error) = window.eval(&format!("window.location.replace({:?});", url)) {
                                show_startup_error(&handle, &format!("Could not load the local application page: {error}"));
                            }
                        } else {
                            show_startup_error(&handle, "The native application window is unavailable.");
                        }
                    }
                    Err(error) => show_startup_error(&handle, &error),
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<SidecarState>();
                if state.recording_active.lock().map(|active| *active).unwrap_or(true) {
                    api.prevent_close();
                    if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
                        let _ = webview.eval("window.dispatchEvent(new Event('noter-recording-close-requested'))");
                    }
                }
            }
        })
        .build(tauri::generate_context!());
    let application = match application {
        Ok(application) => application,
        Err(error) if smoke_requested => {
            eprintln!("Noter.ai smoke test failed to build its native window: {error}");
            std::process::exit(1);
        }
        Err(error) => panic!("error while building Noter.ai desktop application: {error}"),
    };
    application.run(|app_handle, event| match event {
        RunEvent::ExitRequested { api, .. } => {
            let state = app_handle.state::<SidecarState>();
            let unfinished = state.smoke_paths.is_some()
                && state
                    .smoke_finished
                    .lock()
                    .map(|finished| !*finished)
                    .unwrap_or(true);
            if unfinished {
                api.prevent_exit();
                finish_smoke_test(
                    app_handle,
                    1,
                    "The native window closed before the application page loaded.",
                );
            }
        }
        RunEvent::Exit => {
            let state = app_handle.state::<SidecarState>();
            let _ = stop_owned_sidecar(&state);
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

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

    fn application_dir() -> PathBuf {
        env::temp_dir().join("noter-sidecar-selection-tests")
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

    #[test]
    fn folder_reveal_uses_the_native_program_without_a_shell() {
        assert_eq!(folder_opener("windows").unwrap(), "explorer.exe");
        assert_eq!(folder_opener("macos").unwrap(), "open");
        assert_eq!(folder_opener("linux").unwrap(), "xdg-open");
        assert!(folder_opener("unsupported").is_err());
    }

    #[test]
    fn smoke_mode_requires_the_exact_explicit_flag() {
        assert!(smoke_test_requested(&[OsString::from("--smoke-test")]));
        assert!(!smoke_test_requested(&[]));
        assert!(!smoke_test_requested(&[OsString::from(
            "--smoke-test=true"
        )]));
        assert!(read_smoke_paths(false).unwrap().is_none());
    }

    #[test]
    fn smoke_directory_values_cannot_be_missing_empty_or_relative() {
        let name = "NOTER_DATA_DIR";
        assert!(smoke_path_value(name, None).is_err());
        assert!(smoke_path_value(name, Some(OsString::new())).is_err());
        assert!(smoke_path_value(name, Some(OsString::from("relative/data"))).is_err());
        assert!(smoke_path_value(
            name,
            Some(application_dir().join("../profile").into_os_string())
        )
        .is_err());
        assert_eq!(
            smoke_path_value(name, Some(application_dir().into_os_string())).unwrap(),
            application_dir()
        );
    }

    #[test]
    fn smoke_directories_must_stay_below_the_temporary_root() {
        let root = application_dir().join("temporary-root");
        let valid = [
            root.join("data"),
            root.join("library"),
            root.join("webview"),
        ];
        assert!(validate_smoke_paths(&valid, &root).is_ok());
        for invalid in [
            application_dir().join("normal-profile"),
            root.clone(),
            PathBuf::from("relative"),
            root.join("data/../profile"),
        ] {
            let paths = [invalid, valid[1].clone(), valid[2].clone()];
            assert!(validate_smoke_paths(&paths, &root).is_err());
        }
    }

    #[test]
    fn smoke_directories_cannot_overlap() {
        let root = application_dir();
        assert!(validate_smoke_paths(
            &[root.join("data"), root.join("data"), root.join("webview")],
            &root
        )
        .is_err());
        assert!(validate_smoke_paths(
            &[
                root.join("data"),
                root.join("data/library"),
                root.join("webview")
            ],
            &root
        )
        .is_err());
    }

    #[test]
    fn smoke_success_accepts_only_the_selected_loopback_origin() {
        for url in [
            "http://127.0.0.1:5230/",
            "http://127.0.0.1:5230/auth?redirect=%2F",
        ] {
            assert!(selected_server_page(&tauri::Url::parse(url).unwrap(), 5230));
        }
        for url in [
            "https://127.0.0.1:5230/",
            "http://127.0.0.1:5231/",
            "http://localhost:5230/",
            "http://127.0.0.1.example.com:5230/",
            "http://user@127.0.0.1:5230/",
            "tauri://localhost/",
        ] {
            assert!(!selected_server_page(
                &tauri::Url::parse(url).unwrap(),
                5230
            ));
        }
    }

    #[test]
    fn linux_smoke_mode_rejects_a_disabled_webkit_sandbox() {
        assert!(validate_smoke_sandbox("linux", None).is_ok());
        assert!(validate_smoke_sandbox("linux", Some(OsString::new())).is_ok());
        assert!(validate_smoke_sandbox("linux", Some(OsString::from("1"))).is_err());
        assert!(validate_smoke_sandbox("windows", Some(OsString::from("1"))).is_ok());
    }

    #[test]
    fn smoke_http_proof_rejects_error_and_unrelated_pages() {
        let body = "<html><title>Noter.ai</title><div id=\"root\"></div><script type=\"module\"></script></html>";
        let response =
            format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n{body}");
        assert!(validate_smoke_http_page(response.as_bytes()).is_ok());
        assert!(
            validate_smoke_http_page(response.replace("200 OK", "404 Not Found").as_bytes())
                .is_err()
        );
        assert!(
            validate_smoke_http_page(response.replace("Noter.ai", "Unrelated app").as_bytes())
                .is_err()
        );
        assert!(validate_smoke_http_page(
            response.replace("text/html", "application/json").as_bytes()
        )
        .is_err());
        assert!(validate_smoke_http_page(b"HTTP/1.1 200 OK\r\n").is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn smoke_windows_paths_preserve_unicode_and_unc_without_verbatim_prefixes() {
        assert_eq!(
            windows_process_path(Path::new(r"\\?\C:\Temp\Noter 笔记\data")),
            PathBuf::from(r"C:\Temp\Noter 笔记\data")
        );
        assert_eq!(
            windows_process_path(Path::new(r"\\?\UNC\server\share\data")),
            PathBuf::from(r"\\server\share\data")
        );
        assert_eq!(
            windows_process_path(Path::new(r"C:\Temp\data")),
            PathBuf::from(r"C:\Temp\data")
        );
    }
}
