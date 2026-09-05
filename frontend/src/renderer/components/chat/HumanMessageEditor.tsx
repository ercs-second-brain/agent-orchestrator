import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ConversationContentSummary } from "../../types/conversation";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { ConversationContentItems } from "./ConversationContentItems";

export interface HumanMessageEditorProps {
	text: string;
	content: ConversationContentSummary[];
	pending: boolean;
	busy: boolean;
	reconstructedContext?: boolean;
	error?: string;
	onDraftChange?: (text: string) => void;
	onCancel: () => void;
	onSend: (text: string) => Promise<unknown> | void;
}

export function HumanMessageEditor({
	text,
	content,
	pending,
	busy,
	reconstructedContext = false,
	error,
	onDraftChange,
	onCancel,
	onSend,
}: HumanMessageEditorProps) {
	const [draft, setDraft] = useState(text);
	const textarea = useRef<HTMLTextAreaElement>(null);
	const reconstructedContextId = useId();
	const sendDisabled = pending || busy || draft.trim().length === 0;
	const busyMessage = busy ? "Stop the current turn before branching" : undefined;

	useEffect(() => {
		const node = textarea.current;
		if (!node) return;
		node.style.height = "0px";
		node.style.height = `${Math.min(node.scrollHeight, 224)}px`;
	}, [draft]);

	function submit() {
		if (sendDisabled) return;
		void Promise.resolve(onSend(draft.trimEnd())).catch(() => {});
	}

	function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key === "Escape") {
			event.preventDefault();
			onCancel();
			return;
		}
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			submit();
		}
	}

	return (
		<div className="cursor-chat-composer relative flex w-full max-w-3xl flex-col gap-1.5 border px-4 py-3">
		<textarea
			ref={textarea}
			value={draft}
			onChange={(event) => {
				setDraft(event.target.value);
				onDraftChange?.(event.target.value);
			}}
			onKeyDown={onKeyDown}
			aria-label={"Edit message"}
			aria-describedby={reconstructedContext ? reconstructedContextId : undefined}
			autoFocus
			rows={2}
			className="chat-composer-scrollbar max-h-56 min-h-[3.25rem] w-full resize-none overflow-y-auto overscroll-contain bg-transparent px-0 py-1 text-sm leading-relaxed text-foreground outline-none"
		/>
		<ConversationContentItems
			content={content}
			ariaLabel={"Preserved message content"}
			imageLabel={"Image"}
			className="mt-2"
		/>
		{reconstructedContext ? (
			<p id={reconstructedContextId} className="px-1.5 text-pretty text-[11px] text-muted-foreground">
				{"Reconstructed context: text messages will be replayed into a new agent session. Tool calls, approvals, and workspace history will not be replayed; current worktree files stay as they are."}
			</p>
		) : null}
		<div className="mt-2 flex min-h-7 items-center justify-end gap-1.5">
			{error ? (
				<span role="alert" className="mr-auto text-[11px] text-destructive">
					{error}
				</span>
			) : busyMessage ? (
				<span className="mr-auto text-[11px] text-muted-foreground">{busyMessage}</span>
			) : null}
			<Tooltip>
				<TooltipTrigger asChild>
					<span className="inline-flex">
						<Button
							type="button"
							size="icon-sm"
							variant="ghost"
							onClick={onCancel}
							disabled={pending}
							aria-label={"Cancel edit"}
							className="size-7"
						>
							<X aria-hidden="true" className="size-3.5" />
						</Button>
					</span>
				</TooltipTrigger>
				<TooltipContent side="bottom">{"Cancel edit"}</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<span className="inline-flex">
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={submit}
							disabled={sendDisabled}
							aria-label={"Send edited message"}
							className={cn(
								"size-7 rounded-full border-transparent",
								sendDisabled
									? "bg-primary text-primary-foreground"
									: "bg-foreground text-background hover:bg-foreground/90 hover:text-background dark:hover:bg-foreground/90 dark:hover:text-background",
							)}
						>
							{pending ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : <ArrowUp aria-hidden="true" className="size-3.5" />}
						</Button>
					</span>
				</TooltipTrigger>
				<TooltipContent side="bottom">{busyMessage ?? "Send edited message (⌘/Ctrl+Enter)"}</TooltipContent>
			</Tooltip>
		</div>
	</div>
	);
}
