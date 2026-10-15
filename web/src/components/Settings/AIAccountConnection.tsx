import { create } from "@bufbuild/protobuf";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { aiServiceClient } from "@/connect";
import {
  ConfigureAntigravityOAuthRequestSchema,
  DisconnectChatGPTRequestSchema,
  GetAIConnectionStatusRequestSchema,
  StartAntigravityOAuthRequestSchema,
  StartChatGPTOAuthRequestSchema,
} from "@/types/proto/api/ai_service_pb";
import { InstanceSetting_AIProviderType } from "@/types/proto/api/instance_service_pb";
import type { LocalAIProvider } from "./AISection";

const statusKey = ["ai-connection-status"];

export function aiConnectionError(reason: unknown): string {
  const message = (reason instanceof Error ? reason.message : String(reason)).replace(/^\[[a-z_]+\]\s*/, "").replace(/^connection:\s*/, "");
  return message ? message[0].toUpperCase() + message.slice(1) : "Connection failed. Try again.";
}

interface Props {
  provider: LocalAIProvider;
  onConnected: (provider: LocalAIProvider) => Promise<void>;
  accounts?: LocalAIProvider[];
  onSelectAccount?: (provider: LocalAIProvider) => void;
}

export default function AIAccountConnection(props: Props) {
  return props.provider.type === InstanceSetting_AIProviderType.ANTIGRAVITY ? (
    <AntigravityConnection {...props} />
  ) : (
    <ChatGPTConnection {...props} />
  );
}

function useConnectionAttempt() {
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => pending.current?.abort(), []);
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      await action(controller.signal);
    } catch (reason) {
      if (!controller.signal.aborted) setError(aiConnectionError(reason));
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  const cancel = () => {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setError("Connection cancelled. Your existing connection was kept.");
  };
  return { busy, error, run, cancel };
}

function AntigravityConnection({ provider, onConnected }: Props) {
  const client = useQueryClient();
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => aiServiceClient.getAIConnectionStatus(create(GetAIConnectionStatusRequestSchema)),
    retry: false,
  });
  const configured = status.data?.antigravityConfigured ?? false;
  const id = useId();
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [setupError, setSetupError] = useState("");
  const attempt = useConnectionAttempt();
  useEffect(() => setClientId(status.data?.antigravityClientId ?? ""), [status.data?.antigravityClientId]);
  const save = async () => {
    setSaving(true);
    setSetupError("");
    try {
      const next = await aiServiceClient.configureAntigravityOAuth(
        create(ConfigureAntigravityOAuthRequestSchema, { clientId: clientId.trim(), clientSecret: secret.trim() }),
      );
      setSecret("");
      client.setQueryData(statusKey, next);
    } catch (reason) {
      setSetupError(aiConnectionError(reason));
    } finally {
      setSaving(false);
    }
  };
  const connect = () =>
    attempt.run(async (signal) => {
      const response = await aiServiceClient.startAntigravityOAuth(
        create(StartAntigravityOAuthRequestSchema, { providerId: provider.id, title: provider.title || "Google Antigravity" }),
        { signal, timeoutMs: 135000 },
      );
      if (signal.aborted) return;
      if (!response.connected) throw new Error("Google sign-in did not finish. Try again.");
      await onConnected({ ...provider, id: response.providerId, apiKey: "", apiKeySet: true, apiKeyHint: "Google OAuth" });
    });
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">Connect Noter.ai to Antigravity</p>
        <p role="status" className="text-sm leading-5 text-muted-foreground">
          {status.isPending
            ? "Checking application setup…"
            : !configured
              ? "Application setup is needed before Google sign-in."
              : provider.apiKeySet
                ? "Google account connected. Your model choice is saved separately below."
                : "Sign in with your Google account to connect Noter.ai."}
        </p>
      </div>
      {status.isError && (
        <p role="alert" className="text-sm text-destructive">
          Could not check setup.{" "}
          <button type="button" className="underline" onClick={() => void status.refetch()}>
            Try again
          </button>
        </p>
      )}
      <details open={!configured && !status.isPending} className="text-sm">
        <summary className="cursor-pointer font-medium">{configured ? "Advanced application setup" : "Antigravity setup"}</summary>
        <div className="mt-3 space-y-3">
          <p className="max-w-prose leading-5 text-muted-foreground">
            Enter the OAuth client configuration authorized for this integration. Noter.ai saves it on this installation; your client secret
            is never displayed again.
          </p>
          <p className="leading-5 text-muted-foreground">
            The Google client must support <code className="break-all">http://localhost:51121/oauth-callback</code>. Creating a Google
            client alone does not guarantee access to Antigravity’s services.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-client`}>Google OAuth client ID</Label>
            <Input
              id={`${id}-client`}
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="…apps.googleusercontent.com"
              autoComplete="off"
              maxLength={512}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-secret`}>Google OAuth client secret</Label>
            <Input
              id={`${id}-secret`}
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder={configured ? "Leave blank to keep the saved secret" : "Enter the client secret"}
              autoComplete="new-password"
              maxLength={2048}
            />
          </div>
          {setupError && (
            <p role="alert" className="text-sm leading-5 text-destructive">
              {setupError}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void save()}
            disabled={saving || attempt.busy || !clientId.trim() || (!configured && !secret.trim())}
          >
            {saving ? "Saving setup…" : "Save Antigravity setup"}
          </Button>
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={() => void connect()} disabled={!configured || attempt.busy || saving}>
          {attempt.busy && <LoaderCircleIcon className="mr-2 size-4 animate-spin motion-reduce:animate-none" />}
          {attempt.busy ? "Waiting for Google…" : provider.apiKeySet ? "Reconnect Google" : "Sign in with Google"}
        </Button>
        {attempt.busy && (
          <Button type="button" variant="ghost" size="sm" onClick={attempt.cancel}>
            Cancel
          </Button>
        )}
      </div>
      {attempt.busy && (
        <p role="status" className="text-sm text-muted-foreground">
          Finish in your browser, then return here. This attempt expires after two minutes.
        </p>
      )}
      {attempt.error && (
        <p role="alert" className="text-sm leading-5 text-destructive">
          {attempt.error}
        </p>
      )}
    </div>
  );
}

