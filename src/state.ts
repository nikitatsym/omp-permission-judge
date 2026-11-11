import type { JsonValue } from "@oh-my-pi/pi-ai";
import type { SessionEntry } from "@oh-my-pi/pi-coding-agent";
import type { PromptPermissionDetails } from "@gotgenes/pi-permission-system";
import type { JudgeLinkConfig } from "./config";

export type ConversationMessage = {
	role: "user" | "assistant";
	text: string;
};

// Type aliases, not interfaces: JudgmentState needs the implicit index signature only aliases get.
export type JudgeLinkState = {
	ask: JsonValue;
	cwd: string;
	/** Oldest first. */
	conversation: ConversationMessage[];
};

export function buildState(
	details: PromptPermissionDetails,
	branch: readonly SessionEntry[],
	cwd: string,
	config: Pick<JudgeLinkConfig, "contextMessages" | "maxTextChars">,
): JudgeLinkState {
	const max = config.maxTextChars;
	const cap = (text: string) => (text.length > max ? `${text.slice(0, max)}...` : text);
	// The payload is plain data by contract; the round trip caps every string in it.
	const ask = JSON.parse(
		JSON.stringify(details.payload, (_key, value: unknown) => (typeof value === "string" ? cap(value) : value)),
	) as JsonValue;
	return {
		ask,
		cwd,
		conversation: recentMessages(branch, config.contextMessages).map(message => ({
			role: message.role,
			text: cap(message.text),
		})),
	};
}

function recentMessages(branch: readonly SessionEntry[], count: number): ConversationMessage[] {
	if (count === 0) return [];
	const messages: ConversationMessage[] = [];
	for (let index = branch.length - 1; index >= 0 && messages.length < count; index--) {
		const entry = branch[index];
		if (entry.type !== "message") continue;
		const { message } = entry;
		if (message.role !== "user" && message.role !== "assistant") continue;
		const text = messageText(message.content).trim();
		if (text !== "") messages.push({ role: message.role, text });
	}
	return messages.reverse();
}

function messageText(content: string | readonly { type: string; text?: string }[]): string {
	if (typeof content === "string") return content;
	return content.flatMap(block => (block.type === "text" && typeof block.text === "string" ? [block.text] : [])).join("\n");
}
