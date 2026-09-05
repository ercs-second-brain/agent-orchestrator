import { ChevronDown, UserRound } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { BrowserProfileViewState } from "../../shared/browser-profiles";
import { useUiStore } from "../stores/ui-store";
import { Button } from "./ui/button";

export function BrowserProfileButton({
	viewId,
	profileState,
}: {
	viewId: string;
	profileState: BrowserProfileViewState;
}) {
	const buttonRef = useRef<HTMLButtonElement>(null);
	const openGlobalSettings = useUiStore((state) => state.openGlobalSettings);
	const label = profileState.profileName ?? "Temporary";

	useEffect(() => {
		return window.ao?.browser.onProfileManage((managedViewId) => {
			if (managedViewId === viewId) openGlobalSettings("browserProfiles");
		});
	}, [openGlobalSettings, viewId]);

	const openMenu = () => {
		if (!viewId || !window.ao?.browser) return;
		const rect = buttonRef.current?.getBoundingClientRect();
		if (!rect) return;
		void window.ao.browser
			.showProfileMenu({
				viewId,
				bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
				labels: {
					temporary: "Temporary",
					manage: "Manage browser profiles",
					switchTitle: "Switch browser profile?",
					switchMessage: "Switching profiles will reload the browser pages.",
					switchDetail: "Unsaved page state may be lost.",
					cancel: "No",
					confirm: "Yes",
				},
			})
			.catch(() => undefined);
	};

	return (
		<Button
			aria-haspopup="menu"
			aria-label={`Browser profile: ${label}`}
			className="browser-profile-button max-w-36 min-w-0 gap-1 px-1.5 text-xs"
			onClick={openMenu}
			ref={buttonRef}
			size="sm"
			title={label}
			type="button"
			variant="ghost"
		>
			<UserRound aria-hidden="true" className="size-3.5 shrink-0" />
			<span className="browser-profile-button__label truncate">{label}</span>
			<ChevronDown aria-hidden="true" className="browser-profile-button__chevron size-3 shrink-0 opacity-60" />
		</Button>
	);
}
