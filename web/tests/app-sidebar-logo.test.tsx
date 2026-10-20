import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NoterLogo from "@/components/NoterLogo";

const settings = vi.hoisted(() => ({ customProfile: undefined as { title: string; logoUrl: string } | undefined }));
vi.mock("@/contexts/InstanceContext", () => ({ useInstance: () => ({ generalSetting: settings }) }));
beforeEach(() => {
  settings.customProfile = undefined;
});
describe("Noter identity", () => {
  it("uses the new icon and Noter.ai name in compact window chrome", () => {
    const { container } = render(<NoterLogo compact size="header" />);
    expect(screen.getByText("Noter.ai")).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute("src", "/noter-icon-v2.png");
  });
  it("keeps the mark available when the wordmark is collapsed", () => {
    const { container } = render(<NoterLogo compact collapsed />);
    expect(container.querySelector("img")).toBeInTheDocument();
    expect(screen.queryByText("Noter.ai")).not.toBeInTheDocument();
  });
  it("retains a user's custom instance title", () => {
    settings.customProfile = { title: "Team notebook", logoUrl: "" };
    render(<NoterLogo compact />);
    expect(screen.getByText("Team notebook")).toBeInTheDocument();
  });
});
