# agentbond — Claude Code 引き継ぎ書 v0.3

## 概要

AIエージェント間の認可・意図証明・契約・決済を統一的に扱う
**エージェントファーストなガバナンスインフラ**。

OSSとして公開し、MCPエコシステムへの統合・大手プラットフォームへの採用を目指す。

---

## 設計憲法 — AIエージェントファースト原則

すべての実装判断はこの原則に照らして決める。

```
1. 発見可能性
   エージェントが自律的にこのツールを見つけ、使い方を理解できること。
   人間の説明なしにOpenAPI / JSON Schemaから動けること。

2. 予測可能性
   同じ入力に対して同じ出力が保証されること。
   エラーは人間ではなくエージェントが処理できる形式で返ること。

3. 最小権限
   エージェントに「必要な権限だけ」を渡せる設計。
   過剰な権限を要求する設計は原則違反。

4. 監査可能性
   エージェントのすべてのアクションが後から検証できること。
   ブラックボックスにしない。

5. 破壊的変更ゼロポリシー
   エージェントはバージョンアップを自分で検知できない。
   コアインターフェースは後方互換を最優先とする。
```

---

## アーキテクチャ — レイヤー構造

```
┌─────────────────────────────────────┐
│  Contract Layer                     │  エージェント間の合意・条件定義
├─────────────────────────────────────┤
│  Authorization Layer   ← MVP here  │  誰が何をどこまでできるか
├─────────────────────────────────────┤
│  Intent Layer                       │  なぜそのアクションを起こしたか
├─────────────────────────────────────┤
│  Settlement Layer                   │  実際の決済・精算
└─────────────────────────────────────┘
```

すべてのレイヤーは中心概念 `AgentAction` を共有する。
MVPはAuthorizationのみ実装するが、他レイヤーとのインターフェース（差し込み口）は最初から定義する。

---

## リポジトリ構造

```
agentbond/
├── packages/
│   ├── core/          ← 型定義・共通インターフェース（Step 1）
│   ├── auth/          ← 支出認可の実装（Step 2, MVP）
│   ├── intent/        ← 意図証明（Step 5以降）
│   ├── contract/      ← コントラクト管理（Step 5以降）
│   └── settlement/    ← マイクロペイメント（Step 5以降）
├── mcp-server/        ← MCPエントリポイント（Step 4）
├── docs/
│   ├── authorization.spec.md   ← 認可判定の仕様書（必読）
│   └── llms.txt                ← エージェントへの発見可能性用（Step 4で追加）
└── HANDOFF.md
```

パッケージスコープ: `@agentbond/*`
モノレポツール: pnpm workspaces + turborepo

---

## コアインターフェース定義

> v0.2 — レビュー反映済み
> 主な変更: Date→IsoDatetime / Budget修正 / parentTokenId追加 /
>           AuthorizationDecision追加 / BudgetLedgerEntry追加 /
>           SettlementHook.provider開放 / AuditRecord軽量化 /
>           Contract.parties をContractParty[]に変更

### 共通型

```typescript
// すべてのタイムスタンプはISO 8601文字列（RFC 3339）
// 理由: エージェントや他言語クライアントはDateオブジェクトではなくJSONを見るため
type IsoDatetime = string
```

### identity.ts

```typescript
interface AgentIdentity {
  id: string                        // UUIDv7推奨（将来のDID移行パスはpublicKeyで確保）
  type: 'human' | 'ai' | 'service'
  publicKey?: string                // 将来の署名検証用
  metadata?: Record<string, unknown>
}
```

### action.ts

```typescript
interface ActionScope {
  domain: string                    // 例: "api.stripe.com", "mcp:filesystem"
  operations: string[]              // 例: ["read", "write"]
  resources?: string[]              // glob記法。例: ["/invoices/*"]
}

interface AgentAction {
  id: string
  actor: AgentIdentity
  scope: ActionScope
  timestamp: IsoDatetime

  // 各レイヤーへの参照（省略可能 = レイヤー未使用）
  authorizationRef?: string
  intentRef?: string
  contractRef?: string
  settlementRef?: string
}
```

### authorization.ts ← MVP実装対象

```typescript
interface Budget {
  limit: string                     // 文字列化された整数（浮動小数点誤差回避）
  currency: 'credits'               // MVPはcreditsのみ。Stripe/Coinbaseはアダプターで後付け
  resetPolicy?: 'per-task' | 'per-session' | 'never'
  // spentはBudgetLedgerから算出される派生値。このオブジェクトには持たない
}

interface AuthorizationToken {
  id: string
  parentTokenId?: string            // 委任チェーンのリンク。ルートトークンはundefined
  issuedBy: AgentIdentity
  issuedTo: AgentIdentity
  scopes: ActionScope[]
  budget: Budget
  expiry: IsoDatetime
  status: 'active' | 'suspended' | 'revoked'
  // expired は status に持たない。失効判定は常に expiry フィールドで行う。
  // expired を status に入れると expiry との二重表現になりバグ源になるため。

  // 下位レイヤーとの接続口（MVP時点では未実装、型のみ定義）
  intentPolicy?: IntentPolicy
  contractRef?: string
  settlementHook?: SettlementHook
}

// 認可判定の結果型 — エージェントが機械的に処理できる形式
interface AuthorizationDecision {
  allowed: boolean
  reasonCode: AuthorizationReasonCode
  message: string              // authorization.spec.md Section 5.3 の標準文言を使用
  retryable: boolean
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

// Budget消費記録 — spentはこのledgerの合計から算出する
interface BudgetLedgerEntry {
  id: string
  tokenId: string
  amount: string                    // 正の整数文字列のみ（"0"・負値・浮動小数点不可）
  actionId: string
  timestamp: IsoDatetime
}

// ストレージアダプターインターフェース（MVPはインメモリ実装）
interface BudgetLedgerStore {
  append(entry: BudgetLedgerEntry): Promise<void>
  sumByTokenId(tokenId: string): Promise<string>
}
```

