import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NoterLogo from "@/components/NoterLogo";
import { getProviderTypeLabel } from "@/components/Settings/AISection";
import { getInstanceTitle } from "@/lib/constants";
import { InstanceSetting_AIProviderType } from "@/types/proto/api/instance_service_pb";

vi.mock("@/contexts/InstanceContext", () => ({ useInstance: () => ({ generalSetting: { customProfile: { title: "Memos" } } }) }));

describe("Noter.ai branding", () => {
  it("normalizes legacy defaults and keeps intentional custom instance names", () => {
    for (const title of [undefined, "", "Memo", "Memos", " memos "]) expect(getInstanceTitle(title)).toBe("Noter.ai");
    expect(getInstanceTitle("Team Notes")).toBe("Team Notes");
  });
  it("renders the Noter.ai lockup for an older saved profile", () => {
    render(<NoterLogo compact />);
    expect(screen.getByText("Noter.ai")).toBeInTheDocument();
    expect(screen.queryByText("Memos")).not.toBeInTheDocument();
  });
  it("names AI providers without speech model names", () => {
    expect(getProviderTypeLabel(InstanceSetting_AIProviderType.OPENAI)).toBe("OpenAI");
    expect(getProviderTypeLabel(InstanceSetting_AIProviderType.GROQ)).toBe("Groq");
  });
});
