import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { sessionWorkspaceFileQueryOptions } from "../hooks/useSessionWorkspaceFiles";
import {
	canSplitCompare,
	PanelMessage,
	ReviewDiffBody,
	RetryButton,
	type FileAnnotationModel,
} from "./WorkspaceDiffView";
import { ReadOnlyFileView } from "./ReadOnlyFileView";

export function FileContentPane({
	annotation,
	path,
	sessionId,
	split,
	wrap,
}: {
	annotation: FileAnnotationModel;
	path: string | null;
	sessionId: string;
	split: boolean;
	wrap: boolean;
}) {
	// Mirrors WorkspaceDiffView's own guard: a background refetch mid-selection
	// would re-render the pane out from under an active text selection or its
	// context menu.
	const [selectionOrMenuActive, setSelectionOrMenuActive] = useState(false);
	const query = useQuery({
		...sessionWorkspaceFileQueryOptions(sessionId, path ?? "", "Unable to load workspace file"),
		enabled: Boolean(path) && !selectionOrMenuActive,
	});
	const refetch = query.refetch;

	if (!path) {
		return <PanelMessage>{"Select a file to preview."}</PanelMessage>;
	}
	if (query.isPending) {
		return <PanelMessage>{"Loading diff..."}</PanelMessage>;
	}
	if (query.error) {
		return (
			<PanelMessage action={<RetryButton onClick={() => void refetch()} />}>
				{query.error.message || "Unable to load this file."}
			</PanelMessage>
		);
	}
	if (!query.data) {
		return (
			<PanelMessage action={<RetryButton onClick={() => void refetch()} />}>
				{"Unable to load this file."}
			</PanelMessage>
		);
	}

	const detail = query.data;
	if (detail.status !== "unmodified") {
		return (
			<ReviewDiffBody
				annotation={annotation}
				detail={detail}
				detailLoadedAt={query.dataUpdatedAt}
				emptyFallback={
					!detail.binary && !detail.contentTruncated && !detail.deleted && detail.content ? (
						<ReadOnlyFileView detail={detail} sessionId={sessionId} />
					) : undefined
				}
				filePath={path}
				onActiveSelectionChange={setSelectionOrMenuActive}
				sessionId={sessionId}
				split={split && canSplitCompare(detail.status)}
				wrap={wrap}
			/>
		);
	}
	return <ReadOnlyFileView detail={detail} sessionId={sessionId} />;
}
