fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_server_url",
            "set_meeting_mode",
            "toggle_meeting_collapsed",
            "pick_library_folder",
            "open_library_folder",
            "set_recording_active",
            "library_disk_space",
        ]),
    ))
    .expect("failed to build Noter.ai desktop permissions");
}
