//! Native library selection, registered-folder reveal, and disk space.

use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
#[cfg(target_os = "windows")]
use std::thread;
use tauri::{Manager, WebviewWindow};

#[derive(serde::Serialize)]
pub(crate) struct LibraryDiskSpace {
    available: u64,
    total: u64,
}

#[tauri::command]
pub(crate) async fn pick_library_folder(window: WebviewWindow) -> Result<Option<String>, String> {
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
pub(crate) fn open_library_folder(
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

#[tauri::command]
pub(crate) fn library_disk_space(
    app: tauri::AppHandle,
    root: String,
) -> Result<LibraryDiskSpace, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_reveal_uses_the_native_program_without_a_shell() {
        assert_eq!(folder_opener("windows").unwrap(), "explorer.exe");
        assert_eq!(folder_opener("macos").unwrap(), "open");
        assert_eq!(folder_opener("linux").unwrap(), "xdg-open");
        assert!(folder_opener("unsupported").is_err());
    }
}
