// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { NavRail } from "./NavRail.js";

afterEach(cleanup);

describe("NavRail", () => {
  it("lists every module and marks unavailable ones", () => {
    render(<NavRail active="command-deck" onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /command deck/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /settings/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /assay/i })).toBeEnabled(); // built in Phase 2
    expect(screen.getByRole("button", { name: /manifest/i })).toBeEnabled(); // built in Phase 3
    // An unbuilt module is present but shows its arrival phase and is not a dead link.
    const veinFinder = screen.getByRole("button", { name: /vein finder/i });
    expect(veinFinder).toHaveTextContent(/phase 4/i);
  });

  it("selects an available module on click", async () => {
    const onSelect = vi.fn();
    render(<NavRail active="command-deck" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /settings/i }));
    expect(onSelect).toHaveBeenCalledWith("settings");
  });

  it("does not navigate for an unavailable module (no dead link)", async () => {
    const onSelect = vi.fn();
    render(<NavRail active="command-deck" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /vein finder/i }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("marks the active module with aria-current", () => {
    render(<NavRail active="settings" onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /settings/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
