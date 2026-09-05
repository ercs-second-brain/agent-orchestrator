import { describe, expect, it } from "vitest";
import { isCreateRepositoryName } from "./CreateRepositoryDialog";

describe("isCreateRepositoryName", () => {
	it("accepts a simple name or owner/name", () => {
		expect(isCreateRepositoryName("my-app")).toBe(true);
		expect(isCreateRepositoryName("acme/widgets")).toBe(true);
	});

	it("rejects empty or path-like names", () => {
		expect(isCreateRepositoryName("")).toBe(false);
		expect(isCreateRepositoryName("..")).toBe(false);
		expect(isCreateRepositoryName("../etc")).toBe(false);
		expect(isCreateRepositoryName("a/b/c")).toBe(false);
	});
});
