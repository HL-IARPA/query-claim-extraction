# Leakage Detection Fix Plan

## Current Problems

1. **Entity overlap too aggressive** - Generic terms like "U.S.", "Mission", "FRG", "NATO" are flagged as leakage when they're just necessary context

2. **No distinction between domain vocabulary and distinctive phrases**
   - "air manpower reductions" = domain vocabulary (OK to use)
   - "non-voluntary inclusion" = distinctive phrase (actual leakage)

3. **No semantic understanding** - String matching can't tell if a question actually reveals its answer

## Proposed Solution: Two-Pass System

### Pass 1: Rule-Based (Fast, Cheap)
Improve the heuristics to reduce false positives:

1. **Categorize entities**:
   - `generic_actors`: U.S., USSR, Soviet, NATO, FRG, UK, Mission, Allies, Washington
   - `structural_terms`: Phase I, Phase II, SPC, MBFR
   - `domain_vocabulary`: air manpower, ground force, reductions, proposal, modification
   - `specific_identifiers`: exact names, codenames, cable IDs, specific dates

   Only count `specific_identifiers` as entity leakage.

2. **Distinctive phrase detection**:
   - Flag 3+ word phrases that are unusual/specific
   - Ignore common diplomatic phrases
   - Weight longer matches more heavily

3. **Answer-in-question patterns**:
   - Questions that embed numbers from the claim
   - Questions that use the exact answer phrasing
   - Questions structured as "Did X do Y?" where Y is the claim

### Pass 2: LLM-Based (Batch, Semantic)
After rule-based filtering, send remaining questions to LLM for semantic check:

**Prompt concept:**
```
You are checking if retrieval questions "leak" their answers.

A question LEAKS if:
- It contains the answer or strongly implies it
- Someone could answer it without retrieving any documents
- It uses distinctive phrases that only appear in the target claim

A question is OK if:
- It asks for information without revealing it
- It uses general domain vocabulary
- It requires retrieval to answer

For each question-claim pair, respond:
- OK: Question doesn't leak
- LEAK: Question reveals the answer (explain why)
```

**Batch processing:**
- Collect all questions flagged by Pass 1 (score > 0.15)
- Send in batches of 20-30 to LLM
- LLM returns verdict for each
- Update leakage scores based on LLM judgment

## Implementation Steps

- [ ] 1. Create word lists for generic actors, domain vocab, structural terms
- [ ] 2. Update `computeEntityOverlap()` to categorize entities
- [ ] 3. Update `computeLeakageScore()` with new weights
- [ ] 4. Create `llmLeakageCheck()` function with batch processing
- [ ] 5. Add `--validate-leakage` flag to CLI for LLM pass
- [ ] 6. Update report to show both rule-based and LLM scores

## New Scoring Formula

```
Rule-based score:
  - Specific identifier overlap: 0.25 per identifier (up to 0.5)
  - Distinctive phrase (4+ words): 0.3
  - Answer embedded in question: 0.4
  - Banned terms used: 0.15 per term

LLM validation:
  - If LLM says LEAK: score = max(rule_score, 0.5)
  - If LLM says OK: score = min(rule_score, 0.2)
```

## Files to Modify

1. `src/leakage-checker.ts` - Update rule-based logic
2. `src/llm-leakage-validator.ts` - New file for LLM validation
3. `src/index.ts` - Add --validate-leakage flag
4. `src/report-generator.ts` - Show validation results

## Expected Outcomes

**Before:**
- t4 (95%) - correctly flagged
- t5 (85%) - over-flagged (should be ~20%)
- t7 (58%) - false positive (should be ~10%)
- t1 (44%) - over-flagged (should be ~15%)

**After:**
- t4 → ~70% (LEAK confirmed by LLM)
- t5 → ~20% (domain vocab, OK by LLM)
- t7 → ~10% (good question, OK by LLM)
- t1 → ~15% (generic terms, OK by LLM)
