# Code signing policy

Status as of October 16, 2026: Windows signing preparation is in progress. The current Noter.ai installers are unsigned. A SignPath Foundation application is being prepared; no Foundation approval or production signing access has been granted. Mac signing and notarization are deferred.

## Responsible maintainer

- Committer and reviewer: [mrfost07](https://github.com/mrfost07).
- Release and signing approver: [mrfost07](https://github.com/mrfost07).

Changes from other contributors require maintainer review before a signing candidate is approved. Signing access will require multi-factor authentication. Each production signing request must receive manual approval from the responsible maintainer.

## Intended Windows signing process

Candidates must be built from an identified commit in this repository on GitHub-hosted runners. Required checks must pass. Sign the desktop executable and bundled local server, then package and sign the installers and applicable uninstaller. Validate the signatures, extracted executable identities, startup and process cleanup; generate final checksums after signing.

SignPath must review the project's eligibility, including its derived source and licensing, before Foundation signing can be activated. Code signing establishes publisher identity and artifact integrity; it does not certify that the application is bug-free or remove all Windows reputation warnings.

If Foundation signing is approved and activated, signed release pages will carry the required credit: “Free code signing provided by SignPath.io, certificate by SignPath Foundation”. This is a planned credit, not a claim that current builds are signed or sponsored.

## Privacy and downloads

Read the [privacy policy](PRIVACY.md) for local storage and optional network services. Download candidates only from [Noter.ai releases](https://github.com/mrfost07/noter.ai/releases); consult each release's signing status and checksums.

Requirements: [SignPath Foundation conditions](https://signpath.org/terms.html). Security reports: [security policy](SECURITY.md).
