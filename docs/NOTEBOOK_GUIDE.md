# Noter.ai notebook guide

## Search expressions

Open search and choose expression mode to filter your notes with a Common Expression Language (CEL) expression. Text mode is available for ordinary searches.

Examples:

```text
"work" in tags
content.contains("deadline")
"work" in tags && !content.contains("GitHub")
```

`&&` combines conditions, `||` accepts either condition, and `!` negates a condition. Text inside quotes is case-sensitive. Press Enter to search.

## Access tokens

In Settings → Workspace settings → Access Tokens, create a personal access token for an integration. Copy it when it is created, store it securely, and choose an appropriate expiration. Use a separate token for each integration and revoke tokens you no longer need.

Send the token in the HTTP `Authorization` header using the `Bearer` scheme. The example in settings uses your current instance address; replace `YOUR_ACCESS_TOKEN` with the token you created. The desktop instance is local to your device and normally cannot be reached from another computer.

Do not share tokens in issues, screenshots or chat. Tokens authorize access as your account. API resource paths retain compatibility identifiers; these do not change the Noter.ai product name.

For AI account connections and transcription keys, see [AI connections](AI_CONNECTIONS.md). For desktop packages and current limitations, see [release status](RELEASE_STATUS.md).
