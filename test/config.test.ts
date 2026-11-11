import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, DEFAULT_CONFIG, loadConfig, parseConfig } from "../src/config";

const FILE = "config.json";

describe("loadConfig", () => {
	let dir: string | undefined;
	afterEach(() => {
		if (dir !== undefined) rmSync(dir, { recursive: true });
		dir = undefined;
	});

	test("a missing file means the defaults", () => {
		dir = mkdtempSync(join(tmpdir(), "judge-config-"));
		expect(loadConfig(join(dir, FILE))).toEqual(DEFAULT_CONFIG);
	});

	test("malformed JSON fails naming the file", () => {
		dir = mkdtempSync(join(tmpdir(), "judge-config-"));
		const file = join(dir, FILE);
		writeFileSync(file, "{ allowThreshold: 0.8 }");
		expect(() => loadConfig(file)).toThrow(`${file}: not valid JSON`);
	});
});

describe("parseConfig", () => {
	test("given keys override the defaults, criteria label by label", () => {
		const config = parseConfig({ allowThreshold: 0.95, onDeny: "deny", criteria: { deny: "Touches production" } }, FILE);
		expect(config.allowThreshold).toBe(0.95);
		expect(config.onDeny).toBe("deny");
		expect(config.denyThreshold).toBe(DEFAULT_CONFIG.denyThreshold);
		expect(config.criteria).toEqual({ ...DEFAULT_CONFIG.criteria, deny: "Touches production" });
	});

	test("thresholds accept the closed range 0..1 only", () => {
		expect(parseConfig({ allowThreshold: 0, denyThreshold: 1 }, FILE)).toMatchObject({
			allowThreshold: 0,
			denyThreshold: 1,
		});
		expect(() => parseConfig({ denyThreshold: 1.01 }, FILE)).toThrow(ConfigError);
		expect(() => parseConfig({ allowThreshold: "0.9" }, FILE)).toThrow("allowThreshold must be a number from 0 to 1");
	});

	test.each([
		[{ unknown: 1 }, "unknown key unknown"],
		[{ onDeny: "ask" }, 'onDeny must be "confirm" or "deny"'],
		[{ timeoutMs: 0 }, "timeoutMs must be a positive integer"],
		[{ maxTextChars: 1.5 }, "maxTextChars must be a positive integer"],
		[{ contextMessages: -1 }, "contextMessages must be a non-negative integer"],
		[{ instructions: " " }, "instructions must be a non-empty string"],
		[{ criteria: { maybe: "x" } }, "criteria.maybe is not one of allow, deny, ask"],
		[{ criteria: { allow: "" } }, "criteria.allow must be a non-empty string"],
		[{ criteria: ["allow"] }, "criteria must be a JSON object"],
		[[], "the config must be a JSON object"],
	])("rejects %j", (raw, message) => {
		expect(() => parseConfig(raw, FILE)).toThrow(`${FILE}: ${message}`);
	});
});
