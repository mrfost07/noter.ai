import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIAssistantForm, ConnectionTestButton, ProviderModelSelector } from "@/components/Settings/AISection";
import { InstanceSetting_AIProviderType } from "@/types/proto/api/instance_service_pb";

const mocks = vi.hoisted(() => ({ fetchModels: vi.fn(), status: vi.fn(), test: vi.fn() }));
vi.mock("@/connect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/connect")>();
  return {
    ...actual,
    aiServiceClient: {
      ...actual.aiServiceClient,
      fetchAvailableModels: mocks.fetchModels,
      getAIConnectionStatus: mocks.status,
      testAIProvider: mocks.test,
    },
  };
});

const provider = (id: string, type: InstanceSetting_AIProviderType) => ({
  id,
  type,
  title: id,
  endpoint: "",
  apiKey: "",
  apiKeySet: true,
  apiKeyHint: "configured",
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.status.mockResolvedValue({ antigravityConfigured: true });
});

describe("AI model settings", () => {
  it("keeps ChatGPT selected when connecting refreshes the saved Google provider", async () => {
    const google = provider("saved-google", InstanceSetting_AIProviderType.ANTIGRAVITY);
    const chatgpt = { ...provider("saved-chatgpt", InstanceSetting_AIProviderType.CHATGPT), oauthPlanEnabled: true };
    const config = { providerId: google.id, model: "saved-google-model" };
    const onSave = vi.fn();
    const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const form = (providers: (typeof google)[]) => (
      <QueryClientProvider client={query}>
        <AIAssistantForm providers={providers} config={config} onSave={onSave} onAntigravityConnected={vi.fn()} />
      </QueryClientProvider>
    );
    const view = render(form([google]));
    fireEvent.click(screen.getByRole("combobox"));
    const chatgptOption = await screen.findByRole("option", { name: /ChatGPT account/ });
    fireEvent.pointerDown(chatgptOption, { pointerType: "mouse" });
    fireEvent.click(chatgptOption);
    expect(await screen.findByRole("button", { name: "Continue with ChatGPT" })).toBeInTheDocument();
    // Account connection refetches settings, producing new objects for existing providers too.
    view.rerender(form([{ ...google }, chatgpt]));
    await waitFor(() => expect(screen.getAllByRole("combobox")[0]).toHaveTextContent("ChatGPT account"));
    expect(screen.getByText(/ChatGPT plan usage enabled/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reconnect Google" })).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    expect(config).toEqual({ providerId: "saved-google", model: "saved-google-model" });
  });

  it("clears a previous provider's successful check when selecting a different connection", async () => {
    mocks.test.mockResolvedValue({ success: true, latencyMs: 10 });
    const view = render(
      <ConnectionTestButton
        provider={provider("google", InstanceSetting_AIProviderType.ANTIGRAVITY)}
        model="google-model"
        capability="LLM"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Check AI" }));
    expect(await screen.findByRole("button", { name: /Connected/ })).toBeInTheDocument();
    view.rerender(
      <ConnectionTestButton provider={provider("other", InstanceSetting_AIProviderType.OPENAI)} model="other-model" capability="LLM" />,
    );
    expect(await screen.findByRole("button", { name: "Check AI" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Connected/ })).not.toBeInTheDocument();
  });

  it("ignores a late connection check after switching models", async () => {
    const pending = Promise.withResolvers<{ success: boolean; latencyMs: number }>();
    mocks.test.mockReturnValue(pending.promise);
    const connection = provider("google", InstanceSetting_AIProviderType.ANTIGRAVITY);
    const view = render(<ConnectionTestButton provider={connection} model="previous-model" capability="LLM" />);
    fireEvent.click(screen.getByRole("button", { name: "Check AI" }));
    view.rerender(<ConnectionTestButton provider={connection} model="new-model" capability="LLM" />);
    await act(async () => pending.resolve({ success: true, latencyMs: 10 }));
    expect(screen.getByRole("button", { name: "Check AI" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Connected/ })).not.toBeInTheDocument();
  });

  it("keeps a saved unlisted model selected after reopening without detection", () => {
    const props = {
      provider: provider("google", InstanceSetting_AIProviderType.ANTIGRAVITY),
      selectedModel: "account-special-model",
      onSelectModel: vi.fn(),
      isSTT: false,
    };
    const first = render(<ProviderModelSelector {...props} />);
    expect(screen.getByRole("button", { name: /account-special-model/ })).toHaveAttribute("aria-pressed", "true");
    first.unmount();
    render(<ProviderModelSelector {...props} />);
    expect(screen.getByRole("button", { name: /account-special-model/ })).toHaveAttribute("aria-pressed", "true");
    expect(mocks.fetchModels).not.toHaveBeenCalled();
    expect(props.onSelectModel).not.toHaveBeenCalled();
  });
  it("does not invent account quota for preset models", () => {
    render(
      <ProviderModelSelector
        provider={provider("google", InstanceSetting_AIProviderType.ANTIGRAVITY)}
        selectedModel="gemini-2.5-flash"
        onSelectModel={vi.fn()}
        isSTT={false}
      />,
    );
    expect(screen.queryByText(/quota remaining/)).not.toBeInTheDocument();
  });

  it("shows quota returned by the selected provider", async () => {
    mocks.fetchModels.mockResolvedValue({ models: [{ id: "live-model", label: "Account model", remainingQuota: 0.5 }] });
    render(
      <ProviderModelSelector
        provider={provider("google", InstanceSetting_AIProviderType.ANTIGRAVITY)}
        selectedModel=""
        onSelectModel={vi.fn()}
        isSTT={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh models" }));
    expect(await screen.findByText("50% quota remaining")).toBeInTheDocument();
  });

  it("ignores a model response from a provider that has since been replaced", async () => {
    const pending = Promise.withResolvers<{ models: { id: string; label: string; remainingQuota: number }[] }>();
    mocks.fetchModels.mockReturnValue(pending.promise);
    const props = { selectedModel: "", onSelectModel: vi.fn(), isSTT: false };
    const view = render(<ProviderModelSelector {...props} provider={provider("google", InstanceSetting_AIProviderType.ANTIGRAVITY)} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh models" }));
    view.rerender(<ProviderModelSelector {...props} provider={provider("local", InstanceSetting_AIProviderType.OLLAMA)} />);
    await act(async () => {
      pending.resolve({ models: [{ id: "old-account-model", label: "Old account model", remainingQuota: 1 }] });
      await pending.promise;
    });
    expect(screen.queryByText("Old account model")).not.toBeInTheDocument();
    expect(props.onSelectModel).not.toHaveBeenCalled();
  });
});
