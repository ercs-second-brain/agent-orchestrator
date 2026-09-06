import { CheckCircle2, TriangleAlert, XCircle } from "lucide-react";
import type { components } from "../../api/schema";

export type SystemRequirement = components["schemas"]["SystemRequirement"];

// Stagger step between each row's entrance animation (brief: ~120-180ms).
const STAGGER_STEP_MS = 150;

// The backend's stable id -> label for "harness" is "agent harness" (see
// systemcheck.go); the product name for this row is "Coding agent".
export function requirementDisplayLabel(requirement: SystemRequirement): string {
	return requirement.id === "harness" ? "Coding agent" : requirement.label;
}

const MISSING_DETAILS: Record<string, string> = {
	git: "git was not found on PATH.",
	tmux: "tmux was not found on PATH; it is required on macOS/Linux to start sessions.",
	harness: "pi was not found on PATH.",
	gh: "gh was not found on PATH. It lets agent sessions open pull requests and read issues, but AO runs fine without it.",
};

// requirement.detail is backend-authoritative (systemcheck.go) and hardcoded
// English. That's fine when satisfied — it's a resolved path or a
// comma-joined list of installed agent names, not prose.
export function requirementDetailText(requirement: SystemRequirement): string | undefined {
	if (requirement.satisfied) return requirement.detail;
	return MISSING_DETAILS[requirement.id] ?? requirement.detail;
}

/** Checklist of startup requirements, in the backend's stable order. */
export function SystemRequirementsChecklist({
	requirements,
	ready,
}: {
	requirements: SystemRequirement[];
	ready: boolean;
}) {
	return (
		<div
			aria-live="polite"
			className="ao-startup-checklist mt-4 flex w-full max-w-content-max flex-col gap-2 text-left"
			role="status"
		>
			{requirements.map((requirement, index) => (
				<div
					key={requirement.id}
					className="ao-startup-checklist__row flex items-start gap-2"
					style={{ animationDelay: `${index * STAGGER_STEP_MS}ms` }}
				>
					<RequirementGlyph requirement={requirement} />
					<div className="min-w-0">
						<p className="text-control font-medium text-foreground">{requirementDisplayLabel(requirement)}</p>
						{requirementDetailText(requirement) ? (
							<p className="text-caption leading-snug text-muted-foreground">{requirementDetailText(requirement)}</p>
						) : null}
					</div>
				</div>
			))}
			{ready ? (
				<p className="ao-startup-checklist__row mt-0.5 text-caption font-medium text-success">
					{"All checks passed"}
				</p>
			) : null}
		</div>
	);
}

function RequirementGlyph({ requirement }: { requirement: SystemRequirement }) {
	if (requirement.satisfied) {
		return <CheckCircle2 className="mt-0.5 size-icon-base shrink-0 text-success" aria-hidden="true" />;
	}
	if (requirement.required) {
		return <XCircle className="mt-0.5 size-icon-base shrink-0 text-destructive" aria-hidden="true" />;
	}
	return <TriangleAlert className="mt-0.5 size-icon-base shrink-0 text-warning" aria-hidden="true" />;
}
