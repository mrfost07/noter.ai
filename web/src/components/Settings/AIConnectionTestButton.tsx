import { create } from "@bufbuild/protobuf";
import { AlertCircleIcon, CheckCircle2Icon, LoaderCircleIcon, Volume2Icon, ZapIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { aiServiceClient } from "@/connect";
import { cn } from "@/lib/utils";
import { TestAIProviderRequestSchema } from "@/types/proto/api/ai_service_pb";
import { InstanceSetting_AIProviderType } from "@/types/proto/api/instance_service_pb";

import type { LocalAIProvider } from "./aiSettingsState";

interface ConnectionTestButtonProps {
  provider: LocalAIProvider | undefined;
  model: string;
  capability: "LLM" | "STT";
  className?: string;
}

export const ConnectionTestButton = ({ provider, model, capability, className }: ConnectionTestButtonProps) => {
  const [testState, setTestState] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [latency, setLatency] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const testGeneration = useRef(0);
  useEffect(() => {
    testGeneration.current++;
    setTestState("idle");
    setLatency(null);
    setErrorMessage("");
    return () => {
      testGeneration.current++;
    };
  }, [
    provider?.id,
    provider?.type,
    provider?.endpoint,
    provider?.apiKey,
    provider?.apiKeySet,
    provider?.oauthPlanEnabled,
    model,
    capability,
  ]);

  const handleTest = async () => {
    if (!provider) {
      toast.error("Please configure or select a provider first.");
      return;
    }

    const generation = ++testGeneration.current;
    setTestState("testing");
    setErrorMessage("");

    try {
      const resp = await aiServiceClient.testAIProvider(
        create(TestAIProviderRequestSchema, {
          providerId: provider.apiKeySet ? provider.id : "",
          providerType: !provider.apiKeySet ? InstanceSetting_AIProviderType[provider.type] : "",
          endpoint: provider.endpoint,
          apiKey: provider.apiKey,
          model: model.trim(),
          capability,
        }),
      );

      if (generation !== testGeneration.current) return;
      if (resp.success) {
        const ms = Math.max(0, Number(resp.latencyMs) || 0);
        setLatency(ms);
        setTestState("success");
        toast.success(`${capability} connection verified! (${ms}ms)`);
      } else {
        setTestState("error");
        setErrorMessage(resp.message || "Connection failed");
        toast.error(`Connection failed: ${resp.message}`);
      }
    } catch (err) {
      if (generation !== testGeneration.current) return;
      setTestState("error");
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      toast.error(`Test failed: ${msg}`);
    }
  };

  return (
    <div className={cn("flex min-w-0 flex-col items-start gap-2", className)}>
      <Button
        type="button"
        variant={testState === "success" ? "outline" : testState === "error" ? "destructive" : "outline"}
        size="sm"
        disabled={
          !provider ||
          testState === "testing" ||
          ([InstanceSetting_AIProviderType.ANTIGRAVITY, InstanceSetting_AIProviderType.CHATGPT].includes(provider.type) &&
            !provider.apiKeySet) ||
          (provider.type === InstanceSetting_AIProviderType.CHATGPT && (!provider.oauthPlanEnabled || !model))
        }
        onClick={() => void handleTest()}
        className={cn(
          "h-8 px-3 text-xs transition-all",
          testState === "success" && "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
        )}
      >
        {testState === "testing" ? (
          <>
            <LoaderCircleIcon className="size-3.5 mr-1.5 animate-spin" />
            Testing...
          </>
        ) : testState === "success" ? (
          <>
            <CheckCircle2Icon className="size-3.5 mr-1.5 text-emerald-500" />
            Connected ✓ {latency ? `(${latency}ms)` : ""}
          </>
        ) : testState === "error" ? (
          <>
            <AlertCircleIcon className="size-3.5 mr-1.5" />
            Test Failed
          </>
        ) : (
          <>
            {capability === "STT" ? <Volume2Icon className="size-3.5 mr-1.5" /> : <ZapIcon className="size-3.5 mr-1.5" />}
            {capability === "STT" ? "Check audio" : "Check AI"}
          </>
        )}
      </Button>
      {testState === "error" && errorMessage && (
        <span role="alert" className="max-w-prose text-sm leading-5 text-destructive">
          {errorMessage}
        </span>
      )}
    </div>
  );
};
