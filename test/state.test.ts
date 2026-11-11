import { describe, expect, test } from "bun:test";
import type { PromptPermissionDetails } from "@gotgenes/pi-permission-system";
import type { SessionEntry } from "@oh-my-pi/pi-coding-agent";
import { buildState } from "../src/state";

const details = {
	requestId: "req-1",
	payload: {
		kind: "bash",
		request: { surface: "bash", toolName: "bash", value: "x".repeat(50), matchedPattern: "*" },
		evidence: [{ label: "command", text: "y".repeat(50), detail: null }],
		annotations: [],
	},
} as unknown as PromptPermissionDetails;

const message = (role: string, content: unknown) => ({ type: "message", message: { role, content } });

const branch = [
	message("user", "first request"),
	message("assistant", [{ type: "text", text: "on it" }]),
	{ type: "model_change" },
	message("user", [
		{ type: "text", text: "now push" },
		{ type: "image", data: "", mimeType: "image/png" },
	]),
	message("assistant", [
		{ type: "thinking", thinking: "should I?" },
		{ type: "toolCall", id: "1", name: "bash", arguments: {} },
	]),
	message("toolResult", [{ type: "text", text: "ok" }]),
	message("assistant", [{ type: "text", text: "pushing now" }]),
] as unknown as SessionEntry[];

describe("buildState", () => {
	test("keeps the last user and assistant texts, oldest first", () => {
		const state = buildState(details, branch, "/repo", { contextMessages: 3, maxTextChars: 100 });
		expect(state.cwd).toBe("/repo");
		expect(state.conversation).toEqual([
			{ role: "assistant", text: "on it" },
			{ role: "user", text: "now push" },
			{ role: "assistant", text: "pushing now" },
		]);
	});

	test("contextMessages 0 sends no conversation", () => {
		expect(buildState(details, branch, "/repo", { contextMessages: 0, maxTextChars: 100 }).conversation).toEqual([]);
	});

	test("maxTextChars caps every string of the ask and the conversation", () => {
		const state = buildState(details, branch, "/repo", { contextMessages: 1, maxTextChars: 8 });
		expect(state.ask).toMatchObject({
			request: { value: "xxxxxxxx...", surface: "bash" },
			evidence: [{ text: "yyyyyyyy..." }],
		});
		expect(state.conversation).toEqual([{ role: "assistant", text: "pushing ..." }]);
	});
});
