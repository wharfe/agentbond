# agentbond — Authorization Specification

version: 0.3.0-draft  
status: pre-implementation  
scope: @agentbond/core + @agentbond/auth (MVP)

---

## 概要

このドキュメントは `@agentbond/auth` の判定ロジック仕様を定義する。  
実装はこのドキュメントを唯一の仕様源（single source of truth）として参照すること。

---

## 0. 入力バリデーション

認可判定エンジンに入る前に、API層で入力を検証する。  
判定ロジックとバリデーションは責務を分離し、実装上も別モジュールとする。

### 検証項目

| 対象 | ルール |
|---|---|
| 必須フィールド | `tokenId`, `action.id`, `action.actor.id`, `action.scope.domain`, `action.scope.operations` が存在すること |
| `operations` | 空配列不可 |
| `timestamp` | RFC 3339 形式の文字列であること |
| `amount`（消費記録時） | 正の整数文字列のみ。`"0"`, 負値, 浮動小数点文字列は不正 |
| `expiry` | RFC 3339 形式の文字列であること |

### バリデーション失敗時のレスポンス

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_INPUT",
    "message": "Missing required field: tokenId",
    "retryable": false
  }
}
```

バリデーション失敗は `AuthorizationDecision` ではなく、この形式で返す。  
`INVALID_INPUT` は業務エラーではなく入力不正として扱う。

---

## 1. Scope Matching Rules

### 1.1 基本ルール

| 要素 | マッチング方式 |
|---|---|
| `domain` | 完全一致のみ（prefix・ワイルドカード不可） |
| `operations` | 完全一致のみ（配列内のいずれかと一致） |
| `resources` | glob記法のみ（正規表現不可） |
| `scope` 配列 | OR評価（複数scopeのうち1つでもマッチで通過） |
| 大文字小文字 | 区別する（case-sensitive） |

### 1.2 domain の例

```
トークンの scope.domain: "api.stripe.com"

ALLOW: domain = "api.stripe.com"
DENY:  domain = "stripe.com"
DENY:  domain = "api.stripe.com/v1"
DENY:  domain = "API.STRIPE.COM"
```

### 1.3 resources の glob ルール

- `*` は単一パスセグメント内の任意文字列にマッチ（`/` を超えない）
- `**` は複数セグメントにマッチ
- `resources` が `undefined` の場合は「リソース非依存アクション」または「明示的な全リソース許可」を意味する

> **注意:** `resources: undefined` は `write` / `charge` などの破壊的操作では広域権限になりやすい。  
> 最小権限原則に従い、できるだけ明示的な `resources` 指定を推奨する。

```
scope.resources: ["/invoices/*"]
ALLOW: "/invoices/123"
DENY:  "/invoices/123/items"   ← / を超えるため

scope.resources: ["/invoices/**"]
ALLOW: "/invoices/123"
ALLOW: "/invoices/123/items"
DENY:  "/payments/123"

