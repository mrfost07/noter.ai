import { expect, it } from "vitest";
import Home from "@/pages/Home";
import MemoDetail from "@/pages/MemoDetail";

it("opens note links in the same Noter workspace", () => {
  expect(MemoDetail).toBe(Home);
});
