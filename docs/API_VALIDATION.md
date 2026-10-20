# AI request validation and verification

The following are existing server-side boundaries, not guarantees supplied by frontend forms. Internal API and storage identifiers retain compatibility with earlier installations.

## Transcription

[`ai_service_transcribe.go`](../server/api/ai_service_transcribe.go) checks the authenticated user and charges the per-user transcription rate limit before contacting a provider. It rejects missing/empty audio, remote audio URIs, content over **25 MiB**, filenames over **255 bytes**, model overrides over **256 bytes**, and unsupported content types. An omitted MIME type is detected from the content; a provided type is parsed with Go's MIME parser before checking the supported-type list, allowing valid codec parameters while rejecting malformed ones. This is a format boundary, not a guarantee that arbitrary uploaded audio is valid or accurately transcribed.

Provider selection is resolved against the instance's saved provider configuration. Optional speaker recognition uses the configured speaker provider rather than treating the microphone/shared-audio channel name as an identity. Provider failures return errors and refund the transcription charge where implemented.

## Meeting notes

[`ai_service_meeting.go`](../server/api/ai_service_meeting.go) requires authentication, a nonempty transcript and a maximum transcript size of **256 KiB**. Provider/model identifiers are bounded before resolution. The provider's meeting-state JSON is parsed and sanitized: lists are limited to **64 items**, each item to **512 bytes**, empty strings are removed and duplicates are handled before Markdown is returned. Truncation preserves complete UTF-8 characters, including accented text, CJK text and emoji, so an item at the size limit does not make the response invalid.

AI output remains an editable draft. These checks do not establish factual accuracy, speaker identity, or correct interpretation of a deadline. The original transcript/recording remains the material to review.

## List filters

[`filter/engine.go`](../filter/engine.go) compiles schema-checked CEL expressions with an **8,192-code-point** parser limit, then renders a condition tree into SQL with bound arguments for each database dialect. Unsupported fields, operators and malformed expressions fail compilation or rendering rather than becoming raw SQL. [`filter_access.go`](../server/api/filter_access.go) also checks access to explicitly referenced spaces; a filter cannot grant access to another user's space. These boundaries already exist and do not depend on a frontend form or a separate schema library.

## Provider configuration and credentials

[`instance_service_validation.go`](../server/api/instance_service_validation.go) validates provider/transcription/model configuration before persistence. [`ai_service.go`](../server/api/ai_service.go) resolves provider configurations and handles connection checks/model discovery. Existing server tests cover account authorization, stored-key masking and preservation, invalid settings, transcription limits and meeting processing. The refactor into these files does not alter the public RPC schema or authentication behavior.

Run the relevant behavior checks with:

```sh
go test ./server/api ./server/api/test -run 'AI|Meeting|Transcrib' -count=1
go test ./filter -count=1
pnpm --dir web test tests/ai-model-settings.test.tsx tests/ai-settings-storage.test.ts
```

The backend suite needs the documented [test environment](CONTRIBUTOR_VERIFICATION.md). [`ai_request_validation_test.go`](../server/api/test/ai_request_validation_test.go) verifies that invalid transcription requests never reach a configured local provider fixture and that exact model/filename limits and MIME parameters remain accepted. [`ai_meeting_format_test.go`](../server/api/ai_meeting_format_test.go) covers multibyte note truncation. Real provider credentials are not required for fixture-based regression tests. Tests with local provider fixtures do not establish access to a particular external account or production provider.
