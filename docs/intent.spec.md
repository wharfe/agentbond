# agentbond — Intent Specification

version: 0.1.0-draft
status: pre-implementation
scope: @agentbond/intent (MVP) — Intent Layer

---

## 概要

このドキュメントは `@agentbond/intent` の仕様を定義する。
実装はこのドキュメントを唯一の仕様源（single source of truth）として参照すること。

Intent Layerの目的は「エージェントがなぜそのアクションを起こしたかを記録・検証する」こと。
authorization.spec.md と同じ設計憲法（AIエージェントファースト原則）に従う。

---

## MVPスコープ

**含む:**
- IntentRecordの作成・取得
- IntentPolicyによる意図記録の強制（requireReasoning）
- AuditRecordとの連携（intentRefの充足）
- INTENT_REQUIRED による deny

**含まない（v2以降）:**
- 実行前の事前宣言・承認ゲート
- 人間の承認・拒否フロー
- LLM思考ログの生保存
- 永続化（インメモリのみ）

---

## 1. 型定義

```typescript
type IsoDatetime = string  // RFC 3339

/** エージェントのアクションに紐づく意図記録 */
interface IntentRecord {
  id: string
  actionId: string           // AgentAction.id への参照（フルオブジェクトは持たない）
  tokenId: string            // AuthorizationToken.id への参照
  evidence: IntentEvidence[] // 1件以上必須
  triggeredBy?: string       // 上位タスクのID（タスクチェーン追跡用）
  confidence?: number        // 0-1（省略可能）
  createdAt: IsoDatetime     // Action実行後に作成
}

interface IntentEvidence {
  type: 'human-instruction' | 'model-summary' | 'system-rule'
  content: string            // 1000文字以内。生ログ禁止、要約形式のみ
}

/** AuthorizationTokenに付与する意図ポリシー */
interface IntentPolicy {
  requireReasoning: boolean  // trueの場合、IntentRecordなしのアクションをdeny
  auditLevel: 'none' | 'summary' | 'full'
}
```

---

## 2. evidence のルール

### 2.1 件数

- `requireReasoning: true` のポリシーが適用されるアクションでは **1件以上必須**
- 空配列は `INTENT_REQUIRED` として deny

### 2.2 content の制約

- **1000文字以内**（超過はINVALID_INPUTとして拒否）
- 生ログ・プロンプト全文・個人情報・機密情報を含めないこと
- 要約・抽象化されたテキストのみ許可

### 2.3 type の使い分け

| type | 使用場面 | 例 |
|---|---|---|
| `human-instruction` | 人間から受けた指示を要約したもの | "ユーザーから請求書一覧の取得を指示された" |
| `model-summary` | LLMが推論した理由の要約 | "月次レポート生成タスクの一環として請求書データが必要と判断" |
| `system-rule` | システムルール・ポリシーに基づく場合 | "定期実行スケジュールによるトリガー" |

---

## 3. IntentPolicyの評価

### 3.1 評価タイミング

IntentPolicyの評価は **Action実行後、AuditRecord記録前** に行う。

```
AgentAction 実行
 ↓
IntentPolicy確認（requireReasoning: true か？）
 ↓ true の場合
IntentRecord の存在確認
 ↓ 存在しない場合
INTENT_REQUIRED で deny → AuditRecord に記録（outcome: denied）
 ↓ 存在する場合
AuditRecord に記録（outcome: allowed、intentRefを充足）
```

### 3.2 requireReasoning: false の場合

IntentRecordの有無に関わらず処理を通過する。
IntentRecordが存在する場合はAuditRecordのintentRefに記録する。

### 3.3 auditLevel の意味

| auditLevel | 動作 |
|---|---|
| `none` | IntentRecordをAuditRecordに連携しない |
| `summary` | IntentRecord.idのみAuditRecordのintentRefに記録 |
| `full` | IntentRecord全体をAuditRecord参照として記録（MVPではsummaryと同等） |

---

## 4. AuditRecordとの連携

### 4.1 intentRefの充足

AuditRecord の `intentRef` フィールドは以下の条件で充足される。

- `auditLevel: 'summary'` または `'full'` のとき
- 対応するIntentRecordが存在するとき

```typescript
// AuditRecord（既存）にintentRefが充足された例
{
  id: "audit-001",
  actionId: "action-001",
  authorizationTokenId: "token-001",
  intentRef: "intent-001",    // ← IntentRecord.id
  layer: "intent",
  outcome: "allowed",
  timestamp: "2025-01-01T09:00:00Z"
}
```

### 4.2 deny時のAuditRecord

