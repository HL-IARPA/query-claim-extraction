# Query-Claim Extraction Pipeline

Pipeline to extract atomic claims from diplomatic cables and generate "Jeopardy-style" questions for RAG evaluation. Part of the IARPA BENGAL project testing mosaic theory - whether classified information can be reconstructed from unclassified sources.

## Overview

Given a diplomatic cable, this pipeline:
1. **Extracts claims** - Atomic, testable propositions from the cable text
2. **Generates questions** - Three styles of questions targeting the claims without revealing answers
3. **Checks for leakage** - Detects if questions give away their own answers
4. **Outputs reports** - JSON for RAG pipeline, Markdown for human review

## Question Styles

| Style | Purpose | Example |
|-------|---------|---------|
| **Targeted** | Factoid-style questions probing specific claims | "What was the date of the meeting between the two officials?" |
| **Contextual** | Broader situational questions (mosaic queries) | "What was the state of US-China relations in late 1975?" |
| **Thematic** | Pattern-seeking questions across the corpus | "How do allied nations typically respond to shifts in major power commitments?" |

## Setup

```bash
# Install dependencies
npm install

# Create .env file with your Gemini API key
echo "GEMINI_API_KEY=your_key_here" > .env
```

## Usage

### Process a single cable by ID

```bash
npx tsx src/index.ts --csv /path/to/noforn.csv --doc-id 1975TAIPEI06471
```

### Process multiple cables

```bash
# Process first 10 cables
npx tsx src/index.ts --csv /path/to/noforn.csv --limit 10

# Process cables 50-60
npx tsx src/index.ts --csv /path/to/noforn.csv --offset 50 --limit 10
```

### Options

| Flag | Description |
|------|-------------|
| `--csv <path>` | Path to input CSV file (required) |
| `--doc-id <id>` | Process specific cable by doc_id |
| `--limit <n>` | Process only first n cables |
| `--offset <n>` | Skip first n cables |
| `--validate-leakage` | Run LLM-based leakage validation (slower, more accurate) |
| `--targeted-only` | Generate only targeted questions |
| `--contextual-only` | Generate only contextual questions |
| `--claims-only` | Extract claims without generating questions |
| `--verbose` | Show detailed processing info |

## Output

Results are written to the `output/` directory:

- `{doc_id}.json` - Structured data for RAG pipeline
- `{doc_id}.md` - Human-readable report
- `extractions.jsonl` - Append-only log of all extractions

### JSON Structure

```json
{
  "doc_id": "1975TAIPEI06471",
  "subject": "GROC EMPHASIZES MILITARY SELF-RELIANCE",
  "date": "1975-10-02",
  "claims": [
    {
      "claim_id": "c1",
      "claim_text": "Minister Kao discussed...",
      "claim_type": "attribution",
      "importance": 4,
      "entities": ["Minister Kao", "GROC"],
      "time_range": { "start": "1975-09-30", "end": "1975-09-30" }
    }
  ],
  "questions": [
    {
      "question_id": "t1",
      "targets_claim_id": "c1",
      "question_text": "What topic did a high-ranking defense official discuss...",
      "question_style": "targeted",
      "answer_type": "entity",
      "leakage_score": 0.2
    }
  ]
}
```

## Leakage Detection

The pipeline uses a two-pass leakage detection system:

1. **Rule-based** (fast) - Checks for:
   - Specific entity overlap (not generic terms like "U.S." or "NATO")
   - Distinctive phrases from the claim appearing in the question
   - Numbers/percentages embedded in questions
   - Banned terms that directly reveal the answer

2. **LLM-based** (optional, `--validate-leakage`) - Semantic check asking if an analyst could guess the answer from the question alone

Questions with leakage > 30% are flagged for review.

## Cost

Uses Gemini 2.5 Flash. Typical cost: ~$0.005 per cable (~20 claims, ~28 questions).

## Input Format

Expects CSV with columns:
- `doc_id` - Cable identifier (e.g., "1975TAIPEI06471")
- `subject` - Cable subject line
- `date` - Cable date
- `from` - Originating embassy/office
- `to` - Destination
- `classification` - Security classification
- `body` - Full cable text
