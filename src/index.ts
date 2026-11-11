import { join } from "node:path";
import {
	getPermissionsService,
	PERMISSIONS_READY_CHANNEL,
	type PermissionsReadyEvent,
} from "@gotgenes/pi-permission-system";
import { type ExtensionAPI, type ExtensionContext, getAgentDir, settings } from "@oh-my-pi/pi-coding-agent";
import { journalJudgmentUsage, resolveJudge } from "@oh-my-pi/pi-coding-agent/judgment";
import { loadConfig } from "./config";
import { type Authorize, createAuthorize } from "./link";
import { buildState } from "./state";

/** The name to list in pi-permission-system's `authorizerChain`. */
export const LINK_NAME = "judge";
const EXTENSION_ID = "omp-permission-judge";

interface Session {
	ctx: ExtensionContext;
	authorize: Authorize;
	controller: AbortController;
	dispose?: () => void;
}

export default function ompPermissionJudge(pi: ExtensionAPI): void {
	let session: Session | undefined;
	let readySessionId: string | undefined;

	// Throws reach omp's log from the event bus; pi-permission-system then warns that the link is unregistered.
	function register(): void {
		if (session === undefined || session.dispose !== undefined || readySessionId === undefined) return;
		const service = getPermissionsService(readySessionId);
		if (service === undefined) {
			throw new Error(`${EXTENSION_ID}: pi-permission-system announced session ${readySessionId} but published no service`);
		}
		session.dispose = service.registerAuthorizer(LINK_NAME, session.authorize);
	}

	function retire(): void {
		session?.dispose?.();
		session?.controller.abort();
		session = undefined;
	}

	pi.on("session_start", (_event, ctx) => {
		retire();
		const config = loadConfig(join(getAgentDir(), "extensions", EXTENSION_ID, "config.json"));
		const controller = new AbortController();
		const judge = resolveJudge({
			settings,
			registry: ctx.modelRegistry,
			sessionId: ctx.sessionManager.getSessionId(),
			purpose: "permission",
			onUsage: journalJudgmentUsage(ctx.sessionManager),
		});
		session = {
			ctx,
			controller,
			authorize: createAuthorize({
				config,
				judge,
				state: details => buildState(details, ctx.sessionManager.getBranch(), ctx.cwd, config),
				notify: (message, type) => ctx.ui.notify(message, type),
				sessionSignal: controller.signal,
			}),
		};
		register();
	});

	pi.events.on(PERMISSIONS_READY_CHANNEL, data => {
		const { sessionId } = data as PermissionsReadyEvent;
		if (sessionId === null) {
			session?.ctx.ui.notify(`${EXTENSION_ID}: pi-permission-system has no session service here; link "${LINK_NAME}" is not registered`, "warning");
			return;
		}
		readySessionId = sessionId;
		register();
	});

	pi.on("session_shutdown", () => {
		retire();
		readySessionId = undefined;
	});
}
