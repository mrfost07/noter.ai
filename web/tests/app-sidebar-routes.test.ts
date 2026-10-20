import { describe, expect, it } from "vitest";
import { getRouteActionPolicy, getSidebarRouteKind } from "@/components/AppSidebar/routes";

describe("Noter routes", () => {
  it.each([
    ["/", "home"],
    ["/archived", "archived"],
    ["/ARCHIVED/", "archived"],
    ["/attachments", "attachments"],
    ["/setting", "settings"],
    ["/memos/one", "memo"],
    ["/calendar", "common"],
    ["/map", "common"],
    ["/explore", "common"],
    ["/spaces/team", "common"],
  ])("classifies %s as %s", (path, kind) => expect(getSidebarRouteKind(path)).toBe(kind));
  it("keeps search in the notes collection", () => expect(getRouteActionPolicy("/")).toEqual({ searchScope: "route-collection" }));
  it("keeps archive search in the owner's notes", () =>
    expect(getRouteActionPolicy("/archived")).toEqual({ searchScope: "user-collection" }));
  it("sends attachment search to notes", () =>
    expect(getRouteActionPolicy("/attachments")).toEqual({ searchScope: "route-collection", searchDestination: "/" }));
  it("sends other search to the note workspace", () =>
    expect(getRouteActionPolicy("/setting")).toEqual({ searchScope: "all", searchDestination: "/" }));
});
