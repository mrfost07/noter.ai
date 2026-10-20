The Linux candidate is a **notes and recording-review preview**. Live microphone and screen capture are unavailable in this release. You can write notes and review existing recordings while safe native capture support is developed.

## AppImage

Download the x64 `.AppImage`, make the file executable, then open it. For the current release:

```sh
chmod +x Noter.ai_26.10.16-rc.4_x86_64-unknown-linux-gnu.AppImage
./Noter.ai_26.10.16-rc.4_x86_64-unknown-linux-gnu.AppImage
```

The command's filename must match the package you downloaded. AppImage runtime requirements vary by distribution. If the launcher reports a missing dependency, use your distribution's supported package instructions or try the Debian package on a compatible distribution.

## Debian package

On a compatible Debian/Ubuntu system, install the downloaded local package with:

```sh
sudo apt install ./Noter.ai_26.10.16-rc.4_x86_64-unknown-linux-gnu.deb
```

Use the application launcher to open Noter.ai after installation.

[Open Linux downloads](../../download/#linux)

## Current limits

- Live microphone, shared-audio and screen capture are unavailable in this candidate.
- Media playback depends on the distribution's available WebKit/media stack.
- The folder picker and free-space display are currently Windows-only. Keep the default library location on Linux.
- Package/startup CI checks do not establish compatibility with every Linux distribution or physical audio device.

## Updates and backups

There is no automatic updater. Download a newer AppImage or Debian package when a release is published. Back up your profile/database and library together before changing versions. See [local files and backups](../storage/).
