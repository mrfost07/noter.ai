//! Explicit native smoke mode and isolated temporary profile validation.

use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::Manager;

use crate::sidecar::stop_owned_sidecar;
use crate::smoke_http::verify_smoke_http_page;
use crate::state::SidecarState;

#[derive(Clone)]
pub(crate) struct SmokeTestPaths {
    pub(crate) data: PathBuf,
    pub(crate) library: PathBuf,
    pub(crate) webview: PathBuf,
}

pub(crate) fn smoke_test_requested(arguments: &[OsString]) -> bool {
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

pub(crate) fn read_smoke_paths(requested: bool) -> Result<Option<SmokeTestPaths>, String> {
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

pub(crate) fn selected_server_page(url: &tauri::Url, port: u16) -> bool {
    url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port_or_known_default() == Some(port)
        && url.username().is_empty()
        && url.password().is_none()
}

pub(crate) fn finish_smoke_test(app: &tauri::AppHandle, requested_code: i32, message: &str) {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn application_dir() -> PathBuf {
        env::temp_dir().join("noter-sidecar-selection-tests")
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
