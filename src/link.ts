import type { AuthorizerLog, AuthorizerVerdict, PromptPermissionDetails } from "@gotgenes/pi-permission-system";
import type { ChoiceQuestion, Judge, JudgmentResult } from "@oh-my-pi/pi-ai";
import type { JudgeLinkConfig, Label } from "./config";
import type { JudgeLinkState } from "./state";

export const DECISION_EVENT = "permission_judge.decision";

/** `confirm` is a judged deny passed on under `onDeny: "confirm"`; `defer` is a judgment that met no threshold. */
export type Outcome = "allow" | "deny" | "confirm" | "defer";

export function decide(
	probabilities: Record<Label, number>,
	config: Pick<JudgeLinkConfig, "allowThreshold" | "denyThreshold" | "onDeny">,
): Outcome {
	if (probabilities.deny >= config.denyThreshold) return config.onDeny === "deny" ? "deny" : "confirm";
	if (probabilities.allow >= config.allowThreshold) return "allow";
	return "defer";
}

export function recordJudgeFailure(log: AuthorizerLog, requestId: string, startedAt: number, error: unknown): void {
	const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	log.review(DECISION_EVENT, { requestId, outcome: "defer", error: message, durationMs: Date.now() - startedAt });
}

export interface JudgeLinkDeps {
	config: JudgeLinkConfig;
	judge: Pick<Judge, "judge">;
	state(details: PromptPermissionDetails): JudgeLinkState;
	notify(message: string, type: "info" | "warning" | "error"): void;
	/** Aborted when the session ends. */
	sessionSignal: AbortSignal;
}

export type Authorize = (
	details: PromptPermissionDetails,
	query: unknown,
	log: AuthorizerLog,
) => Promise<AuthorizerVerdict>;

export function createAuthorize(deps: JudgeLinkDeps): Authorize {
	const { config } = deps;
	const question: ChoiceQuestion<Label> = {
		type: "choice",
		instructions: config.instructions,
		criteria: config.criteria,
	};
	let failureNotified = false;
	return async (details, _query, log) => {
		const startedAt = Date.now();
		const signal = AbortSignal.any([deps.sessionSignal, AbortSignal.timeout(config.timeoutMs)]);
		let result: JudgmentResult<{ verdict: ChoiceQuestion<Label> }>;
		try {
			result = await deps.judge.judge({ state: deps.state(details), questions: { verdict: question } }, { signal });
		} catch (error) {
			// A link must answer: deferring hands the ask to the next link or the user.
			recordJudgeFailure(log, details.requestId, startedAt, error);
			if (!failureNotified) {
				failureNotified = true;
				deps.notify("omp-permission-judge: the judge failed, asks go on unjudged; the permission review log has the error", "warning");
			}
			return { kind: "defer" };
		}
		const { probabilities } = result.answers.verdict;
		const outcome = decide(probabilities, config);
		const model = `${result.provider}/${result.model}`;
		log.review(DECISION_EVENT, {
			requestId: details.requestId,
			model,
			probabilities,
			outcome,
			durationMs: Date.now() - startedAt,
			cost: result.usage.cost.total,
		});
		const pDeny = probabilities.deny.toFixed(2);
		switch (outcome) {
			case "allow":
				return { kind: "allow" };
			case "deny":
				return {
					kind: "deny",
					reason: `${model} judged this call unsafe (P(deny)=${pDeny}). Unsafe means: ${config.criteria.deny}`,
				};
			case "confirm":
				deps.notify(
					`omp-permission-judge: ${model} flags ${details.payload.request.value} (P(deny)=${pDeny}); passed on for confirmation`,
					"warning",
				);
				return { kind: "defer" };
			case "defer":
				return { kind: "defer" };
		}
	};
}
