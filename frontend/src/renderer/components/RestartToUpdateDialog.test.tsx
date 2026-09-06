import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { RestartToUpdateDialog } from "./RestartToUpdateDialog";
import { useUiStore } from "../stores/ui-store";
import { TooltipProvider } from "./ui/tooltip";
import type { UpdateStatus } from "../../main/update-settings";

const { updInstall, updGetStatus, updOnStatus } = vi.hoisted(() => ({
	updInstall: vi.fn(),
	updGetStatus: vi.fn(),
	updOnStatus: vi.fn(),
}));

vi.mock("../lib/bridge", () => ({
	aoBridge: { updates: { getStatus: updGetStatus, install: updInstall, onStatus: updOnStatus } },
}));

function renderDialog(status: UpdateStatus) {
	updGetStatus.mockResolvedValue(status);
	render(
		<TooltipProvider>
			<RestartToUpdateDialog />
		</TooltipProvider>,
	);
}

beforeEach(() => {
	for (const m of [updInstall, updGetStatus, updOnStatus]) m.mockReset();
	updOnStatus.mockReturnValue(() => undefined);
	useUiStore.setState({ updateInstallPromptOpen: false });
});

it("renders nothing at all while closed", () => {
	renderDialog({ state: "downloaded" });
	expect(screen.queryByTestId("restart-to-update-dialog")).toBeNull();
	// Gated before the hooks run, so the status channel is never subscribed.
	expect(updGetStatus).not.toHaveBeenCalled();
	expect(updOnStatus).not.toHaveBeenCalled();
});

it("shows what the build changes", async () => {
	useUiStore.setState({ updateInstallPromptOpen: true });
	renderDialog({
		state: "downloaded",
		version: "0.12.11-nightly.202609021713",
		releaseNotes: "Fixed the re-stage loop\nRebuilt the Updates page",
	});
	expect(await screen.findByText(/Fixed the re-stage loop/)).toBeVisible();
	expect(screen.getByText("Nightly 0.12.11 · Sep 2")).toBeVisible();
});

it("quits only after confirmation", async () => {
	useUiStore.setState({ updateInstallPromptOpen: true });
	renderDialog({ state: "downloaded", version: "1.2.3" });
	await screen.findByTestId("restart-to-update-dialog");

	expect(updInstall).not.toHaveBeenCalled();
	await userEvent.click(screen.getByRole("button", { name: "Restart & install" }));
	expect(updInstall).toHaveBeenCalledTimes(1);
});

it("cancelling never installs", async () => {
	useUiStore.setState({ updateInstallPromptOpen: true });
	renderDialog({ state: "downloaded", version: "1.2.3" });
	await screen.findByTestId("restart-to-update-dialog");
	await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
	expect(updInstall).not.toHaveBeenCalled();
	expect(useUiStore.getState().updateInstallPromptOpen).toBe(false);
});
