import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import type { components } from "../../api/schema";
import { agentModelsQueryOptions, type AgentModelCatalog } from "../hooks/useAgentModelsQuery";
import { agentLabel } from "../lib/agent-label";
import { cn } from "../lib/utils";
import { AgentAvatar } from "./AgentAvatar";
import {
	OptionMenu,
	OptionMenuContent,
	OptionMenuItem,
	OptionMenuSub,
	OptionMenuSubContent,
	OptionMenuSubTrigger,
	OptionMenuTrigger,
} from "./ui/option-menu";


type ReviewerAgentConfig = components["schemas"]["AgentConfig"];

export function reviewerTrustWarning(_harness: string): string | null {
	// pi is the only supported reviewer harness; no experimental trust tiers remain.
	return null;
}

export function ReviewerSelect({
	value,
	onChange,
	onConfigChange,
	model = "",
	mode = "",
	projectId,
	triggerClassName,
	ariaLabel = "Default reviewer agent",
	defaultHarness,
	defaultOptionLabel,
	defaultTriggerLabel,
	agents: _agents,
	showDefaultOption = true,
	contentAlign = "start",
	disabled = false,
}: {
	value: string;
	onChange: (value: string) => void;
	onConfigChange?: (harness: string, config: ReviewerAgentConfig) => void;
	model?: string;
	mode?: string;
	projectId?: string;
	triggerClassName?: string;
	ariaLabel?: string;
	defaultHarness?: string;
	defaultOptionLabel?: string;
	defaultTriggerLabel?: string;
	agents?: unknown;
	showDefaultOption?: boolean;
	contentAlign?: "start" | "end";
	disabled?: boolean;
}) {
	const queryClient = useQueryClient();
	const [menuOpen, setMenuOpen] = useState(false);
	// The daemon's readiness snapshot is the only source of reviewer candidates:
	// against a remote daemon a client-local fallback would offer harnesses the
	// daemon cannot run. Until the snapshot arrives, only the default row shows.
	// pi is the only supported reviewer harness; other stored values resolve to
	// pi (store-and-ignore), so the menu offers exactly one entry.
	const selectableOptions: { id: string; label: string; disabled: boolean; status: string; statusTone: "success" }[] = [];
	const effectiveHarness = value || defaultHarness || "";
	const menuProjectID = projectId ?? "";
	const triggerCatalog = useQuery(agentModelsQueryOptions(effectiveHarness, menuProjectID));

	useEffect(() => {
		if (!menuOpen) return;
		const harnesses = new Set<string>();
		if (defaultHarness) harnesses.add(defaultHarness);
		for (const agent of selectableOptions) {
			harnesses.add(agent.id);
		}
		for (const harness of harnesses) {
			if (!harness) continue;
			void queryClient.prefetchQuery(agentModelsQueryOptions(harness, menuProjectID));
		}
	}, [defaultHarness, menuOpen, menuProjectID, queryClient, selectableOptions]);
	const selectedModelLabel = modelOrModeLabel(triggerCatalog.data, model, mode, "Agent default");
	const triggerLabel = [value ? agentLabel(value) : (defaultTriggerLabel ?? defaultOptionLabel ?? defaultHarness), selectedModelLabel]
		.filter(Boolean)
		.join(" · ");

	return (
		<OptionMenu open={menuOpen} onOpenChange={setMenuOpen}>
			<OptionMenuTrigger
				className={cn(
					"w-auto min-w-0 max-w-full justify-between gap-2 px-2 text-left",
					contentAlign === "end" && "justify-end text-right",
					triggerClassName,
				)}
				aria-label={ariaLabel}
				disabled={disabled}
			>
				<span className="flex min-w-0 items-center gap-2">
					{effectiveHarness ? <AgentAvatar provider={effectiveHarness} className="size-icon-lg shrink-0" /> : null}
					<span className={cn("min-w-0 truncate", contentAlign === "end" && "text-right")}>{triggerLabel}</span>
				</span>
			</OptionMenuTrigger>
			<OptionMenuContent align={contentAlign === "end" ? "end" : "start"} className="reviews-agent-menu-surface w-[18rem]">
				{showDefaultOption && defaultOptionLabel ? (
					<ReviewerHarnessOption
						agent={{ id: "__default__", label: defaultOptionLabel, disabled: false, status: "", statusTone: "success" }}
						currentHarness={value}
						currentModel={model}
						currentMode={mode}
						onSelect={(nextHarness, nextConfig) => {
							setMenuOpen(false);
							onChange(nextHarness);
							onConfigChange?.(nextHarness, nextConfig);
						}}
						projectId={menuProjectID}
						resolvedHarness={defaultHarness}
						persistHarness=""
						closeMenu={() => setMenuOpen(false)}
					/>
				) : null}
				{selectableOptions.map((agent) => (
					<ReviewerHarnessOption
						key={agent.id}
						agent={agent}
						currentHarness={value}
						currentModel={model}
						currentMode={mode}
						onSelect={(nextHarness, nextConfig) => {
							setMenuOpen(false);
							onChange(nextHarness);
							onConfigChange?.(nextHarness, nextConfig);
						}}
						projectId={menuProjectID}
						resolvedHarness={agent.id}
						persistHarness={agent.id}
						closeMenu={() => setMenuOpen(false)}
					/>
				))}
			</OptionMenuContent>
		</OptionMenu>
	);
}

