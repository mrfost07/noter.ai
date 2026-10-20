Noter.ai stores its desktop app data and human-readable library on your device. Keeping both is important: recordings and Markdown files are only part of a complete backup.

## Two places to understand

**Application profile/data:** the database, account settings and local provider connection information. The native wrapper uses the operating system's application-data location under `ai.noter.desktop`.

**Library:** human-readable notes and meeting recordings. The default library is a folder named `Noter.ai` inside your home directory. The app manages account and environment subfolders within that library.

Use **Settings > Workspace settings > Library & recordings** to inspect the configured library location. Windows currently supports the native folder picker and free-space display; Mac and Linux can keep the default location.

## Managed files

Markdown copies are intended to remain readable outside the app. Meetings keep their recording, transcript and captions alongside the associated library data.

When external edits conflict with a managed Markdown update, Noter.ai reports the conflict rather than silently replacing the external file. Review the versions before deciding what to keep.

Moving or deleting managed recordings directly in a file manager can break playback links. Prefer the app's organization controls for linked notes and recordings.

## Make a consistent backup

1. Stop any active meeting and save the notes you want to retain.
2. Close Noter.ai so the database and files are no longer being updated.
3. Back up the application profile/data and the configured library together.
4. Keep the backup separate from the working folders.

Exporting only the Markdown notes does not back up every recording, account setting or database relationship. Protect backups that contain provider tokens or other private material.

## Restore and upgrade

Keep the app closed while restoring a matching profile/database and library backup. Preserve the expected library paths or reconfigure the library deliberately afterward.

Back up before upgrading. Installing an older executable does not reverse a database schema migration, so retaining a pre-upgrade profile backup is important.

## Cloud AI and local storage

Local storage does not mean every AI operation runs offline. Transcription and AI requests send the selected audio or text to your configured provider. A separately configured local provider can have a different data path. See [AI connections](../ai-connections/) and the [privacy page](../../privacy/).
