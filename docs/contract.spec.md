# agentbond — Contract Specification

version: 0.1.0-draft
status: pre-implementation
scope: @agentbond/contract (MVP) — Contract Layer

---

## 概要

このドキュメントは `@agentbond/contract` の仕様を定義する。
実装はこのドキュメントを唯一の仕様源（single source of truth）として参照すること。

Contract Layerの目的は「エージェント間のタスク委託を合意・条件・状態として記録する」こと。
authorization.spec.md / intent.spec.md と同じ設計憲法（AIエージェントファースト原則）に従う。

---

## MVPスコープ

**含む:**
- Contractの作成・取得
- ステータス管理（draft / active / completed / disputed）
- タスク委託の定義（deliverable）
- 条件管理（budget_cap / time_limit）
- AuditRecordとの連携（contractRefの充足）
- principalによるステータス遷移（履歴付き）

**含まない（v2以降）:**
- 検収条件の自動判定
- 多者契約（3者以上）
- AuthorizationTokenの自動発行
- 永続化（インメモリのみ）
- 争議（disputed）の解決フロー
- Settlementとの自動連携

---

## 1. 型定義

```typescript
type IsoDatetime = string  // RFC 3339

/** Contractの当事者（MVPは2者: principal + executor） */
interface ContractParty {
  agent: AgentIdentity
  role: 'principal' | 'executor' | 'approver' | 'payer' | 'payee'
  // MVPでは principal と executor のみ使用
}

/** タスク委託の成果物定義 */
interface DeliverableSpec {
  description: string          // 1000文字以内
  schema?: Record<string, unknown>  // JSON Schema（省略可能）
  acceptanceCriteria: string[] // MVP: 記録のみ、自動判定なし
}

/** Contractに付与する条件 */
interface ContractCondition {
  type: 'budget_cap' | 'time_limit' | 'approval_gate' | 'custom'
  value: unknown
}

// budget_cap の value 形式:
// { limit: string, currency: 'credits' }  // 正の整数文字列

// time_limit の value 形式:
// { deadline: IsoDatetime }

/** ステータス遷移の履歴エントリ */
interface ContractStatusTransition {
  from: ContractStatus
  to: ContractStatus
  by: AgentIdentity           // 遷移を行ったエージェント（必ずprincipal）
  reason?: string             // 省略可能。500文字以内
  timestamp: IsoDatetime
}

type ContractStatus = 'draft' | 'active' | 'completed' | 'disputed'

/** エージェント間タスク委託の合意 */
interface Contract {
  id: string
  parties: ContractParty[]    // MVPは必ず [principal, executor] の2者
  deliverable: DeliverableSpec
  conditions: ContractCondition[]
  status: ContractStatus
  statusHistory: ContractStatusTransition[]  // 全遷移を記録
  authorizationTokenRef?: string  // 関連するAuthorizationToken.id（参照のみ）
  createdAt: IsoDatetime
  updatedAt: IsoDatetime
}
```

---

## 2. 当事者ルール

### 2.1 MVPの2者制約

MVPでは `parties` は必ず以下の2者のみ：

```
[
  { agent: AgentIdentity, role: 'principal' },  // 委託者
  { agent: AgentIdentity, role: 'executor' }    // 受託者
]
```

- principal と executor が同一エージェントは不可
- 同じ role が2つ存在するのは不可（MVP）

### 2.2 AuthorizationTokenとの関係

ContractはAuthorizationTokenを自動発行しない。
`authorizationTokenRef` で既存トークンを参照するだけ。

```
Contract.authorizationTokenRef → AuthorizationToken.id
AgentAction.contractRef        → Contract.id
```

発行は引き続き `@agentbond/auth` の責務。

---

## 3. ステータス遷移ルール

### 3.1 遷移マトリクス

