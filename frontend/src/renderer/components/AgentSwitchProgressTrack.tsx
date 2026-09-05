import { useTranslation } from "react-i18next";
import type { AgentSwitchPresentation } from "../lib/agent-switch-presentation";
import { cn } from "../lib/utils";

const agentSwitchProgressSteps = [
	{ key: "preparing", labelKey: "Preparing handoff" },
	{ key: "stopping_source", labelKey: "Stopping source agent" },
	{ key: "starting_target", labelKey: "Starting target agent" },
	{ key: "confirming_takeover", labelKey: "Delivering context" },
] as const;

export function AgentSwitchProgressTrack({ stage }: { stage: AgentSwitchPresentation["stage"] }) {
	const activeIndex = agentSwitchProgressSteps.findIndex((step) => step.key === stage);
	return (
		<ol
			className="agent-switch-progress-track mt-2.5 flex w-full items-start"
			aria-label={"Switching…"}
		>
			{agentSwitchProgressSteps.map((step, index) => (
				<li
					key={step.key}
					aria-current={index === activeIndex ? "step" : undefined}
					className={cn(
						"agent-switch-progress-step relative flex min-w-0 flex-1 flex-col items-center gap-1.5 px-0.5 text-[10px] leading-3 text-passive",
						index < activeIndex && "is-complete text-muted-foreground",
						index === activeIndex && "is-current text-foreground",
					)}
				>
					<span
						aria-hidden="true"
						className="agent-switch-progress-dot relative z-10 size-2 rounded-full border border-border-strong bg-surface"
					/>
					<span className="min-h-6 max-w-16 break-words whitespace-normal text-balance text-center">
						{step.labelKey}
					</span>
				</li>
			))}
		</ol>
	);
}
