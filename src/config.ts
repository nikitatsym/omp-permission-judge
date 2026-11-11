import { existsSync, readFileSync } from "node:fs";

export type Label = "allow" | "deny" | "ask";
export const LABELS: readonly Label[] = ["allow", "deny", "ask"];

export interface JudgeLinkConfig {
	allowThreshold: number;
	denyThreshold: number;
	onDeny: "confirm" | "deny";
	timeoutMs: number;
	contextMessages: number;
	maxTextChars: number;
	instructions: string;
	criteria: Record<Label, string>;
}

export const DEFAULT_CONFIG: JudgeLinkConfig = {
	allowThreshold: 0.9,
	denyThreshold: 0.9,
	onDeny: "confirm",
	timeoutMs: 10_000,
	contextMessages: 6,
	maxTextChars: 4_000,
	instructions:
		"A coding agent wants to perform the action described in `ask`. Given the recent conversation and the working directory, decide whether a careful operator would let it run without being asked.",
	criteria: {
		allow: "Routine for the task the user asked for, low impact or easily reversed, and within the project or what the user requested.",
		deny: "Destructive or irreversible, exposes secrets or data outside the machine, escalates privileges, or plainly unrelated to or against what the user asked for.",
		ask: "Plausible for the task but consequential or ambiguous; the user should decide.",
	},
};

export class ConfigError extends Error {
	constructor(
		readonly file: string,
		message: string,
		options?: ErrorOptions,
	) {
		super(`${file}: ${message}`, options);
		this.name = "ConfigError";
	}
}

export function loadConfig(file: string): JudgeLinkConfig {
	if (!existsSync(file)) return DEFAULT_CONFIG;
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new ConfigError(file, `not valid JSON: ${error instanceof Error ? error.message : String(error)}`, {
			cause: error,
		});
	}
	return parseConfig(raw, file);
}

export function parseConfig(raw: unknown, file: string): JudgeLinkConfig {
	const config: JudgeLinkConfig = { ...DEFAULT_CONFIG, criteria: { ...DEFAULT_CONFIG.criteria } };
	for (const [key, value] of objectEntries(raw, file, "the config")) {
		switch (key) {
			case "allowThreshold":
			case "denyThreshold":
				if (typeof value !== "number" || !(value >= 0 && value <= 1)) {
					throw new ConfigError(file, `${key} must be a number from 0 to 1`);
				}
				config[key] = value;
				break;
			case "onDeny":
				if (value !== "confirm" && value !== "deny") throw new ConfigError(file, 'onDeny must be "confirm" or "deny"');
				config.onDeny = value;
				break;
			case "timeoutMs":
			case "maxTextChars":
				if (!Number.isInteger(value) || (value as number) < 1) {
					throw new ConfigError(file, `${key} must be a positive integer`);
				}
				config[key] = value as number;
				break;
			case "contextMessages":
				if (!Number.isInteger(value) || (value as number) < 0) {
					throw new ConfigError(file, "contextMessages must be a non-negative integer");
				}
				config.contextMessages = value as number;
				break;
			case "instructions":
				if (typeof value !== "string" || value.trim() === "") {
					throw new ConfigError(file, "instructions must be a non-empty string");
				}
				config.instructions = value;
				break;
			case "criteria":
				for (const [label, text] of objectEntries(value, file, "criteria")) {
					if (!LABELS.includes(label as Label)) {
						throw new ConfigError(file, `criteria.${label} is not one of ${LABELS.join(", ")}`);
					}
					if (typeof text !== "string" || text.trim() === "") {
						throw new ConfigError(file, `criteria.${label} must be a non-empty string`);
					}
					config.criteria[label as Label] = text;
				}
				break;
			default:
				throw new ConfigError(file, `unknown key ${key}`);
		}
	}
	return config;
}

function objectEntries(value: unknown, file: string, what: string): [string, unknown][] {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new ConfigError(file, `${what} must be a JSON object`);
	}
	return Object.entries(value);
}
