Open **Settings > AI & meetings** to configure transcription and meeting AI. They have separate jobs: transcription turns audio into text; meeting AI organizes that text and answers questions.

## Choose a connection

| Connection | What you provide | Important distinction |
| --- | --- | --- |
| ChatGPT account | Your own eligible account and authorization | Plan access and model limits depend on your account. |
| OpenAI API | Your own API key | API billing is separate from a ChatGPT subscription. |
| Other supported AI providers | Your own provider connection or key | Availability and costs follow the provider. |
| Groq Whisper | Your Groq API key | Transcription does not identify individual people in shared audio. |

Noter.ai itself has no subscription. It does not include shared provider API keys or unlimited AI usage.

## Connect ChatGPT

1. Choose **ChatGPT account** in the AI settings.
2. Select **Continue with ChatGPT**.
3. Complete the browser authorization yourself and review the requested permission.
4. Return to Noter.ai, choose a model available to that account, and save.
5. Use **Check AI** to verify an actual request.

A successful identity sign-in without the required plan-usage permission is not enough to run AI requests. Account eligibility, model availability and limits remain provider-dependent.

## Use an API key

Add the provider in AI settings and enter your own key. Choose the intended connection and model, then save the meeting AI choice. Use **Check AI** before starting a longer meeting.

Keys and account tokens stay with that installation's app data. Do not put them in screenshots, notes shared publicly, GitHub issues or chat messages.

## Set up transcription

Choose the speech transcription provider and model separately. Groq Whisper offers V3 and V3 Turbo choices. Configure language or prompt hints when useful, save the audio settings, and use **Check audio**.

Optional speaker recognition uses a separate Deepgram or ElevenLabs connection. Groq-only shared audio is grouped rather than assigned verified person identities.

## Saved model choices

After saving, Noter.ai reuses your selected provider and model on later launches. **Refresh models** is for browsing the account's current catalog; it should not be required every time you open the app. If the provider withdraws a model or changes your access, choose an available replacement.

## Antigravity is experimental

The retained Antigravity connection is not a supported public third-party integration under Google's stated policy. Successful sign-in does not establish supported service access. Do not rely on it as a guaranteed free public AI connection. Prefer supported provider access for regular use.

See the project's [AI connection notes](https://github.com/mrfost07/noter.ai/blob/main/docs/AI_CONNECTIONS.md) for implementation details and provider references.