IntentPolicyによってdenyされた場合もAuditRecordを記録する。

```typescript
{
  id: "audit-002",
  actionId: "action-002",
  authorizationTokenId: "token-001",
  layer: "intent",
  outcome: "denied",
  reasonCode: "INTENT_REQUIRED",
  timestamp: "2025-01-01T09:00:01Z"
}
```

---

## 5. IntentDecision と Error Codes

### 5.1 型定義

```typescript
interface IntentDecision {
  allowed: boolean
  reasonCode: IntentReasonCode
  message: string            // Section 5.3 の標準文言を使用
  retryable: boolean
  evaluatedAt: IsoDatetime
  intentId?: string
}

type IntentReasonCode =
  | 'ALLOWED'
  | 'INTENT_REQUIRED'        // requireReasoning: true だがIntentRecordが存在しない
  | 'INTENT_NOT_FOUND'       // intentIdは指定されたが該当レコードが存在しない
  | 'INVALID_INPUT'          // バリデーション失敗
```

### 5.2 標準メッセージ文言

| reasonCode | message |
|---|---|
| `ALLOWED` | Intent recorded successfully |
| `INTENT_REQUIRED` | Intent record is required by policy but not provided |
| `INTENT_NOT_FOUND` | Specified intent record not found |
| `INVALID_INPUT` | Invalid input: see error details |

### 5.3 retryable フラグ

| reasonCode | retryable | 理由 |
|---|---|---|
| `INTENT_REQUIRED` | true | IntentRecordを作成してから再試行可能 |
| `INTENT_NOT_FOUND` | false | 存在しないレコードは再試行しても変わらない |
| `INVALID_INPUT` | false | 入力を修正しなければ再試行不可 |

---

## 6. 入力バリデーション

authorization.spec.md Section 0 と同様に、評価前に入力を検証する。

| 対象 | ルール |
|---|---|
| `actionId` | 必須・空文字不可 |
| `tokenId` | 必須・空文字不可 |
| `evidence` | 必須・配列（requireReasoning: true のとき1件以上） |
| `evidence[].type` | 列挙値のいずれかであること |
| `evidence[].content` | 必須・1000文字以内 |
| `confidence` | 省略可能。指定する場合は0以上1以下の数値 |
| `createdAt` | RFC 3339 形式の文字列 |

---

## 7. 実装上の注意

### 純粋関数と副作用の分離

authorization.spec.md Section 7 と同じ方針を踏襲する。

```
evaluator  ← 純粋な判定ロジック（副作用なし）
recorder   ← IntentRecordの作成・取得
store      ← IntentStoreの実装（インメモリ）
```

`evaluator` が `store` や `audit` を直接呼ばない設計にする。

### IntentStoreインターフェース

```typescript
interface IntentStore {
  save(record: IntentRecord): Promise<void>
  findByActionId(actionId: string): Promise<IntentRecord | null>
  findById(id: string): Promise<IntentRecord | null>
}
```

MVPはインメモリのみ。インターフェース経由で後から差し替え可能にする。

---

## 8. 受け入れテスト

`@agentbond/intent` の実装完了条件として、以下を全て通過すること。

```
TC-I-01: requireReasoning: true のトークンで evidence 1件のIntentRecordを作成
         → ALLOWED、AuditRecordのintentRefが充足される

TC-I-02: requireReasoning: true のトークンでIntentRecordなしにアクション実行
         → INTENT_REQUIRED、AuditRecordのoutcomeがdenied

TC-I-03: requireReasoning: false のトークンでIntentRecordなしにアクション実行
         → ALLOWED（IntentRecord不要）

TC-I-04: evidence が空配列
         → INVALID_INPUT

TC-I-05: evidence[].content が1001文字
         → INVALID_INPUT

TC-I-06: 存在しないintentIdを指定
         → INTENT_NOT_FOUND

TC-I-07: auditLevel: 'none' のとき、AuditRecordにintentRefが記録されないこと

TC-I-08: auditLevel: 'summary' のとき、AuditRecordにintentRefが記録されること

TC-I-09: triggeredBy を指定したとき、タスクチェーンが辿れること

TC-I-10: confidence に 1.1 を指定したとき → INVALID_INPUT
```

---

## 9. 将来仕様（MVPでは実装しない）

- 実行前の事前宣言・承認ゲート（human-in-the-loop）
- IntentRecordの永続化（DB / S3）
- `auditLevel: 'full'` の完全実装
- IntentRecordの改ざん検知（署名・ハッシュ）
- evidence の機密レベル分類
