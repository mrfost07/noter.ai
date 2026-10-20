Use the Windows x64 package for a 64-bit Windows 10 or Windows 11 computer.

## Choose your installer

- **Setup.exe** is the straightforward choice for a normal installation.
- **MSI** is an alternative for people who prefer Windows Installer packages.

Both contain the desktop app. JSON manifests, checksums and source archives on GitHub are verification or development files, not installers.

[Open Windows downloads](../../download/#windows)

## Install and open

1. Download the installer from this website or the project's GitHub Releases page.
2. Close an existing Noter.ai window before upgrading.
3. Run the installer and complete its prompts.
4. Launch **Noter.ai** from the Start menu.

The candidate installers are currently unsigned, so Windows may display a publisher or SmartScreen warning. Check the release source and the available SHA-256 checksums before deciding whether to trust a download. Signing is being prepared; a warning-free installation is not promised yet.

## Check the installed version

Open the app's settings and inspect its system/version information. Compare it with the version on the download page. Launch from the Start menu rather than an older development executable or a previously downloaded installer.

There is no automatic updater in the current candidate. To upgrade, download and install the newer package yourself.

## Capture permissions

Allow microphone access when prompted. For shared audio, choose a screen or window with audio sharing supported by your system. Use the source indicators in the meeting companion to confirm which channels are active.

For audio checks and limitations, see [capture a meeting](../meetings/).

## Before an upgrade

Back up the application profile/database and the human-readable library together. Keep the app closed while making a consistent file backup. See [local files and backups](../storage/).