function ChatGPTConnection({ provider, onConnected, accounts, onSelectAccount }: Props) {
  const attempt = useConnectionAttempt();
  const [notice, setNotice] = useState("");
  const id = useId();
  const connect = () =>
    attempt.run(async (signal) => {
      setNotice("");
      const response = await aiServiceClient.startChatGPTOAuth(create(StartChatGPTOAuthRequestSchema, { providerId: provider.id }), {
        signal,
        timeoutMs: 135000,
      });
      if (signal.aborted) return;
      if (!response.connected) throw new Error("ChatGPT sign-in did not finish. Try again.");
      await onConnected({
        ...provider,
        id: response.providerId,
        title: response.email ? `ChatGPT · ${response.email}` : "ChatGPT",
        apiKey: "",
        apiKeySet: true,
        apiKeyHint: "ChatGPT account",
        oauthAccount: response.email,
        oauthPlanEnabled: response.planUsageEnabled,
      });
      if (!response.planUsageEnabled)
        setNotice("Your account is connected, but ChatGPT plan usage was not enabled. Reconnect and allow plan usage before asking AI.");
    });
  const disconnect = () =>
    attempt.run(async (signal) => {
      const response = await aiServiceClient.disconnectChatGPT(create(DisconnectChatGPTRequestSchema, { providerId: provider.id }), {
        signal,
      });
      if (signal.aborted) return;
      await onConnected({ ...provider, apiKeySet: false, oauthPlanEnabled: false });
      setNotice(
        response.remoteRevocationConfirmed
          ? "Signed out. Your account registration is retained for reconnecting."
          : "Signed out on this device. Remote revocation was not confirmed; disconnect Noter.ai in ChatGPT Settings as well.",
      );
    });
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">Use your ChatGPT plan</p>
        <p className="max-w-prose text-sm leading-5 text-muted-foreground">
          Connect an eligible ChatGPT account and approve plan usage for Noter.ai. API keys use separate OpenAI Platform billing.
        </p>
      </div>
      {accounts && onSelectAccount && accounts.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-account`}>Saved ChatGPT account</Label>
          <select
            id={`${id}-account`}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            value={accounts.some((account) => account.id === provider.id) ? provider.id : ""}
            disabled={attempt.busy}
            onChange={(event) => {
              const selected = accounts.find((account) => account.id === event.target.value);
              if (selected) onSelectAccount(selected);
            }}
          >
            <option value="" disabled>
              New account
            </option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.oauthAccount || account.title} · {account.id.slice(0, 6)}
              </option>
            ))}
          </select>
        </div>
      )}
      {provider.apiKeySet && (
        <p role="status" className="text-sm leading-5">
          {provider.oauthAccount || "ChatGPT account"} ·{" "}
          {provider.oauthPlanEnabled ? "ChatGPT plan usage enabled" : "Plan usage not enabled"}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => void connect()} disabled={attempt.busy}>
          {attempt.busy && <LoaderCircleIcon className="mr-2 size-4 animate-spin motion-reduce:animate-none" />}
          {attempt.busy ? "Waiting for ChatGPT…" : "Continue with ChatGPT"}
        </Button>
        {attempt.busy ? (
          <Button type="button" variant="ghost" size="sm" onClick={attempt.cancel}>
            Cancel
          </Button>
        ) : (
          <>
            {onSelectAccount && ((accounts?.length ?? 0) > 0 || provider.apiKeySet) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  onSelectAccount({
                    id: uuidv4(),
                    title: "ChatGPT",
                    type: InstanceSetting_AIProviderType.CHATGPT,
                    endpoint: "https://api.openai.com/v1",
                    apiKey: "",
                    apiKeySet: false,
                    apiKeyHint: "",
                  })
                }
              >
                Add another account
              </Button>
            )}
            {provider.apiKeySet && (
              <Button type="button" variant="ghost" size="sm" onClick={() => void disconnect()}>
                Sign out
              </Button>
            )}
          </>
        )}
      </div>
      {attempt.busy && (
        <p role="status" className="text-sm leading-5 text-muted-foreground">
          Finish in your browser, then return here. Your current account stays active until verification finishes.
        </p>
      )}
      {attempt.error && (
        <p role="alert" className="text-sm leading-5 text-destructive">
          {attempt.error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm leading-5 text-muted-foreground">
          {notice}
        </p>
      )}
    </div>
  );
}
