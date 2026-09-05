import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReviewerSelect } from "./ReviewerSelect";

describe("ReviewerSelect", () => {
	it("renders with the single supported harness", () => {
		const onChange = vi.fn();
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(
			<QueryClientProvider client={client}>
				<ReviewerSelect
					value="pi"
					onChange={onChange}
					projectId="proj-1"
					ariaLabel="Default reviewer agent"
				/>
			</QueryClientProvider>,
		);
		expect(screen.getByRole("button", { name: "Default reviewer agent" })).toBeInTheDocument();
	});
});
