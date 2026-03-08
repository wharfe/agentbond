export { AuthService, type AuthServiceOptions } from "./service.js";
export { InMemoryTokenStore, type TokenStore } from "./token-store.js";
export { InMemoryBudgetLedgerStore } from "./ledger.js";
export { evaluate, type EvaluationContext, type EvaluateRequest } from "./evaluator.js";
export { issueToken, type IssueTokenParams, type IssuerDeps } from "./issuer.js";
export { matchesScope, isScopeSubset, globMatch } from "./scope.js";
export {
  validateEvaluateActionInput,
  type ValidationError,
  type EvaluateActionInput,
} from "./validator.js";
