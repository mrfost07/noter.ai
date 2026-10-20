//! Shared native application state; each responsibility owns its mutation rules.

use std::process::Child;
use std::sync::Mutex;

use crate::companion::WindowCompanionState;
use crate::smoke::SmokeTestPaths;

pub(crate) struct SidecarState {
    pub(crate) child: Mutex<Option<Child>>,
    pub(crate) port: u16,
    pub(crate) window_companion: Mutex<WindowCompanionState>,
    pub(crate) recording_active: Mutex<bool>,
    pub(crate) startup_error: Mutex<Option<String>>,
    pub(crate) smoke_paths: Option<SmokeTestPaths>,
    pub(crate) smoke_finished: Mutex<bool>,
}
