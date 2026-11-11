import { describe, expect, test } from "bun:test";
import type { AuthorizerLog, PromptPermissionDetails } from "@gotgenes/pi-permission-system";
import type { Judge, JudgmentRequest, JudgmentResult, Questions } from "@oh-my-pi/pi-ai";
import { DEFAULT_CONFIG, type JudgeLinkConfig, type Label } from "../src/config";
import { createAuthorize, DECISION_EVENT, decide } from "../src/link";

const details = {
	requestId: "req-1",
	payload: { request: { value: "git push --force" } },
} as unknown as PromptPermissionDetails;

function answering(probabilities: Record<Label, number>): Pick<Judge, "judge"> {
	return {
		async judge<Q extends Questions>(_request: JudgmentRequest<Q>) {
			return {
				api: "openrouter-decisions",
				provider: "openrouter",
				model: "typesafe/jev-test",
				answers: { verdict: { type: "choice", choice: "allow", probabilities, confidence: 1 } },
				usage: { cost: { total: 0.00002 } },
			} as unknown as JudgmentResult<Q>;
		},
	};
}

/** Never answers; rejects with the abort reason once its signal fires. */
const hanging: Pick<Judge, "judge"> = {
	judge: (_request, options) => {
		const { promise, reject } = Promise.withResolvers<never>();
		options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
		return promise;
	},
};

function harness(judge: Pick<Judge, "judge">, overrides: Partial<JudgeLinkConfig> = {}, sessionSignal = new AbortController().signal) {
	const reviews: [string, Record<string, unknown> | undefined][] = [];
	const notices: [string, string][] = [];
	const log: AuthorizerLog = { review: (event, entry) => reviews.push([event, entry]), debug: () => {} };
	const authorize = createAuthorize({
		config: { ...DEFAULT_CONFIG, ...overrides },
		judge,
		state: () => ({ ask: null, cwd: "/repo", conversation: [] }),
		notify: (message, type) => notices.push([type, message]),
		sessionSignal,
	});
	return { run: () => authorize(details, undefined, log), reviews, notices };
}

describe("decide", () => {
	const thresholds = { allowThreshold: 0.9, denyThreshold: 0.9, onDeny: "deny" } as const;

	test("a probability equal to the threshold meets it", () => {
		expect(decide({ allow: 0.9, deny: 0.05, ask: 0.05 }, thresholds)).toBe("allow");
		expect(decide({ allow: 0.05, deny: 0.9, ask: 0.05 }, thresholds)).toBe("deny");
	});

	test("deny wins when both thresholds are met", () => {
		const low = { allowThreshold: 0.4, denyThreshold: 0.4 };
		expect(decide({ allow: 0.45, deny: 0.45, ask: 0.1 }, { ...low, onDeny: "deny" })).toBe("deny");
		expect(decide({ allow: 0.45, deny: 0.45, ask: 0.1 }, { ...low, onDeny: "confirm" })).toBe("confirm");
	});

	test("below both thresholds defers, however the rest splits", () => {
		expect(decide({ allow: 0.6, deny: 0.3, ask: 0.1 }, thresholds)).toBe("defer");
		expect(decide({ allow: 0.1, deny: 0.2, ask: 0.7 }, thresholds)).toBe("defer");
	});
});

describe("authorize", () => {
	test("allows and records the judgment", async () => {
		const { run, reviews } = harness(answering({ allow: 0.97, deny: 0.01, ask: 0.02 }));
		expect(await run()).toEqual({ kind: "allow" });
		expect(reviews).toHaveLength(1);
		expect(reviews[0][0]).toBe(DECISION_EVENT);
		expect(reviews[0][1]).toMatchObject({ requestId: "req-1", model: "openrouter/typesafe/jev-test", outcome: "allow" });
	});

	test("onDeny deny denies with a reason naming the model and probability", async () => {
		const { run } = harness(answering({ allow: 0.02, deny: 0.95, ask: 0.03 }), { onDeny: "deny" });
		const verdict = await run();
		expect(verdict.kind).toBe("deny");
		expect(verdict.kind === "deny" && verdict.reason).toContain("openrouter/typesafe/jev-test judged this call unsafe (P(deny)=0.95)");
	});

	test("onDeny confirm passes a judged deny on and tells the user", async () => {
		const { run, notices, reviews } = harness(answering({ allow: 0.02, deny: 0.95, ask: 0.03 }), { onDeny: "confirm" });
		expect(await run()).toEqual({ kind: "defer" });
		expect(reviews[0][1]).toMatchObject({ outcome: "confirm" });
		expect(notices).toEqual([
			["warning", "omp-permission-judge: openrouter/typesafe/jev-test flags git push --force (P(deny)=0.95); passed on for confirmation"],
		]);
	});

	test("a failing judge defers, records every failure and warns once", async () => {
		const failing: Pick<Judge, "judge"> = {
			judge: async () => {
				throw new Error("judgment: no judge model available");
			},
		};
		const { run, reviews, notices } = harness(failing);
		expect(await run()).toEqual({ kind: "defer" });
		expect(await run()).toEqual({ kind: "defer" });
		expect(reviews.map(([, entry]) => entry?.error)).toEqual([
			"Error: judgment: no judge model available",
			"Error: judgment: no judge model available",
		]);
		expect(notices).toHaveLength(1);
	});

	test("a judge slower than timeoutMs defers", async () => {
		const { run, reviews } = harness(hanging, { timeoutMs: 20 });
		expect(await run()).toEqual({ kind: "defer" });
		expect(String(reviews[0][1]?.error)).toStartWith("TimeoutError");
	});

	test("ending the session aborts a pending judgment", async () => {
		const session = new AbortController();
		const { run } = harness(hanging, {}, session.signal);
		const pending = run();
		session.abort();
		expect(await pending).toEqual({ kind: "defer" });
	});
});