function ReviewerHarnessOption({
	agent,
	currentHarness,
	currentModel,
	currentMode,
	onSelect,
	projectId,
	resolvedHarness,
	persistHarness,
	closeMenu,
}: {
	agent: { id: string; label: string; status: string; statusTone: "success"; disabled: boolean };
	currentHarness: string;
	currentModel: string;
	currentMode: string;
	onSelect: (harness: string, config: ReviewerAgentConfig) => void;
	projectId: string;
	resolvedHarness?: string;
	persistHarness: string;
	closeMenu: () => void;
}) {
	const [open, setOpen] = useState(false);
	const catalogQuery = useQuery({
		...agentModelsQueryOptions(resolvedHarness ?? "", projectId),
		enabled: false,
	});
	const catalog = catalogQuery.data;
	const effectiveCurrentHarness =
		currentHarness || (persistHarness === "" ? (resolvedHarness ?? "") : "");
	const effectivePersistHarness = persistHarness || resolvedHarness || "";
	const isCurrentHarness = effectiveCurrentHarness !== "" && effectiveCurrentHarness === effectivePersistHarness;
	const isCurrentDefaultSelection = isCurrentHarness && currentModel === "" && currentMode === "";
	const selectDefault = () => onSelect(persistHarness, {});

	if (!resolvedHarness) {
		return (
			<OptionMenuItem onSelect={() => onSelect("", {})} active={currentHarness === "" && currentModel === "" && currentMode === ""}>
				<span className="flex min-w-0 items-center justify-between gap-3">
					<span>{agent.label}</span>
					{currentHarness === "" && currentModel === "" && currentMode === "" ? <Check aria-hidden="true" className="size-4" /> : null}
				</span>
			</OptionMenuItem>
		);
	}

	const hasChoices = hasModelChoices(catalog);
	const catalogKnown = catalogQuery.data !== undefined || catalogQuery.isFetched;

	if (catalogKnown && !hasChoices) {
		return (
			<>
				<OptionMenuItem
					onSelect={selectDefault}
					active={isCurrentDefaultSelection}
					className="reviews-agent-menu-item"
					disabled={agent.disabled}
				>
					<span className="flex items-center gap-2">
						<AgentAvatar provider={resolvedHarness} className="size-icon" />
						{agent.label}
						{isCurrentHarness ? <Check className="size-icon" /> : null}
					</span>
				</OptionMenuItem>
			</>
		);
	}

	return (
		<OptionMenuSub open={open} onOpenChange={setOpen}>
			<OptionMenuSubTrigger
				disabled={agent.disabled}
				aria-label={agent.status ? `${agent.label}${agent.status}` : agent.label}
				onClick={(event) => {
					if (!isCurrentHarness) {
						event.preventDefault();
						closeMenu();
						selectDefault();
					}
				}}
			>
				<span className="flex items-center gap-2">
					<AgentAvatar provider={resolvedHarness} className="size-icon" />
					{agent.label}
					{isCurrentHarness ? <Check className="size-icon" /> : null}
				</span>
			</OptionMenuSubTrigger>
			<OptionMenuSubContent className="w-[15rem]">
				<OptionMenuItem
					onSelect={selectDefault}
					active={isCurrentDefaultSelection}
				>
					<span className="flex min-w-0 items-center justify-between gap-3">
						<span>{"Agent default"}</span>
						{isCurrentDefaultSelection ? <Check aria-hidden="true" className="size-4" /> : null}
					</span>
				</OptionMenuItem>
				{!catalogKnown ? (
					<OptionMenuItem disabled>{"\"Loading…\""}</OptionMenuItem>
				) : null}
				{modelOptions(catalog).map((option) => {
					const selected =
						isCurrentHarness &&
						((option.kind === "mode" && currentMode === option.value) ||
							(option.kind === "model" && currentModel === option.value));
					return (
						<OptionMenuItem
							key={`${option.kind}:${option.value}`}
							onSelect={() => onSelect(persistHarness, option.kind === "mode" ? { mode: option.value } : { model: option.value })}
							active={selected}
						>
							<span className="flex min-w-0 items-center justify-between gap-3">
								<span className="min-w-0 truncate">{option.label}</span>
								{selected ? <Check aria-hidden="true" className="size-4" /> : null}
							</span>
						</OptionMenuItem>
					);
				})}
			</OptionMenuSubContent>
		</OptionMenuSub>
	);
}

function hasModelChoices(catalog?: AgentModelCatalog): boolean {
	return modelOptions(catalog).length > 0;
}

function modelOptions(catalog?: AgentModelCatalog): Array<{ kind: "model" | "mode"; label: string; value: string }> {
	if (!catalog) return [];
	if (catalog.selectionMode !== "catalog" && catalog.selectionMode !== "mode" && catalog.selectionMode !== "text") return [];
	return (catalog.models ?? []).map((item) => ({
		kind: catalog.selectionMode === "mode" ? "mode" : "model",
		label: item.label,
		value: item.id,
	}));
}

function modelOrModeLabel(catalog: AgentModelCatalog | undefined, model: string, mode: string, emptyLabel: string): string {
	const value = mode || model;
	if (!value) return emptyLabel;
	const match = catalog?.models?.find((item) => item.id === value);
	return match?.label || value;
}
