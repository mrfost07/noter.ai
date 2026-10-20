// Prevents an extra console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod companion;
mod library;
mod sidecar;
mod smoke;
mod smoke_http;
mod state;

use std::env;
use std::path::PathBuf;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{Manager, RunEvent};

use companion::WindowCompanionState;
use sidecar::{pick_port, start_sidecar, stop_owned_sidecar, wait_for_server};
use smoke::{finish_smoke_test, read_smoke_paths, selected_server_page, smoke_test_requested};
use state::SidecarState;

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
            sidecar::get_server_url,
            companion::set_meeting_mode,
            companion::toggle_meeting_collapsed,
            library::pick_library_folder,
            library::open_library_folder,
            companion::set_recording_active,
            library::library_disk_space
        ])
        .setup(move |app| {
            let smoke_paths = app.state::<SidecarState>().smoke_paths.clone();
            if smoke_paths.is_some() {
                let handle = app.handle().clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_secs(45));
                    finish_smoke_test(
                        &handle,
                        1,
                        "The native application page did not finish loading within 45 seconds.",
                    );
                });
            }
            let mut main_window =
                tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?;
            if let Some(paths) = smoke_paths.as_ref() {
                // WKWebView ignores data_directory; a nonpersistent store keeps smoke runs isolated on macOS too.
                main_window = main_window
                    .data_directory(paths.webview.clone())
                    .incognito(true)
                    .visible(false);
            } else if let Some(directory) = env::var_os("NOTER_WEBVIEW_DATA_DIR") {
                main_window = main_window.data_directory(PathBuf::from(directory));
            }
            main_window = main_window.on_page_load(|window, payload| {
                if payload.event() == tauri::webview::PageLoadEvent::Finished {
                    let state = window.state::<SidecarState>();
                    if state.smoke_paths.is_some()
                        && selected_server_page(payload.url(), state.port)
                    {
                        finish_smoke_test(window.app_handle(), 0, "The application page loaded.");
                        return;
                    }
                    let error = window
                        .state::<SidecarState>()
                        .startup_error
                        .lock()
                        .ok()
                        .and_then(|error| error.clone());
                    if let Some(message) = error {
                        show_startup_error(window.app_handle(), &message);
                    }
                }
            });
            main_window.build()?;

            // Only this app's selected loopback server can use desktop IPC.
            app.add_capability(
                tauri::ipc::CapabilityBuilder::new("noter-local-server")
                    .window("main")
                    .local(false)
                    .remote(format!("http://127.0.0.1:{}/*", port))
                    .permission("core:default")
                    .permission("allow-get-server-url")
                    .permission("allow-set-meeting-mode")
                    .permission("allow-toggle-meeting-collapsed")
                    .permission("allow-pick-library-folder")
                    .permission("allow-open-library-folder")
                    .permission("allow-set-recording-active")
                    .permission("allow-library-disk-space"),
            )?;
            let started = start_sidecar(app, port, smoke_paths.as_ref());
            if let Err(error) = started {
                show_startup_error(app.handle(), &error);
                return Ok(());
            }

            let handle = app.handle().clone();
            thread::spawn(
                move || match wait_for_server(&handle, port, Duration::from_secs(30)) {
                    Ok(()) => {
                        if let Some(window) = handle.get_webview_window("main") {
                            let url = format!("http://127.0.0.1:{}", port);
                            if let Err(error) =
                                window.eval(&format!("window.location.replace({:?});", url))
                            {
                                show_startup_error(
                                    &handle,
                                    &format!("Could not load the local application page: {error}"),
                                );
                            }
                        } else {
                            show_startup_error(
                                &handle,
                                "The native application window is unavailable.",
                            );
                        }
                    }
                    Err(error) => show_startup_error(&handle, &error),
                },
            );

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<SidecarState>();
                if state
                    .recording_active
                    .lock()
                    .map(|active| *active)
                    .unwrap_or(true)
                {
                    api.prevent_close();
                    if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
                        let _ = webview.eval(
                            "window.dispatchEvent(new Event('noter-recording-close-requested'))",
                        );
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
