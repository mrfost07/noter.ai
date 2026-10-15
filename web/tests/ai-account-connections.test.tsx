import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AIAccountConnection from "@/components/Settings/AIAccountConnection";
import { InstanceSetting_AIProviderType } from "@/types/proto/api/instance_service_pb";

const mocks = vi.hoisted(() => ({ status: vi.fn(), setup: vi.fn(), google: vi.fn(), chatgpt: vi.fn(), disconnect: vi.fn() }));
vi.mock("@/connect", () => ({
  aiServiceClient: {
    getAIConnectionStatus: mocks.status,
    configureAntigravityOAuth: mocks.setup,
    startAntigravityOAuth: mocks.google,
    startChatGPTOAuth: mocks.chatgpt,
    disconnectChatGPT: mocks.disconnect,
  },
}));

const provider = (type: InstanceSetting_AIProviderType) => ({
  id: "new-connection",
  type,
  title: "Test connection",
  endpoint: "",
  apiKey: "",
  apiKeySet: false,
  apiKeyHint: "",
});
const renderConnection = (type: InstanceSetting_AIProviderType, onConnected = vi.fn()) => {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onConnected,
    ...render(
      <QueryClientProvider client={query}>
        <AIAccountConnection provider={provider(type)} onConnected={onConnected} />
      </QueryClientProvider>,
    ),
  };
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.status.mockResolvedValue({ antigravityConfigured: false, antigravityClientId: "" });
});

describe("AI account connections", () => {
  it("starts publisher-configured desktop sign-in without asking users for client credentials", async () => {
    mocks.status.mockResolvedValue({ antigravityConfigured: true, antigravityClientId: "publisher.apps.googleusercontent.com" });
    mocks.google.mockResolvedValue({ providerId: "saved-google", connected: true });
    const { onConnected } = renderConnection(InstanceSetting_AIProviderType.ANTIGRAVITY);
    const signIn = await screen.findByRole("button", { name: "Sign in with Google" });
    await waitFor(() => expect(signIn).toBeEnabled());
    expect(screen.getByLabelText("Google OAuth client secret")).not.toBeVisible();
    fireEvent.click(signIn);
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({ apiKeySet: true })));
    expect(mocks.setup).not.toHaveBeenCalled();
  });

  it("guides a fresh installation through application setup before starting Google sign-in", async () => {
    mocks.setup.mockResolvedValue({ antigravityConfigured: true, antigravityClientId: "fixture.apps.googleusercontent.com" });
    mocks.google.mockResolvedValue({ providerId: "saved-google", connected: true });
    const { onConnected } = renderConnection(InstanceSetting_AIProviderType.ANTIGRAVITY);
    expect(await screen.findByText("Application setup is needed before Google sign-in.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Google OAuth client ID"), { target: { value: "fixture.apps.googleusercontent.com" } });
    const secret = screen.getByLabelText("Google OAuth client secret");
    expect(secret).toHaveAttribute("type", "password");
    fireEvent.change(secret, { target: { value: "fixture-private-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Antigravity setup" }));
    await waitFor(() =>
      expect(mocks.setup).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: "fixture.apps.googleusercontent.com", clientSecret: "fixture-private-secret" }),
      ),
    );
    await waitFor(() => expect(secret).toHaveValue(""));
    expect(screen.queryByText("fixture-private-secret")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    await waitFor(() =>
      expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({ id: "saved-google", apiKeySet: true, apiKey: "" })),
    );
  });

  it("keeps failed configuration visible without reporting a successful connection", async () => {
    mocks.setup.mockRejectedValue(new Error("Google client ID needs correction."));
    renderConnection(InstanceSetting_AIProviderType.ANTIGRAVITY);
    await screen.findByText("Application setup is needed before Google sign-in.");
    fireEvent.change(screen.getByLabelText("Google OAuth client ID"), { target: { value: "bad-client" } });
    fireEvent.change(screen.getByLabelText("Google OAuth client secret"), { target: { value: "fixture-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Antigravity setup" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Google client ID needs correction.");
    expect(mocks.google).not.toHaveBeenCalled();
  });

  it("distinguishes ChatGPT account sign-in from permission to use its plan", async () => {
    mocks.chatgpt.mockResolvedValue({ providerId: "saved-chatgpt", connected: true, email: "test@example.com", planUsageEnabled: false });
    const { onConnected } = renderConnection(InstanceSetting_AIProviderType.CHATGPT);
    fireEvent.click(screen.getByRole("button", { name: "Continue with ChatGPT" }));
    expect(await screen.findByText(/account is connected, but ChatGPT plan usage was not enabled/)).toBeInTheDocument();
    expect(onConnected).toHaveBeenCalledWith(
      expect.objectContaining({ id: "saved-chatgpt", oauthPlanEnabled: false, oauthAccount: "test@example.com" }),
    );
  });

  it("cancels a pending sign-in and ignores its late completion", async () => {
    const pending = Promise.withResolvers<{ connected: boolean; providerId: string; email: string; planUsageEnabled: boolean }>();
    mocks.chatgpt.mockReturnValue(pending.promise);
    const { onConnected } = renderConnection(InstanceSetting_AIProviderType.CHATGPT);
    fireEvent.click(screen.getByRole("button", { name: "Continue with ChatGPT" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(mocks.chatgpt.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => pending.resolve({ connected: true, providerId: "late", email: "late@example.com", planUsageEnabled: true }));
    expect(onConnected).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Connection cancelled");
  });

  it("aborts the pending sign-in when leaving settings", () => {
    mocks.chatgpt.mockReturnValue(new Promise(() => {}));
    const view = renderConnection(InstanceSetting_AIProviderType.CHATGPT);
    fireEvent.click(screen.getByRole("button", { name: "Continue with ChatGPT" }));
    const signal = mocks.chatgpt.mock.calls[0][1].signal;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
});
