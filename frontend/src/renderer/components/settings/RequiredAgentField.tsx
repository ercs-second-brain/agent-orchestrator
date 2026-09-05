import { memo } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { AgentAvatar } from "../AgentAvatar";
import { SettingsRow } from "./SettingsRow";
import { SettingsOptionMenu } from "./SettingsOptionMenu";

// ADR 0005: pi is the single supported harness. The former multi-agent picker
// sheet collapses to a fixed pi value; the fields below remain so existing
// settings/composer call sites keep rendering one immutable agent option.
const SINGLE_AGENT = { id: "pi", label: "pi", value: "pi", disabled: false };

export const RequiredAgentField = memo(function RequiredAgentField({
	disabled = false,
	hint,
	icon,
	id,
	invalid = false,
	label,
	onChange,
	placeholder,
	triggerClassName,
	labelClassName,
	value,
	variant = "stacked",
}: {
	onConfigChange?: (harness: string, config: unknown) => void;
	agents?: unknown;
	excludedHarness?: string;
	showDefaultOption?: boolean;
	defaultHarness?: string;
	defaultOptionLabel?: string;
	defaultTriggerLabel?: string;
	projectId?: string;
	model?: string;
	mode?: string;
	disabled?: boolean;
	hint?: string;
	icon?: LucideIcon;
	id: string;
	invalid?: boolean;
	label: string;
	onChange: (value: string) => void;
	placeholder: string;
	triggerClassName?: string;
	labelClassName?: string;
	contentClassName?: string;
	value: string;
	variant?: "stacked" | "settings-row" | "chip";
}) {
	void onChange;
	const locked = disabled || true;
	if (variant === "settings-row") {
		return (
			<SettingsRow icon={icon} label={label}>
				<SettingsOptionMenu
					aria-label={label}
					value="pi"
					placeholder={placeholder}
					options={[SINGLE_AGENT]}
					disabled={locked}
					onChange={() => undefined}
					triggerClassName={invalid ? "text-error" : undefined}
					menuClassName="settings-agent-menu-surface"
					menuItemClassName="settings-agent-menu-item"
					renderTrigger={(selected, triggerPlaceholder) => (
						<>
							<AgentAvatar provider="pi" className="size-icon-lg" />
							<span className="min-w-0 truncate">{selected?.label ?? triggerPlaceholder}</span>
						</>
					)}
				/>
			</SettingsRow>
		);
	}
	return (
		<div className={cn("flex flex-col gap-1.5", labelClassName)} data-agent-field={id}>
			<button
				type="button"
				aria-label={label}
				disabled
				className={cn(
					"flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm",
					invalid && "border-error",
					triggerClassName,
				)}
			>
				<AgentAvatar provider="pi" className="size-icon" />
				{"pi"}
			</button>
			{hint ? <span className="text-xs text-passive">{hint}</span> : null}
			{value ? null : null}
		</div>
	);
});