scope.resources: undefined
ALLOW: 任意のリソース
```

---

## 2. Delegation Rules（委譲制約）

### 2.1 基本原則

> 子は親より広い権限を持てない（least privilege 継承）

### 2.2 制約の詳細

| 要素 | 制約 |
|---|---|
| `scopes` | 子の scopes は親の scopes のサブセットのみ |
| `budget.limit` | 子の limit は親の残高（limit - spent）以下のみ |
| `expiry` | 子の expiry は親の expiry 以前のみ |
| 委譲の深さ | MVP では制限なし（将来 `maxDepth` オプションで制御予定） |

### 2.3 scope のサブセット判定（MVP簡略ルール）

MVP では glob パターン同士の数学的包含判定は行わない。  
以下の単純ルールのみを適用する。

1. 子の `domain` が親のいずれかの scope の `domain` と完全一致すること
2. 子の `operations` が親の対応する scope の `operations` のサブセットであること
3. 子の `resources` については以下のいずれかのみ許可する
   - 親の `resources` の要素をそのまま引き継ぐ（同一パターン）
   - 親の `resources` パターンに**実際にマッチする**具体的な固定文字列

> glob パターンを新たに定義した子 `resources`（再パターン化）は MVP では禁止。  
> 例: 親が `/invoices/*` のとき、子に `/invoices/**` は不可。`/invoices/123` は可。

```
親 scope: { domain: "api.stripe.com", operations: ["read", "write"] }

ALLOW 子: { domain: "api.stripe.com", operations: ["read"] }
DENY  子: { domain: "api.stripe.com", operations: ["read", "charge"] }
DENY  子: { domain: "api.paypal.com", operations: ["read"] }
```

### 2.4 parentTokenId

```typescript
interface AuthorizationToken {
  id: string
  parentTokenId?: string   // ルートトークンの場合は undefined
  // ...
}
```

委任チェーンはトークンのリンクリストとして表現される。  
`parentTokenId` を辿ることで委任経路を復元できる。

### 2.5 ルートトークンの発行主体

- ルートトークン（`parentTokenId: undefined`）の発行は **アプリケーション責務** とする
- `@agentbond/auth` はルートトークンの正当性（誰が発行したか）を検証しない
- 発行 API を呼べる主体の認証・認可は、`@agentbond/auth` のスコープ外

---

## 3. Cascade Revocation（連鎖失効）

### 3.1 方針: 評価時参照（evaluation-time reference）

子トークン自身の `status` は変更しない。  
判定時に親チェーンを参照し、親が inactive であれば `PARENT_TOKEN_INACTIVE` として deny する。

**採用理由:**
- 連鎖更新処理が不要でシンプル
- 子自身の状態と親由来の状態が混在しない
- 復活ロジックが不要（親が active に戻れば自動的に再評価される）
- 監査ログが明確（子が deny された理由が親の状態として記録される）

### 3.2 判定時の親チェーン評価ルール

| 親の状態 | 子の判定結果 |
|---|---|
| `revoked` | `PARENT_TOKEN_INACTIVE` で deny |
| `suspended` | `PARENT_TOKEN_INACTIVE` で deny |
| `expired` | `PARENT_TOKEN_INACTIVE` で deny |
| `active` | 親チェーンの評価を通過（次の判定へ） |

親チェーンは `parentTokenId` を辿って再帰的に評価する。  
チェーン上のいずれかの親が inactive であれば deny。

---

## 4. 判定評価順序

### Step 0: 入力バリデーション（Section 0 参照）
→ 失敗時: `INVALID_INPUT`（AuthorizationDecision ではなくエラーレスポンス）

### Step 1〜N: 認可判定（AuthorizationDecision を返す）

```
1. トークンの存在確認
   → TOKEN_NOT_FOUND

2. token.status の確認
   → TOKEN_REVOKED
   → TOKEN_SUSPENDED

3. token.expiry の確認
   → TOKEN_EXPIRED

4. 親チェーン全体の評価（Section 3 参照）
   → PARENT_TOKEN_INACTIVE

5. scope のマッチング確認（Section 1 参照）
   → SCOPE_MISMATCH

6. budget 残高確認
   残高 = limit - sum(ledger) < amount
   → BUDGET_EXCEEDED

7. 親 scope との整合性確認（委譲制約 Section 2 参照）
   → PARENT_SCOPE_EXCEEDED

8. 親 budget との整合性確認
   子の残高が親の残高を超えていないか
   → PARENT_BUDGET_EXCEEDED
   ※ 親・子が独立に消費した結果、発行時点では妥当だった子 budget が、
      判定時点では親残高を超過する場合がある。その場合も PARENT_BUDGET_EXCEEDED とする。

→ ALLOWED
```

いずれかで deny が確定した時点で評価を終了する。

---

## 5. AuthorizationDecision と Error Codes

### 5.1 型定義

```typescript
interface AuthorizationDecision {
  allowed: boolean
  reasonCode: AuthorizationReasonCode
  message: string              // Section 5.3 の標準文言を使用
  retryable: boolean           // Section 5.4 参照
  evaluatedAt: IsoDatetime
  tokenId?: string
}

type AuthorizationReasonCode =
  | 'ALLOWED'
  | 'TOKEN_NOT_FOUND'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REVOKED'
  | 'TOKEN_SUSPENDED'
  | 'SCOPE_MISMATCH'
  | 'BUDGET_EXCEEDED'
  | 'PARENT_TOKEN_INACTIVE'
  | 'PARENT_SCOPE_EXCEEDED'
  | 'PARENT_BUDGET_EXCEEDED'
```

### 5.2 レスポンス形式

**ALLOW**
```json
{
  "allowed": true,
  "reasonCode": "ALLOWED",
  "message": "Authorization granted",
  "retryable": false,
  "evaluatedAt": "2025-01-01T09:00:00Z",
  "tokenId": "token-uuid-xxxx"
}
```

**DENY**
```json
{
  "allowed": false,
  "reasonCode": "SCOPE_MISMATCH",
  "message": "Requested action is outside authorized scope",
  "retryable": false,
  "evaluatedAt": "2025-01-01T09:00:00Z",
  "tokenId": "token-uuid-xxxx"
}
```

### 5.3 標準メッセージ文言

実装は以下の文言を固定で使用すること。自由文は使わない。

| reasonCode | message |
|---|---|
| `ALLOWED` | Authorization granted |
| `TOKEN_NOT_FOUND` | Authorization token not found |
| `TOKEN_EXPIRED` | Authorization token has expired |
| `TOKEN_REVOKED` | Authorization token has been revoked |
| `TOKEN_SUSPENDED` | Authorization token is suspended |
| `SCOPE_MISMATCH` | Requested action is outside authorized scope |
| `BUDGET_EXCEEDED` | Insufficient budget for this action |
| `PARENT_TOKEN_INACTIVE` | Parent token in chain is inactive |
| `PARENT_SCOPE_EXCEEDED` | Requested scope exceeds parent token scope |
| `PARENT_BUDGET_EXCEEDED` | Requested budget exceeds parent token budget |

### 5.4 retryable フラグ

| reasonCode | retryable | 理由 |
|---|---|---|
| `TOKEN_NOT_FOUND` | false | トークン自体が存在しない |
| `TOKEN_EXPIRED` | false | 有効期限切れは不可逆 |
| `TOKEN_REVOKED` | false | 失効は不可逆 |
| `TOKEN_SUSPENDED` | true | 親または運用者が復活させれば再試行可能 |
| `SCOPE_MISMATCH` | false | スコープ外は再試行しても変わらない |
| `BUDGET_EXCEEDED` | true | リセット後は再試行可能 |
| `PARENT_TOKEN_INACTIVE` | true | 親の状態が変われば再試行可能 |
| `PARENT_SCOPE_EXCEEDED` | false | 委譲制約違反は構造的な問題 |
| `PARENT_BUDGET_EXCEEDED` | false | 委譲制約違反は構造的な問題 |

---

## 6. Budget Consumption（消費記録方式）

### 6.1 設計方針

`AuthorizationToken.budget` の `spent` は読み取り専用の**派生値**とする。  
実際の消費記録は `BudgetLedgerEntry` として独立して管理する。

### 6.2 amount のルール

- `amount` は**正の整数文字列のみ**許可
- `"0"`, 負値（`"-10"`）, 浮動小数点文字列（`"1.5"`）は不正
- refund / adjustment は MVP スコープ外

### 6.3 型定義

```typescript
type IsoDatetime = string  // RFC 3339

interface Budget {
  limit: string            // 正の整数文字列
  currency: 'credits'      // MVP は credits のみ
  resetPolicy?: 'per-task' | 'per-session' | 'never'
}

interface BudgetLedgerEntry {
  id: string
  tokenId: string
  amount: string           // 正の整数文字列のみ
  actionId: string
  timestamp: IsoDatetime
}
```

### 6.4 残高計算

```
残高 = budget.limit - sum(ledger.amount where ledger.tokenId = token.id)
```

### 6.5 原子的操作インターフェース

`append` と `sum` を公開すると利用側が unsafe な組み合わせをしやすい。  
判定と消費は必ずサービス層で一体化した操作として提供する。

```typescript
interface BudgetLedgerStore {
  // 内部実装用（直接公開しない）
  append(entry: BudgetLedgerEntry): Promise<void>
  sumByTokenId(tokenId: string): Promise<string>
}

// 公開 API はこちら（budget 残高に関する原子的消費のみを担う）
// scope 判定・token 状態判定は evaluator の責務。consumeIfAvailable は呼ばない
interface BudgetService {
  consumeIfAvailable(
    tokenId: string,
    amount: string,
    actionId: string
  ): Promise<AuthorizationDecision>
}
```

### 6.6 MVP のストレージ

- インメモリのみ（プロセス再起動でリセット）
- `BudgetLedgerStore` インターフェース経由で後から差し替え可能

---

## 7. 実装上の注意

### 純粋関数と副作用の分離

認可判定ロジックは純粋関数に近い形で実装し、副作用と分離すること。

```
evaluator  ← 純粋な判定ロジック（副作用なし）
issuer     ← トークン発行
ledger     ← BudgetLedgerStore の実装
audit      ← AuditRecord の記録
```

`evaluator` が `ledger.append` や `audit.write` を直接呼ばない設計にする。  
副作用は呼び出し側のサービス層が責任を持つ。

---

## 8. Step 2 受け入れテスト

`@agentbond/auth` の実装完了条件として、以下を全て通過すること。

```
TC-01: 有効なトークンで対象 scope のアクション → ALLOWED

TC-02: expiry 超過のトークン → TOKEN_EXPIRED

TC-03: revoked のトークン → TOKEN_REVOKED

TC-04: scope に含まれない domain でのアクション → SCOPE_MISMATCH

TC-05: scope に含まれない operation でのアクション → SCOPE_MISMATCH

TC-06: budget 上限を超えるアクション → BUDGET_EXCEEDED

TC-07: 親トークンが revoked の子トークン → PARENT_TOKEN_INACTIVE
       （子トークン自身の status は変更されていないこと）

TC-08: 親より広い scope を持つ子トークンの発行試行 → 発行拒否（エラー）
       （不正な子トークンは発行時点で弾く。TC-13 はその防御をすり抜けた場合のセーフガード）

TC-09: 並列で2つの消費リクエストが来たとき合計が正しく記録されること
       （consumeIfAvailable を使用し、二重消費が起きないこと）

TC-10: suspended の親が active に戻ったとき、
       子トークンが再び ALLOWED になること
       （子トークン自身の status 変更なしに復活すること）

TC-11: amount に "0" を指定したとき → INVALID_INPUT

TC-12: 必須フィールド欠落のリクエスト → INVALID_INPUT

TC-13: 親 scope を超える scope を持つ子トークンの認可判定 → PARENT_SCOPE_EXCEEDED
       （発行時バリデーションをすり抜けた不整合トークンに対する防御的判定）

TC-14: 子の budget が親の残高を超えているとき → PARENT_BUDGET_EXCEEDED
```

---

## 9. 将来仕様（MVP では実装しない）

以下はインターフェースの差し込み口のみ確保し、実装はしない。

- `AgentIdentity.idScheme` による DID / 公開鍵フィンガープリント対応
- `SettlementHook` による決済連携
- `IntentPolicy` による意図証明の強制
- `maxDepth` による委譲深さ制限
- ストレージアダプターの実装（DB / S3 / オンチェーン）
- `grantor` / `grantee` への命名変更（将来のメジャーバージョンで検討）
- `amount` の負値対応（refund / adjustment）
- glob パターン同士の数学的包含判定
