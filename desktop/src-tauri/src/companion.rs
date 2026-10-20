//! Meeting companion window sizing and recording-close state.

use tauri::{LogicalSize, PhysicalPosition, PhysicalSize, Position, Size, WebviewWindow};

use crate::state::SidecarState;

#[derive(Default)]
pub(crate) struct WindowCompanionState {
    prev_pos: Option<PhysicalPosition<i32>>,
    prev_size: Option<PhysicalSize<u32>>,
    is_meeting_mode: bool,
    is_collapsed: bool,
    prev_maximized: bool,
    prev_decorated: bool,
}

#[tauri::command]
pub(crate) fn set_recording_active(
    state: tauri::State<'_, SidecarState>,
    active: bool,
) -> Result<(), String> {
    *state.recording_active.lock().map_err(|e| e.to_string())? = active;
    Ok(())
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
pub(crate) fn set_meeting_mode(
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
pub(crate) fn toggle_meeting_collapsed(
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
