import { lazy, Suspense } from "react";
import type { GlobalSettingsSection as GlobalSettingsPage } from "../stores/ui-store";
import { GeneralSettingsSection } from "./settings/GeneralSettingsSection";
import { HarnessSettingsSection } from "./settings/HarnessSettingsSection";
import { ConnectMobileContent } from "./settings/ConnectMobileContent";
import { KeyboardShortcutsContent } from "./settings/KeyboardShortcutsContent";
import { MobileDevicesSection } from "./settings/MobileDevicesSection";
import { ReportProblemContent } from "./settings/ReportProblemContent";
import { SettingsSection } from "./settings/SettingsSection";
import { useRemoteConnection } from "../hooks/useRemoteConnection";

const UpdatesSection = lazy(async () => {
	const module = await import("./settings/UpdatesSection");
	return { default: module.UpdatesSection };
});

export type GlobalSettingsSection = GlobalSettingsPage | "all";

/** Full-width panel for page-level content (forms, editors) — matches the
 *  grouped-row surface so pages read as one coherent family. */
function SettingsContentPanel({ children }: { children: React.ReactNode }) {
	return <div className="rounded-md bg-[var(--color-bg-settings-row)] px-4 py-4">{children}</div>;
}

export function GlobalSettingsForm({
	section = "all",
}: {
	section?: GlobalSettingsSection;
}) {
	const isRemote = useRemoteConnection();
	const all = section === "all";
	// One section per page means the dialog header already names it, so a
	// leading in-page heading would just repeat that title.
	const titleHidden = !all;

	return (
		<div
			aria-label={"Settings"}
			className="flex w-full flex-col gap-(--size-settings-section-gap)"
			data-testid="settings-page"
		>
			{(all || section === "general") && <GeneralSettingsSection titleHidden={titleHidden} />}

			{(all || section === "harness") && !isRemote ? <HarnessSettingsSection titleHidden={titleHidden} /> : null}



			{(all || section === "mobile") && !isRemote ? (
				<SettingsSection title={"Mobile"} titleHidden={titleHidden}>
					<div className="rounded-md bg-[var(--color-bg-settings-row)] px-4 pb-4 pt-0">
						<ConnectMobileContent active />
						<MobileDevicesSection />
					</div>
				</SettingsSection>
			) : null}
			{(all || section === "mobile") && isRemote ? (
				<SettingsSection title={"Mobile"} titleHidden={titleHidden}>
					<p className="rounded-md bg-[var(--color-bg-settings-row)] px-4 py-4 text-sm text-muted-foreground">
						{"Connect Mobile is managed on the LAN server. Run "}
						<code className="font-mono text-xs">ao mobile enable</code>
						{" on that host."}
					</p>
				</SettingsSection>
			) : null}

			{(all || section === "shortcuts") && (
				<SettingsSection title={"Keyboard shortcuts"} titleHidden={titleHidden}>
					<SettingsContentPanel>
						<KeyboardShortcutsContent active />
					</SettingsContentPanel>
				</SettingsSection>
			)}

			{(all || section === "updates") && (
				<Suspense fallback={null}>
					<UpdatesSection titleHidden={titleHidden} />
				</Suspense>
			)}

			{(all || section === "help") && (
				<SettingsSection title={"Report a problem"} titleHidden={titleHidden}>
					<SettingsContentPanel>
						<ReportProblemContent active />
					</SettingsContentPanel>
				</SettingsSection>
			)}
		</div>
	);
}
