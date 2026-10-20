Start by confirming that you launched the latest installed desktop app. The release version is shown on the [download page](../../download/); check the app's system/version settings to compare.

## The app looks like an older version

Use the Start menu or Applications launcher rather than an executable left in a development or Downloads folder. Close the old app before installing a newer package. Current candidates have no automatic updater.

## Microphone text appears while I am quiet

Speech models can produce words from silence, background noise or audio leaking from speakers. Check the selected microphone, test the audio settings, and consider headphones to reduce leakage from shared audio. Review questionable passages against the recording.

Noter.ai includes silence filtering, but no transcription model is guaranteed to produce perfect text in every acoustic environment.

## Shared audio is missing

A shared screen is not automatically a shared audio track. Reopen capture selection and enable audio sharing if the operating system offers it. Inspect the meeting companion's source indicators.

Internal audio is not guaranteed on macOS. Linux live capture is unavailable in this release. Test a short recording on the intended device before a long meeting.

## Every shared-audio speaker has the same label

Groq Whisper does not return individual speaker identities. Optional Deepgram or ElevenLabs speaker recognition can add numbered labels, but those labels can still be imperfect. They are not verified names.

## AI sign-in works but a request fails

Save an available model and use **Check AI**. Confirm that the account granted the required permission and has access to the model. ChatGPT plan usage and OpenAI API billing are separate. An exhausted provider quota or withdrawn model is not fixed by reinstalling the app.

The Antigravity connection remains experimental and unsupported for public third-party use. See [AI connections](../ai-connections/).

## The transcript highlight does not move

Check that the player is advancing and **Follow playback** is on. Clear a search or speaker filter that may hide the active passage. Some older entries have approximate timing or no matching recording. Reopen the meeting and compare a known timestamp with the source video.

## A recording or folder cannot be opened

Check whether the library is available and whether the file was moved or removed outside Noter.ai. Restore it from a backup if needed. The native folder picker is currently Windows-only.

## Report a reproducible issue

Include the app version, operating system, selected provider, exact error text, and steps to reproduce. A small sample without private meeting content can help. Do not include API keys, tokens or personal recordings you do not intend to share.

[Open a GitHub issue](https://github.com/mrfost07/noter.ai/issues/new/choose)