### intent.ts

```typescript
interface IntentRecord {
  id: string
  action: AgentAction
  // センシティブ情報を直接保存しないよう要約形式とする
  evidence: {
    type: 'human-instruction' | 'model-summary' | 'system-rule'
    content: string
  }[]
  triggeredBy?: string
  confidence?: number               // 0-1
}

interface IntentPolicy {
  requireReasoning: boolean
  auditLevel: 'none' | 'summary' | 'full'
}
```

### contract.ts

```typescript
// 将来の多者契約・仲介者に対応するため ContractParty 配列を使用
interface ContractParty {
  agent: AgentIdentity
  role: 'principal' | 'executor' | 'approver' | 'payer' | 'payee'
}

interface Contract {
  id: string
  parties: ContractParty[]
  deliverable: DeliverableSpec
  conditions: ContractCondition[]
  status: 'draft' | 'active' | 'completed' | 'disputed'
}

interface DeliverableSpec {
  description: string
  schema?: Record<string, unknown>  // JSON Schema
  acceptanceCriteria: string[]
}

interface ContractCondition {
  type: 'budget_cap' | 'time_limit' | 'approval_gate' | 'custom'
  value: unknown
}
```

### settlement.ts

```typescript
interface SettlementHook {
  provider: 'mock' | 'stripe' | 'coinbase' | 'onchain' | `custom:${string}`
  endpoint?: string
}

interface SettlementRecord {
  id: string
  from: AgentIdentity
  to: AgentIdentity
  amount: string                    // 文字列化された整数
  currency: string
  trigger: 'task_complete' | 'budget_depleted' | 'manual'
  txHash?: string
}
```

### audit.ts

```typescript
// フルオブジェクトではなくIDによる参照（ログ量・冗長性の抑制）
interface AuditRecord {
  id: string
  actionId: string
  authorizationTokenId?: string
  layer: 'authorization' | 'intent' | 'contract' | 'settlement'
  outcome: 'allowed' | 'denied' | 'pending'
  reason?: string
  timestamp: IsoDatetime
}
```

---

## 実装ステップ

各ステップの完了条件は「エージェントがそのステップだけで自律的に動けるか」。

### Step 1: @agentbond/core — 型定義のみ公開

**目標:** tsc --noEmit が通り、npm publishできる状態

**作るもの:**
- `packages/core/src/` 以下に各 `.ts` ファイル
- `packages/core/src/index.ts`（全てre-export）
- `packages/core/package.json`（`@agentbond/core`）
- `packages/core/tsconfig.json`
- `README.md` 骨格（設計憲法・レイヤー構造・クイックスタート）

**作らないもの:**
- 実装ロジック（型定義・インターフェースのみ）
- テスト
- 署名検証
- 永続化

---

### Step 2: @agentbond/auth — 認可エンジンの実装

**目標:** トークンの発行・検証・失効がAPIとして動く

**仕様書:** `docs/authorization.spec.md` を必ず参照すること

**作るもの:**
- `packages/auth/src/issuer.ts`（トークン発行）
- `packages/auth/src/evaluator.ts`（認可判定）
- `packages/auth/src/ledger.ts`（BudgetLedger インメモリ実装）
- `packages/auth/src/index.ts`

**受け入れテスト:** `docs/authorization.spec.md` Section 6（TC-01〜TC-10）

**作らないもの:**
- 永続化（インメモリのみ）
- 決済連携
- 署名検証
- MCPラッパー

---

### Step 3: AuditRecordのインメモリ実装

**目標:** 全アクションがAuditRecordとして記録・取得できる

**作らないもの:** ストレージアダプターの実装（インターフェース定義のみ）

---

### Step 4: mcp-server — MCPサーバーとしてラップ

**目標:** Smitheryに掲載できる状態

**作らないもの:** Smithery掲載作業（別途手動）

---

### Step 5以降: intent / contract / settlement

原則に従い一層ずつ追加。

---

## 最初のタスク（Claude Codeへの指示）

```
HANDOFF.md と docs/authorization.spec.md を両方読んでから実装を開始すること。

Step 1 を実行してください:

1. pnpm workspaces + turborepo でモノレポを初期化する
2. packages/core を作成し、HANDOFF.md のインターフェース定義を実装する
3. tsc --noEmit が通ることを確認する
4. README.md の骨格を作成する

注意事項:
- 型定義のみ。実装ロジックは書かない
- 仕様にないフィールドを善意で追加しない
- 不明点は実装を止めて質問する
```

---

## 補足メモ

- npm名 `agentbond` および `@agentbond` スコープの空き確認を最初に行う
- ライセンス: MIT
- `issuedBy` / `issuedTo` → `grantor` / `grantee` リネームは将来のメジャーバージョンで検討
- Smithery登録はStep 4完了後すぐに行う