```
draft     → active     : principal のみ可
draft     → disputed   : 不可
active    → completed  : principal のみ可
active    → disputed   : principal のみ可
completed → *          : 不可（終端状態）
disputed  → active     : principal のみ可（再開）
disputed  → completed  : principal のみ可
```

### 3.2 遷移の権限

- **principalのみ**がステータスを変更できる
- 全ての遷移は `statusHistory` に記録される（削除・修正不可）
- executor はステータスを変更できないが、`disputed` を「申請」する手段は将来実装（MVP外）

### 3.3 time_limit 超過時の扱い

`time_limit` 条件が設定されており `deadline` を超過した場合：
- statusを自動変更しない（評価時に `CONTRACT_DEADLINE_EXCEEDED` として deny）
- 遷移はprincipalの明示的な操作のみ

---

## 4. 条件（conditions）の評価

### 4.1 budget_cap

```typescript
// 条件の定義例
{ type: 'budget_cap', value: { limit: '5000', currency: 'credits' } }
```

- `limit` は正の整数文字列のみ（authorization.spec.md の amount ルールと同じ）
- ContractにリンクしたAuthorizationTokenのbudget.limitがこの値を超えていたら `CONTRACT_BUDGET_EXCEEDED`
- MVPでは消費の追跡はauth層に委譲する

### 4.2 time_limit

```typescript
// 条件の定義例
{ type: 'time_limit', value: { deadline: '2025-12-31T23:59:59Z' } }
```

- `deadline` は RFC 3339 形式
- 評価時刻が deadline を超えていたら `CONTRACT_DEADLINE_EXCEEDED`

### 4.3 複数条件の評価

- conditions は AND 評価（全条件を満たす必要がある）
- 1つでも違反があれば deny

---

## 5. ContractDecision と Error Codes

### 5.1 型定義

```typescript
interface ContractDecision {
  allowed: boolean
  reasonCode: ContractReasonCode
  message: string              // Section 5.3 の標準文言を使用
  retryable: boolean
  evaluatedAt: IsoDatetime
  contractId?: string
}

type ContractReasonCode =
  | 'ALLOWED'
  | 'CONTRACT_NOT_FOUND'
  | 'CONTRACT_NOT_ACTIVE'      // status が active でない
  | 'CONTRACT_DEADLINE_EXCEEDED'
  | 'CONTRACT_BUDGET_EXCEEDED'
  | 'TRANSITION_NOT_ALLOWED'   // 不正なステータス遷移
  | 'UNAUTHORIZED_TRANSITION'  // principal 以外が遷移を試みた
  | 'INVALID_INPUT'
```

### 5.2 標準メッセージ文言

| reasonCode | message |
|---|---|
| `ALLOWED` | Contract operation successful |
| `CONTRACT_NOT_FOUND` | Contract not found |
| `CONTRACT_NOT_ACTIVE` | Contract is not in active status |
| `CONTRACT_DEADLINE_EXCEEDED` | Contract deadline has passed |
| `CONTRACT_BUDGET_EXCEEDED` | Action exceeds contract budget cap |
| `TRANSITION_NOT_ALLOWED` | Status transition is not permitted |
| `UNAUTHORIZED_TRANSITION` | Only the principal can transition contract status |
| `INVALID_INPUT` | Invalid input: see error details |

### 5.3 retryable フラグ

| reasonCode | retryable | 理由 |
|---|---|---|
| `CONTRACT_NOT_FOUND` | false | 存在しない |
| `CONTRACT_NOT_ACTIVE` | true | principalがactiveに戻せば再試行可能 |
| `CONTRACT_DEADLINE_EXCEEDED` | false | 時間は戻らない |
| `CONTRACT_BUDGET_EXCEEDED` | false | 構造的な制約違反 |
| `TRANSITION_NOT_ALLOWED` | false | 遷移ルール上不可 |
| `UNAUTHORIZED_TRANSITION` | false | 権限がない |
| `INVALID_INPUT` | false | 入力を修正が必要 |

---

## 6. AuditRecordとの連携

