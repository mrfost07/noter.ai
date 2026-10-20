import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_ASSISTANT_CONFIG_STORAGE_KEY, loadAIAssistantConfig } from "@/components/Settings/aiSettingsState";

beforeEach(() => window.localStorage.clear());

describe("saved assistant selection", () => {
  it("retains a saved account and custom model without loading the settings UI", () => {
    window.localStorage.setItem(AI_ASSISTANT_CONFIG_STORAGE_KEY, JSON.stringify({ providerId: "account-1", model: "my-custom-model" }));
    expect(loadAIAssistantConfig()).toEqual({ providerId: "account-1", model: "my-custom-model" });
  });

  it.each(["invalid JSON", "null", "[]", '{"providerId":12,"model":false}'])("recovers safely from %s", (value) => {
    window.localStorage.setItem(AI_ASSISTANT_CONFIG_STORAGE_KEY, value);
    expect(loadAIAssistantConfig()).toEqual({ providerId: "", model: "" });
  });

  it("preserves the valid part of an older partial selection and ignores unrelated fields", () => {
    window.localStorage.setItem(AI_ASSISTANT_CONFIG_STORAGE_KEY, JSON.stringify({ model: "saved-model", other: "ignored" }));
    expect(loadAIAssistantConfig()).toEqual({ providerId: "", model: "saved-model" });
  });

  it("allows the notebook to load when browser storage access is denied", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("Storage access denied", "SecurityError");
    });
    expect(loadAIAssistantConfig()).toEqual({ providerId: "", model: "" });
  });
});
