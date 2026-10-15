# AI connections

Noter.ai stores provider settings in the private application profile on each device. Installers contain no personal provider credentials. Updating the app preserves the profile; uninstalling or deleting the profile is not required to reconnect.

## Antigravity

Official desktop installers include Noter.ai's publisher-configured Google **Desktop app** OAuth client. In **Settings → AI & meetings**, select **Google Antigravity**, then **Sign in with Google**. Users do not create Google Cloud projects or enter client configuration. Each user authorizes their own account; personal tokens are stored only on their device.

Release maintainers supply the downloaded `installed` OAuth client JSON through the repository Actions secret `NOTER_DESKTOP_GOOGLE_OAUTH_JSON`. The desktop build validates the client type, rejects Web application configuration, embeds only the desktop client ID and client secret, and fails CI packaging if the configuration is missing. Installed-app client configuration is extractable from binaries by design; GitHub secret storage prevents accidental source/log disclosure, not extraction from an installer. Never supply a confidential Web application client here. Source builds without this configuration can use **Antigravity setup** or environment variables.

Select **Sign in with Google**, finish in the system browser, then return to Noter.ai. Select a model, save the meeting AI choice, and use **Check AI**. Saving application setup alone does not mean Google account authentication or inference succeeded.

The client must support the exact callback `http://localhost:51121/oauth-callback`. The callback port must be available. The app uses PKCE and checks the returned state. An authorized Google desktop client supports a loopback flow; a web client must have the exact callback registered. Do not distribute a private web application's client secret in an installer. Google consent, test-user restrictions, verification requirements, and access to Antigravity's services are managed by Google. Creating a generic Google OAuth client does not itself grant access to Antigravity's internal services.

The advanced `NOTER_ANTIGRAVITY_CLIENT_ID` and `NOTER_ANTIGRAVITY_CLIENT_SECRET` environment variables remain supported when no application setup has been saved. Existing account tokens remain usable; legacy connections use the saved application setup when renewing. Newly connected accounts retain their issuing client configuration, and successful refreshes are persisted.

Reference: [Google OAuth for installed apps](https://developers.google.com/identity/protocols/oauth2/native-app).

### Google says “Access blocked” / error 403

If the Google page says the app is being tested and only developer-approved testers can access it, the publisher's OAuth project is in **Testing**. The publisher must select the matching project in **Google Auth Platform → Audience → Test users**, add the account used for sign-in, and save. Cancel the pending Noter.ai attempt, then sign in again. Users do not configure their own OAuth clients. Reinstalling does not change Google's test-user list.

Testing is limited to 100 listed users, and authorizations for this integration expire after seven days, including offline refresh tokens. It is unsuitable as a permanent public distribution setting. For a public launch, the publisher must configure the intended external audience, publish the OAuth application, and complete the Google verification applicable to the requested scopes and branding. Publishing status does not itself guarantee Antigravity service access. See [Google's audience and testing rules](https://support.google.com/cloud/answer/15549945?hl=en).

## ChatGPT account

Choose **ChatGPT account**, select **Continue with ChatGPT**, and authorize Noter.ai in the system browser. Eligible accounts can grant ChatGPT plan usage. A successful identity sign-in without plan permission is shown separately and cannot run AI requests.

Refresh the model list to retrieve models available to the selected account, select one, save the meeting AI choice, then use **Check AI**. No API key or shared OpenAI client secret is needed for this open-source registration flow. This is a Noter.ai registration; the app does not copy credentials from Codex or another application.

Each installation has its own stable host ID. Each saved account retains its issued client ID, verified identity, granted permissions and tokens. Returning sign-ins reuse that registration; adding another account creates a separate connection. Refresh tokens are rotated and saved together, with refreshes serialized. **Sign out** attempts remote revocation, clears local tokens, and reports when remote revocation could not be confirmed.

ChatGPT requests use the public Responses API with `store: false` and `stream: true`. An answer is accepted only after the completed event. Failed, incomplete or interrupted streams are errors rather than successful partial answers. Provider eligibility, permission approval, model availability and usage limits remain account-dependent.

References: [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [account renewal and sign-out](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).

## OpenAI API

Choose **OpenAI API** to use an API key with separate OpenAI Platform billing. ChatGPT plan sign-in and API billing are different connections. Invalid credentials, exhausted API credits and temporary rate limits are reported with different recovery instructions. Reinstalling Noter.ai does not restore credits or change account limits.

## Verification boundary

Automated tests cover missing and saved application setup, persistence, permissions, secret redaction, PKCE parameters, callback validation, ID-token signature/issuer/audience/expiry/nonce checks, account binding, model catalogs, token rotation, revocation and completed response streams. Fixture tests do not prove that a particular Google client is authorized for Antigravity or that a ChatGPT account is eligible. Complete a real fresh-install sign-in and **Check AI** for the accounts being used before treating that connection as verified.
