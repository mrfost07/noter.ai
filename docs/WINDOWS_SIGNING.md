# Windows signing setup

## Current state

The SignPath Foundation application is being prepared. Windows RC3 is unsigned; no SignPath account, production certificate policy or API token is configured in Actions. Mac signing and notarization are deferred at the maintainer's request.

Public application links:

- Repository/homepage: https://github.com/mrfost07/noter.ai
- Downloads: https://github.com/mrfost07/noter.ai/releases
- Code signing policy: https://github.com/mrfost07/noter.ai/blob/main/CODE_SIGNING.md
- Privacy policy: https://github.com/mrfost07/noter.ai/blob/main/PRIVACY.md
- Application: https://signpath.org/apply.html

The project is new and contains derived source. Its GitHub history was consolidated into personal project history, so GitHub does not mark it as a fork. Disclose the source origin and request an eligibility review; do not claim established reputation or guaranteed eligibility. The maintainer must resolve required attribution in LICENSE before a signing approval can represent license compliance. This preparation does not change LICENSE.

## After Foundation approval

1. Complete the SignPath account setup and enable multi-factor authentication for SignPath and GitHub.
2. Configure a project linked specifically to `mrfost07/noter.ai`, with GitHub.com as its trusted build system. Review any GitHub App permissions before granting repository access.
3. Create artifact configurations for the desktop executable, Go sidecar and Windows installers. Restrict paths, product names and versions. The current Go sidecar has no Windows product/version resources; add them before enforcing those restrictions.
4. Create a production signing policy requiring the maintainer's manual approval. Use a submitter-only automation token; store it as the repository Actions secret `SIGNPATH_API_TOKEN`. Store the approved organization ID and project/policy/configuration slugs as Actions variables. Do not paste tokens into issues, source files or chat.
5. Integrate signing into the Windows build. Sign inner executables before bundling, and sign installers and the NSIS uninstaller at the appropriate packaging stages. Upload each signing input as a GitHub Actions artifact before requesting signing, so SignPath can verify its origin. Merely signing the outer Setup.exe leaves installed programs unsigned.
6. Update the package verifier and manifest format for signed binaries. Preserve source commit and Go build identity checks, validate trusted Authenticode signatures and the approved signer, and compute final hashes after signing. The current verifier intentionally accepts only the existing unsigned candidate format; signed files cannot simply be substituted into a staged RC.
7. Build a new immutable candidate, verify extraction/startup/upgrade and signing on Windows, and publish only after the signing request and acceptance checks succeed. Keep published RC3 files and tags unchanged.

Use the official [GitHub integration](https://docs.signpath.io/trusted-build-systems/github) and [artifact configuration examples](https://docs.signpath.io/artifact-configuration/examples). Verify the supported action version and exact account-specific slugs when the account is approved. The current release workflow remains the verified unsigned workflow during application review.
