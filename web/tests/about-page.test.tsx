import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import About from "@/pages/About";

const mockInstance = {
  profile: {
    version: "26.10.15-rc.1",
    commit: "0123456789abcdef0123456789abcdef01234567",
    instanceUrl: "",
    demo: false,
    admin: undefined as { username: string; displayName: string } | undefined,
  },
  generalSetting: {} as { customProfile?: { title: string; description: string; logoUrl: string } },
};

vi.mock("@/contexts/InstanceContext", () => ({
  useInstance: () => mockInstance,
}));

vi.mock("@/utils/i18n", () => ({
  useTranslate: () => (key: string) =>
    (
      ({
        "common.version": "Version",
        "about.powered-by": "Powered by Noter.ai",
        "about.sponsor": "Support the project",
      }) as Record<string, string>
    )[key] ?? key,
}));

const renderAbout = () => render(<About />);

describe("<About>", () => {
  beforeEach(() => {
    mockInstance.profile = {
      version: "26.10.15-rc.1",
      commit: "0123456789abcdef0123456789abcdef01234567",
      instanceUrl: "https://notes.example.com",
      demo: false,
      admin: { username: "steven", displayName: "Steven" },
    };
    mockInstance.generalSetting = {};
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("renders the identity hero with linked version and commit chips", () => {
    renderAbout();

    expect(screen.getByRole("heading", { name: "Noter.ai" })).toBeInTheDocument();
    expect(screen.getByText(/Your AI meeting notepad/i)).toBeInTheDocument();
    expect(screen.getByText(/A minimalist notepad/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Version\s*26\.10\.15-rc\.1/ })).toHaveAttribute(
      "href",
      "https://github.com/mrfost07/noter.ai/releases/tag/26.10.15-rc.1",
    );
    expect(screen.getByRole("heading", { name: "Noter.ai" }).parentElement).toContainElement(
      screen.getByRole("link", { name: /Version\s*26\.10\.15-rc\.1/ }),
    );
    expect(screen.getByRole("link", { name: "0123456" })).toHaveAttribute(
      "href",
      "https://github.com/mrfost07/noter.ai/commit/0123456789abcdef0123456789abcdef01234567",
    );
    expect(screen.queryByRole("link", { name: "MIT" })).not.toBeInTheDocument();
  });

  it("links to Noter.ai resources and welcomes contributors", () => {
    renderAbout();

    expect(screen.getByRole("link", { name: /about\.official-website/ })).toHaveAttribute("href", "https://github.com/mrfost07/noter.ai");
    expect(screen.getByRole("link", { name: /about\.documents/ })).toHaveAttribute(
      "href",
      "https://github.com/mrfost07/noter.ai/blob/main/README.md",
    );
    expect(screen.getByRole("link", { name: /about\.api-docs/ })).toHaveAttribute(
      "href",
      "https://github.com/mrfost07/noter.ai/tree/main/proto/api",
    );
    expect(screen.getByRole("link", { name: /Contribute to Noter.ai/ })).toHaveAttribute(
      "href",
      "https://github.com/mrfost07/noter.ai/blob/main/CONTRIBUTING.md",
    );
    expect(screen.getByRole("link", { name: /about\.github-repository/ })).toHaveAttribute("href", "https://github.com/mrfost07/noter.ai");
    for (const link of screen.getAllByRole("link")) expect(link.getAttribute("href")).not.toContain("usememos");
  });

  it("does not surface the instance URL, administrator, or birds", () => {
    renderAbout();

    expect(screen.queryByText("https://notes.example.com")).not.toBeInTheDocument();
    expect(screen.queryByText("Administrator")).not.toBeInTheDocument();
    expect(screen.queryByText("Steven")).not.toBeInTheDocument();
    expect(screen.queryByText("Birds")).not.toBeInTheDocument();
    expect(screen.queryByTestId("about-bird-sprite")).not.toBeInTheDocument();
  });

  it("shows a plain version chip and no commit chip on dev builds", () => {
    mockInstance.profile.version = "dev";
    mockInstance.profile.commit = "unknown";

    renderAbout();

    expect(screen.getByText("dev")).toBeInTheDocument();
    expect(screen.queryByText("vdev")).not.toBeInTheDocument();
    expect(screen.queryByText(/unknown/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "about.build" })).not.toBeInTheDocument();
  });

  it("shows the demo badge on demo instances", () => {
    mockInstance.profile.demo = true;

    renderAbout();

    expect(screen.getByText("about.demo")).toBeInTheDocument();
  });

  it("uses custom branding for the identity hero and credits Noter.ai", () => {
    mockInstance.generalSetting = {
      customProfile: { title: "Team Notes", description: "Our shared scratchpad.", logoUrl: "/custom-logo.png" },
    };

    renderAbout();

    expect(screen.getByRole("heading", { name: "Team Notes" })).toBeInTheDocument();
    expect(screen.getByText("Our shared scratchpad.")).toBeInTheDocument();
    expect(screen.queryByText(/Your AI meeting notepad/i)).not.toBeInTheDocument();
    expect(document.querySelector("img")).toHaveAttribute("src", "/custom-logo.png");
    expect(screen.getByText("Powered by Noter.ai")).toBeInTheDocument();
  });

  it("renders as a page without nested mobile padding", () => {
    const { container } = renderAbout();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const contentWrapper = container.querySelector("section > div");
    expect(contentWrapper).toHaveClass("w-full");
    expect(contentWrapper).not.toHaveClass("px-4");
  });
});