ContractのステータスごとにAuditRecordを記録する。

```typescript
// ステータス遷移時のAuditRecord例
{
  id: "audit-003",
  actionId: "transition-action-001",
  authorizationTokenId: undefined,
  contractId: "contract-001",      // ← Contract.id
  layer: "contract",
  outcome: "allowed",
  reasonCode: "ALLOWED",
  timestamp: "2025-01-01T09:00:00Z"
}
```

AuditRecord に `contractId?: string` を追加する（後方互換）。

---

## 7. 入力バリデーション

| 対象 | ルール |
|---|---|
| `parties` | 必須・2要素・principal と executor が1つずつ存在 |
| `parties[].agent.id` | 必須・空文字不可 |
| `deliverable.description` | 必須・1000文字以内 |
| `deliverable.acceptanceCriteria` | 必須・配列（空配列可） |
| `conditions[].type` | 列挙値のいずれかであること |
| `budget_cap.value.limit` | 正の整数文字列のみ |
| `time_limit.value.deadline` | RFC 3339 形式 |
| `statusTransition.reason` | 省略可能・500文字以内 |
| `authorizationTokenRef` | 省略可能・空文字不可（指定する場合） |

---

## 8. 実装上の注意

### 純粋関数と副作用の分離

auth / intent と同じ方針を踏襲する。

```
evaluator   ← 純粋な判定ロジック（副作用なし）
transitioner← ステータス遷移ロジック
store       ← ContractStoreの実装（インメモリ）
service     ← オーケストレーション（audit連携含む）
```

### ContractStoreインターフェース

```typescript
interface ContractStore {
  save(contract: Contract): Promise<void>
  findById(id: string): Promise<Contract | null>
  findByPartyId(agentId: string): Promise<Contract[]>
}
```

MVPはインメモリのみ。インターフェース経由で後から差し替え可能にする。

---

## 9. 受け入れテスト

`@agentbond/contract` の実装完了条件として、以下を全て通過すること。

```
TC-C-01: 有効な2者でContractを作成 → ALLOWED、status: 'draft'

TC-C-02: draft → active 遷移（principalが実行） → ALLOWED
         statusHistoryに遷移が記録されること

TC-C-03: draft → active 遷移（executorが実行） → UNAUTHORIZED_TRANSITION

TC-C-04: active → completed 遷移（principalが実行） → ALLOWED
         completed は終端状態（それ以上の遷移は不可）

TC-C-05: completed → active 遷移試行 → TRANSITION_NOT_ALLOWED

TC-C-06: active状態のContractでdeadline超過 → CONTRACT_DEADLINE_EXCEEDED

TC-C-07: budget_cap条件付きContractで上限超過 → CONTRACT_BUDGET_EXCEEDED

TC-C-08: active → disputed 遷移（principalが実行） → ALLOWED
         disputed → active 再開（principalが実行） → ALLOWED

TC-C-09: parties に principal が2つ → INVALID_INPUT

TC-C-10: deliverable.description が1001文字 → INVALID_INPUT

TC-C-11: time_limit の deadline が RFC 3339 でない → INVALID_INPUT

TC-C-12: authorizationTokenRef を指定したContract作成
         → Contract.authorizationTokenRefが正しく記録される

TC-C-13: statusHistoryが全ての遷移を順番通りに記録していること

TC-C-14: conditions が AND 評価されること
         （budget_cap + time_limit の両方違反時、最初の違反でdeny）
```

---

## 10. 将来仕様（MVPでは実装しない）

- 検収条件の自動判定（acceptanceCriteriaの機械的評価）
- 多者契約（3者以上のContractParty）
- AuthorizationTokenの自動発行（Contract activeトリガー）
- disputedの解決フロー（仲裁者・タイムアウト）
- Settlementとの自動連携（completed時に決済トリガー）
- ContractTemplateによる再利用可能な契約雛形
- 永続化（DB / S3）
