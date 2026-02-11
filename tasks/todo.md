# Query-Claim Extraction Pipeline

## Summary

Build a TypeScript pipeline that takes a diplomatic cable as input and outputs:
1. **Atomic claims** - decomposed facts from the cable
2. **Jeopardy-style questions** - queries targeting each claim without embedding the answer

The goal: create evaluation data for the IARPA mosaic theory project. We "cheat" by generating questions from the target cable to later test if those questions can be answered from other cables in the corpus.

---

## Implementation Plan

### Phase 1: Project Setup
- [ ] Initialize TypeScript project with dependencies
- [ ] Set up Gemini client (copy pattern from extraction-test)
- [ ] Create CSV parser for noforn.csv
- [ ] Define output JSON schema types

### Phase 2: Claim Extraction
- [ ] Design claim extraction prompt (atomic, testable propositions)
- [ ] Implement `extractClaims()` function with JSON mode
- [ ] Define claim types: event, assessment, plan, relationship, logistics, attribution
- [ ] Add importance ranking (1-5 scale)
- [ ] Test on 3-5 sample cables manually

### Phase 3: Question Generation
- [ ] Design question generation prompt (Jeopardy-style, non-leaky)
- [ ] Implement `generateQuestions()` function per claim
- [ ] Define answer types: who, what, when, where, why, how, numeric, list
- [ ] Include hint/constraint fields (time_window, region, org_type)
- [ ] Enforce banned terms (unique identifiers, verbatim phrases)

### Phase 4: Leakage Detection
- [ ] Implement n-gram overlap checker (claim vs question)
- [ ] Implement named entity overlap detection
- [ ] Add "answer in question" pattern detection
- [ ] Create regeneration loop for high-leakage questions
- [ ] Compute leakage_score per question

### Phase 5: Coverage & Audit
- [ ] Verify each claim has ≥1 question
- [ ] Check questions don't reference each other
- [ ] Implement LLM-based audit pass (optional)
- [ ] Generate coverage report

### Phase 6: CLI & Batch Processing
- [ ] Create CLI interface (single cable or batch mode)
- [ ] Add progress tracking for batch processing
- [ ] Output JSONL format for easy downstream consumption
- [ ] Add cost tracking (Gemini tokens)

---

## Output Schema

```typescript
interface ClaimExtractionOutput {
  doc_id: string;
  doc_subject: string;
  claims: Claim[];
  questions: Question[];
  metadata: {
    extraction_timestamp: string;
    model: string;
    total_tokens: number;
    cost_usd: number;
  };
}

interface Claim {
  claim_id: string;
  claim_text: string;
  claim_type: 'event' | 'assessment' | 'plan' | 'relationship' | 'logistics' | 'attribution' | 'other';
  entities: string[];
  time_bounds?: { start?: string; end?: string };
  importance: number; // 1-5
}

interface Question {
  question_id: string;
  targets_claim_id: string;
  question_text: string;
  answer_type: 'who' | 'what' | 'when' | 'where' | 'why' | 'how' | 'numeric' | 'list';
  allowed_hints: string[];
  banned_terms: string[];
  leakage_score: number;
}
```

---

## Key Design Decisions

### 1. Claim Granularity
- One predicate per claim (split compound sentences)
- Preserve uncertainty markers ("reportedly", "assessed", "possibly")
- Include source attribution when present

### 2. Question Non-Leakage Rules
- No full names of specific individuals
- No exact dates (allow time windows like "early 1975", "Q1")
- No verbatim phrases from the cable
- No cable IDs or reference numbers
- Questions should be answerable by someone who hasn't seen the target

### 3. Regeneration Strategy
- If leakage_score > 0.3, regenerate with stricter prompt
- Max 3 regeneration attempts per question
- Flag questions that can't be made non-leaky

---

## Files to Create

```
query-claim-extraction-testing/
├── src/
│   ├── index.ts           # CLI entry point
│   ├── gemini.ts          # Gemini API client
│   ├── extract-claims.ts  # Claim extraction logic
│   ├── generate-questions.ts # Question generation logic
│   ├── leakage-checker.ts # Leakage detection
│   ├── csv-parser.ts      # NOFORN CSV parser
│   └── types.ts           # TypeScript interfaces
├── prompts/
│   ├── claim-extraction.txt
│   └── question-generation.txt
├── output/
│   └── (generated JSONL files)
├── tasks/
│   └── todo.md
├── package.json
├── tsconfig.json
└── .env
```

---

## Example Walkthrough

**Input cable snippet:**
```
MISSION CONSIDERS THAT VIENNA'S PROPOSED MODIFICATION OF THE U.S.
PROPOSAL ON AIR MANPOWER WOULD MAKE THAT PROPOSAL MORE SALEABLE
WITH THE ALLIES. THE MAIN ADVANTAGE IS ITS IMPACT ON THE PRECEDENT
ISSUE, WHICH IS LARGELY AN FRG CONCERN.
```

**Extracted claims:**
1. `c1`: "Vienna proposed a modification to the U.S. air manpower proposal" (event)
2. `c2`: "The U.S. Mission assesses the Vienna modification would be more acceptable to allies" (assessment)
3. `c3`: "The main advantage concerns the precedent issue" (assessment)
4. `c4`: "The precedent issue is primarily a concern of West Germany (FRG)" (relationship)

**Generated questions (non-leaky):**
1. `q1` → c1: "What modifications to allied air manpower proposals were being discussed in MBFR negotiations in early 1975?"
2. `q2` → c2: "How did U.S. diplomatic missions assess the feasibility of modified proposals within NATO during MBFR talks?"
3. `q3` → c3: "What were the primary considerations in evaluating allied proposals during MBFR?"
4. `q4` → c4: "Which NATO members expressed concerns about precedent-setting in phased reduction proposals?"

---

## Next Steps

1. **Approve this plan** - confirm approach before coding
2. **Start with Phase 1-2** - get claim extraction working on a few cables
3. **Manual review** - verify claims are faithful and comprehensive
4. **Iterate prompts** - refine based on failure modes
5. **Add question generation** - Phase 3-4
6. **Batch process** - run on full NOFORN set

---

## Dependencies

- `@google/generative-ai` or raw fetch (like extraction-test)
- `csv-parse` for parsing the NOFORN CSV
- Node.js built-ins (fs, path)

## Environment

- Copy Gemini API key from extraction-test `.env`
- Model: `gemini-2.5-flash` (fast, cheap, good for structured output)
