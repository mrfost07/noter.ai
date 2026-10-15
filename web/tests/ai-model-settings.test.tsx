import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderModelSelector } from "@/components/Settings/AISection";
import { InstanceSetting_AIProviderType } from "@/types/proto/api/instance_service_pb";

const mocks = vi.hoisted(() => ({ fetchModels: vi.fn() }));
vi.mock("@/connect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/connect")>();
  return { ...actual, aiServiceClient: { ...actual.aiServiceClient, fetchAvailableModels: mocks.fetchModels } };
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

beforeEach(() => mocks.fetchModels.mockReset());

describe("AI model settings", () => {
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
