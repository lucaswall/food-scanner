# Fix Plan: Inconsistent keyword tokenization breaks food matching

**Issue:** [FOO-172](https://linear.app/lw-claude/issue/FOO-172/bug-inconsistent-keyword-tokenization-breaks-food-matching)
**Date:** 2026-02-06
**Status:** Planning
**Branch:** fix/FOO-172-keyword-tokenization

## Investigation

### Bug Report
Two Clausthaler non-alcoholic beer entries that should match perfectly produce a 0.286 match ratio (below 0.5 threshold), so no suggestion is shown.

- **First food keywords (in DB):** `["cerveza", "sin alcohol", "clausthaler", "original", "alemana", "lata"]`
- **Second food keywords (new analysis):** `["cerveza", "sin", "alcohol", "clausthaler", "malta", "lupulo", "cebada"]`

### Classification
- **Type:** Bug
- **Severity:** High
- **Affected Area:** Claude keyword prompt + validation in `src/lib/claude.ts`

### Root Cause Analysis

Two problems combine:

1. **Claude prompt doesn't enforce single-word keywords.** The description at `src/lib/claude.ts:56` says "tokens" but doesn't prohibit spaces. Claude inconsistently generates multi-word tokens (`"sin alcohol"`) vs single-word tokens (`"sin"`, `"alcohol"`). Since `computeMatchRatio()` at `src/lib/food-matching.ts:28` uses exact `Set.has()`, `"sin" !== "sin alcohol"` and they never match.

2. **Claude prompt doesn't constrain keyword count or priority.** With 7 noisy keywords (brands, packaging, country of origin), the 0.5 threshold requires 4+ matches — nearly impossible when tokenization varies between analyses.

#### Evidence

Walking through `computeMatchRatio(newKeywords=second, existingKeywords=first)`:

| New keyword     | In existing set? | Reason                                          |
|-----------------|------------------|-------------------------------------------------|
| `"cerveza"`     | Yes              | exact match                                     |
| `"sin"`         | **No**           | existing has `"sin alcohol"` (multi-word token)  |
| `"alcohol"`     | **No**           | same — `"sin alcohol"` is one token in existing  |
| `"clausthaler"` | Yes              | exact match                                     |
| `"malta"`       | No               | not in existing at all                           |
| `"lupulo"`      | No               | not in existing at all                           |
| `"cebada"`      | No               | not in existing at all                           |

Result: 2/7 = 0.286 < 0.5 threshold → **filtered out, no match shown**.

#### Problematic Code

```typescript
// src/lib/claude.ts:53-57 — Current prompt allows multi-word and unlimited keywords
keywords: {
  type: "array",
  items: { type: "string" },
  description: "Lowercase, normalized, language-agnostic tokens identifying this food. Include the food type, key distinguishing ingredients, and preparation method. Example: 'Tostadas con casancrem y huevos fritos' → ['tostada', 'casancrem', 'huevo', 'frito']",
},
```

```typescript
// src/lib/claude.ts:125-133 — Validation only checks type, not content
if (!Array.isArray(data.keywords)) {
  throw new ClaudeApiError("Invalid food analysis: keywords must be an array");
}
if (data.keywords.length === 0) {
  throw new ClaudeApiError("Invalid food analysis: keywords must have at least 1 element");
}
if (!data.keywords.every((k: unknown) => typeof k === "string")) {
  throw new ClaudeApiError("Invalid food analysis: all keywords must be strings");
}
```

### Impact
- Any food where Claude tokenizes keywords differently between first log and re-analysis will fail to match
- Multi-word tokens (`"sin alcohol"`, `"con queso"`) are especially problematic since they may be split in subsequent analyses
- Noisy keywords (brands, packaging) dilute the match ratio below threshold

## Fix Plan (TDD Approach)

### Step 1: Write Failing Tests for Keyword Validation

**File:** `src/lib/__tests__/claude.test.ts`

Add tests that enforce the new validation rules:

```typescript
it("normalizes multi-word keywords by splitting on spaces", async () => {
  // Keywords like "sin alcohol" should be split to ["sin", "alcohol"]
  // or normalized to "sin-alcohol" with hyphens
  mockCreate.mockResolvedValueOnce({
    content: [{
      type: "tool_use",
      id: "test",
      name: "report_nutrition",
      input: {
        ...validAnalysis,
        keywords: ["cerveza", "sin alcohol", "clausthaler"],
      },
    }],
    ...
  });
  const result = await analyzeFood([], "test");
  // After normalization, "sin alcohol" becomes "sin-alcohol"
  expect(result.keywords).toEqual(["cerveza", "sin-alcohol", "clausthaler"]);
});

it("trims and lowercases keywords", async () => {
  // Keywords should be trimmed and lowercased
  mockCreate.mockResolvedValueOnce({...
    keywords: [" Cerveza ", "SIN-ALCOHOL"],
  });
  const result = await analyzeFood([], "test");
  expect(result.keywords).toEqual(["cerveza", "sin-alcohol"]);
});

it("deduplicates keywords after normalization", async () => {
  mockCreate.mockResolvedValueOnce({...
    keywords: ["cerveza", "cerveza", "sin-alcohol"],
  });
  const result = await analyzeFood([], "test");
  expect(result.keywords).toEqual(["cerveza", "sin-alcohol"]);
});

it("caps keywords at 5 items keeping first 5", async () => {
  mockCreate.mockResolvedValueOnce({...
    keywords: ["cerveza", "sin-alcohol", "clausthaler", "malta", "lupulo", "cebada", "extra"],
  });
  const result = await analyzeFood([], "test");
  expect(result.keywords).toHaveLength(5);
});

it("removes empty keywords after trimming", async () => {
  mockCreate.mockResolvedValueOnce({...
    keywords: ["cerveza", "", "  ", "sin-alcohol"],
  });
  const result = await analyzeFood([], "test");
  expect(result.keywords).toEqual(["cerveza", "sin-alcohol"]);
});
```

### Step 2: Improve Claude Prompt

**File:** `src/lib/claude.ts:53-57`

Replace the current keyword description with a structured, constrained prompt:

```typescript
keywords: {
  type: "array",
  items: { type: "string" },
  description: "3 to 5 lowercase single-word tokens (no spaces) identifying this food for matching against previously logged foods. Priority order: (1) food type (e.g., cerveza, pizza, ensalada), (2) key modifiers that affect nutrition (e.g., integral, descremado, light), (3) main ingredients not implied by food type (e.g., jamon, queso), (4) preparation method if nutritionally relevant (e.g., frito, hervido). For compound concepts use hyphens: sin-alcohol, sin-tacc. Use singular form. Exclude: brand names, packaging (lata, botella), country of origin, marketing terms (original, clasico). Example: 'Clausthaler Original cerveza sin alcohol en lata' → ['cerveza', 'sin-alcohol']. Example: 'Pizza de jamón y muzzarella' → ['pizza', 'jamon', 'muzzarella'].",
},
```

### Step 3: Add Server-Side Keyword Normalization

**File:** `src/lib/claude.ts` — new function + update `validateFoodAnalysis()`

Even with a better prompt, Claude may still occasionally produce multi-word keywords. Add a normalization step in `validateFoodAnalysis()` after the existing type checks:

```typescript
function normalizeKeywords(raw: string[]): string[] {
  const normalized = raw
    .flatMap(k => {
      const trimmed = k.trim().toLowerCase();
      if (trimmed.length === 0) return [];
      // Replace spaces with hyphens for compound concepts
      return [trimmed.replace(/\s+/g, "-")];
    })
    .filter((k, i, arr) => arr.indexOf(k) === i) // deduplicate
    .slice(0, 5); // cap at 5

  return normalized;
}
```

Then in `validateFoodAnalysis()`, after the existing keyword checks (`src/lib/claude.ts:125-133`), replace the raw assignment with:

```typescript
// Replace line 147: keywords: data.keywords as string[],
keywords: normalizeKeywords(data.keywords as string[]),
```

And re-validate after normalization that we still have at least 1 keyword.

### Step 4: Verify

- [ ] New tests pass (multi-word normalization, trim, dedup, cap)
- [ ] Existing keyword tests still pass (valid keywords unchanged by normalization)
- [ ] Existing matching tests in `food-matching.test.ts` still pass
- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] Lint passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)

## Notes

- **No backward compatibility needed.** Project is in development; existing DB data will be wiped. No changes needed to `computeMatchRatio` or existing DB entries.
