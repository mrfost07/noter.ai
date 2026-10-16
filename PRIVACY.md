# Noter.ai privacy policy

Last updated: October 16, 2026.

This describes the current Noter.ai desktop application maintained by [mrfost07](https://github.com/mrfost07). A separately hosted instance is also subject to the practices of its operator.

## Data on your device

The desktop app runs a bundled server on your device's loopback address. Notes, account settings, meeting transcripts, recordings and library metadata are stored in the local profile and library. Provider credentials are part of the local profile and must be protected when copying or backing it up. Personal credentials, notes and recordings are not included in release installers.

The maintainer does not operate a Noter.ai cloud service that automatically receives your desktop notes or recordings.

## Optional network services

When you enable an AI or transcription connection, Noter.ai sends the information needed for that feature to the configured provider. This can include audio, transcripts, note context and questions. Optional speaker recognition can send shared audio to its selected provider. Account sign-in, model discovery and credential refresh also communicate with the chosen service. A local AI endpoint sends requests to the local service you configured.

Providers process requests under their own terms and policies. Their retention and training practices depend on the service, account and settings; local storage does not make a cloud AI request offline. Common provider policies include [OpenAI](https://openai.com/policies/privacy-policy/), [Google](https://policies.google.com/privacy), [Groq](https://groq.com/privacy-policy), [Deepgram](https://deepgram.com/privacy) and [ElevenLabs](https://elevenlabs.io/privacy-policy). Consult your configured provider for other integrations and custom endpoints.

Remote images or other linked content in a note can contact their hosting services when viewed. Location features can contact map, tile and reverse-geocoding services, including [OpenStreetMap](https://osmfoundation.org/wiki/Privacy_Policy) and OpenFreeMap, and disclose the requested coordinates or map area. An instance operator can configure external identity providers, attachment storage or sign-in challenges; their services receive the data required for those enabled functions.

Downloads, issues and project discussions are hosted by [GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). External links open third-party sites with their own privacy practices.

## Your choices

You choose when to start meeting capture and which available audio or screen sources to share. Stop capture when finished and inform meeting participants. Configure or disconnect optional providers in settings. Provider-side records and permissions may need separate deletion or revocation through that provider.

You can export and manage your local notes and library files. Archiving an item is not the same as deleting its profile or recording files. Closing or uninstalling the desktop application does not by itself request deletion from any external AI provider. Protect backups and delete unwanted copies separately.

## Questions and security reports

For general questions, use [project discussions](https://github.com/mrfost07/noter.ai/discussions) without including private content. Report vulnerabilities through [private vulnerability reporting](https://github.com/mrfost07/noter.ai/security/advisories/new). Do not post credentials, private notes or recordings in public issues.
