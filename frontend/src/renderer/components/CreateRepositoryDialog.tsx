import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export type CreateRepositoryDetails = {
	name: string;
	private: boolean;
};

const REPOSITORY_SEGMENT = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,99}$/;

export function isCreateRepositoryName(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed) return false;
	const parts = trimmed.split("/");
	if (parts.length > 2) return false;
	return parts.every((part) => part !== "." && part !== ".." && REPOSITORY_SEGMENT.test(part));
}

export default function CreateRepositoryDialog({
	disabled,
	error,
	onBack,
	onChange,
	onClose,
	onContinue,
	open,
	value,
}: {
	disabled: boolean;
	error: string | null;
	onBack: () => void;
	onChange: (value: CreateRepositoryDetails) => void;
	onClose: () => void;
	onContinue: (value: CreateRepositoryDetails) => void;
	open: boolean;
	value: CreateRepositoryDetails;
}) {
	const [submitted, setSubmitted] = useState(false);
	const nameError = submitted && !isCreateRepositoryName(value.name) ? "Enter a repository name using letters, numbers, dots, hyphens, or underscores. An owner/name pair is also allowed." : null;

	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setSubmitted(true);
		const name = value.name.trim();
		if (!isCreateRepositoryName(name) || disabled) return;
		onContinue({ name, private: value.private });
	};

	return (
		<Dialog.Root open={open} onOpenChange={(next) => !next && !disabled && onClose()}>
			<Dialog.Portal>
				<Dialog.Content className="fixed left-1/2 top-1/2 z-overlay flex max-h-[min(640px,calc(100svh-24px))] w-[min(560px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-xl data-[state=open]:animate-modal-in data-[state=closed]:animate-modal-out motion-reduce:animate-none">
					<div className="relative flex shrink-0 items-center gap-3 px-4 pt-3">
						<Button
							type="button"
							variant="outline"
							size="icon"
							aria-label={"Back to code source"}
							disabled={disabled}
							onClick={onBack}
						>
							<ChevronLeft className="size-4" aria-hidden="true" />
						</Button>
						<div className="min-w-0 flex-1 pr-8">
							<Dialog.Title className="text-balance text-[18px] font-semibold text-[var(--color-text-import-title)]">
								{"Create a Git repository"}
							</Dialog.Title>
							<Dialog.Description className="sr-only">{"Name the repository. AO creates it on GitHub and checks it out on the connected server."}</Dialog.Description>
						</div>
						<button
							type="button"
							className="settings-close-button"
							aria-label={"Close create repository dialog"}
							disabled={disabled}
							onClick={onClose}
						>
							<X className="size-4" aria-hidden="true" />
						</button>
					</div>

					<form className="min-h-0 overflow-y-auto" onSubmit={submit}>
						<div className="space-y-4 px-4 pb-1 pt-4">
							{error ? (
								<div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-pretty text-[12px] leading-5 text-destructive" role="alert">
									{error}
								</div>
							) : null}

							<div className="space-y-2">
								<Label htmlFor="createRepositoryName" className="text-[13px] font-semibold text-[var(--color-text-import-title)]">
									{"Repository name"}
								</Label>
								<Input
									id="createRepositoryName"
									autoFocus
									autoCapitalize="none"
									autoComplete="off"
									aria-describedby={nameError ? "createRepositoryNameError" : "createRepositoryNameHelp"}
									aria-invalid={nameError ? true : undefined}
									className="bg-[var(--color-bg-import-card)] font-mono text-[13px]"
									disabled={disabled}
									placeholder={"my-project"}
									spellCheck={false}
									value={value.name}
									onChange={(event) => onChange({ ...value, name: event.target.value })}
								/>
								{nameError ? (
									<p id="createRepositoryNameError" className="text-pretty text-[12px] leading-5 text-destructive" role="alert">
										{nameError}
									</p>
								) : (
									<p id="createRepositoryNameHelp" className="text-pretty text-[12px] leading-5 text-muted-foreground">
										{"Created under your signed-in GitHub account. Use owner/name to put it in an organization."}
									</p>
								)}
							</div>

							<label className="flex items-center gap-2.5 text-[13px] text-foreground">
								<input
									type="checkbox"
									className="size-icon-base accent-accent"
									checked={value.private}
									disabled={disabled}
									onChange={(event) => onChange({ ...value, private: event.target.checked })}
								/>
								{"Create as a private repository"}
							</label>
						</div>

						<div className="flex justify-end gap-2 px-4 py-3">
							<Button type="submit" disabled={disabled}>
								{"Continue"}
							</Button>
						</div>
					</form>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
