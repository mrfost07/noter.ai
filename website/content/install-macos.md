Noter.ai provides separate disk images for Apple Silicon and Intel Macs. Native hardware capture and permissions still require additional platform testing in the current experimental release.

## Choose the right disk image

Open **Apple menu > About This Mac**:

- A **Chip** entry such as Apple M1, M2, M3 or M4 means **Apple Silicon**.
- A **Processor** entry mentioning Intel means **Intel**.

[Open Mac downloads](../../download/#macos)

## Install

1. Download the matching `.dmg`.
2. Open the disk image.
3. Drag Noter.ai into **Applications**.
4. Open it from Applications.

The current Mac bundles are ad-hoc signed and **not notarized by Apple**. macOS may block opening or require additional review. Only proceed with a download you have chosen to trust. See Apple's [instructions for opening apps safely](https://support.apple.com/en-us/102445).

## Recording permissions

Microphone and screen capture may need access in macOS privacy settings. The exact system prompts depend on your macOS version. Restart the app if a permission change requires it.

**Internal/system-audio capture is not guaranteed on macOS.** A successful screen selection does not prove that an audio track is being shared. Inspect Noter.ai's source indicators and test a short recording before relying on it.

The native folder picker and free-space display are currently Windows-only. Mac installations can retain the default library location.

## Upgrade

Back up the profile and library, close the app, and replace the application with the newer version. The current candidate has no automatic update channel. See [local files and backups](../storage/) and [troubleshooting](../troubleshooting/).
