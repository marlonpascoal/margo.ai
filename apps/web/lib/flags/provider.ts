// OpenFeature server provider over our flag tables (04 §6, D34). It holds no rules of its own: every
// evaluation calls public.flag_enabled, the same SQL function the workers call, so TypeScript and Python
// never disagree. No cache, so a change in C20 applies on the next request (C20: within one minute).
import {
  StandardResolutionReasons,
  TypeMismatchError,
  type EvaluationContext,
  type JsonValue,
  type Provider,
  type ResolutionDetails,
} from "@openfeature/server-sdk";
import type { FlagEnv } from "./keys";

/** Evaluates one flag for one account (null: console or system, no account). */
export interface FlagEvaluator {
  enabled(key: string, accountId: string | null, env: FlagEnv): Promise<boolean>;
}

/** The account is the OpenFeature targeting key. */
export const accountContext = (accountId: string | null): EvaluationContext =>
  accountId ? { targetingKey: accountId } : {};

export class MargoFlagProvider implements Provider {
  readonly metadata = { name: "margo-flags" } as const;
  readonly runsOn = "server" as const;

  constructor(
    private evaluator: FlagEvaluator,
    private env: FlagEnv,
  ) {}

  async resolveBooleanEvaluation(flagKey: string, _default: boolean, context: EvaluationContext): Promise<ResolutionDetails<boolean>> {
    const accountId = context.targetingKey || null;
    const value = await this.evaluator.enabled(flagKey, accountId, this.env);
    return { value, reason: accountId ? StandardResolutionReasons.TARGETING_MATCH : StandardResolutionReasons.STATIC };
  }

  // Our flags are on or off only.
  async resolveStringEvaluation(): Promise<ResolutionDetails<string>> {
    throw new TypeMismatchError("margo flags are boolean");
  }
  async resolveNumberEvaluation(): Promise<ResolutionDetails<number>> {
    throw new TypeMismatchError("margo flags are boolean");
  }
  async resolveObjectEvaluation<T extends JsonValue>(): Promise<ResolutionDetails<T>> {
    throw new TypeMismatchError("margo flags are boolean");
  }
}
