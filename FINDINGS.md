# Initial Findings: Query-Claim Extraction Pipeline

**Date:** February 2026
**Project:** IARPA BENGAL - Mosaic Theory Testing

---

## Summary

We built an automated pipeline to extract claims from diplomatic cables and generate "Jeopardy-style" questions—queries that target the cable's content without revealing the answers. The goal was to create evaluation queries for RAG systems testing whether classified information could be reconstructed from unclassified sources.

**Key finding:** There is a fundamental tension between asking useful questions and avoiding answer leakage. For many types of diplomatic content, you cannot formulate a substantive question without revealing something about the answer's structure or subject matter.

---

## Methodology

### Pipeline Overview

1. **Input**: Diplomatic cables from the NOFORN corpus (CSV with ~1,294 cables)
2. **Claim Extraction**: Using Gemini 2.5 Flash, we extract atomic claims from each cable—discrete, testable propositions with associated entities, time bounds, and importance ratings
3. **Question Generation**: For each claim, we generate three question styles:
   - **Targeted**: Direct factoid-style questions ("When did X meet with Y?")
   - **Contextual**: Broader situational questions ("What was the state of India-China relations in late 1975?")
   - **Thematic**: Pattern-seeking questions across the corpus ("How do governments typically assess secessionist movements?")
4. **Leakage Detection**: Rule-based scoring that flags questions revealing too much of their answers
5. **Output**: JSON (for RAG pipeline) and Markdown reports (for human review)

### Sample Size

Initial testing on 10 diverse cables covering:
- NATO arms control negotiations (MBFR Option III)
- Sino-Indian border clash
- Bougainville secessionist movement (PNG)
- Taiwan military self-reliance
- Various bilateral diplomatic exchanges

See [output/](output/) for full results.

---

## Finding 1: The Question-Answer Tension

### The Core Problem

To ask a useful question, you must tell the retrieval system *what you're asking about*. But specifying the subject matter inherently reveals information about the answer.

### Examples

**Sino-Indian Clash ([1975NEWDE14555](output/1975NEWDE14555.md))**

The cable reports General Jacob's account of a Chinese ambush that killed Indian patrol members. He claims the Chinese murdered captured soldiers and covered it up.

| Claim | Generated Question | Problem |
|-------|-------------------|---------|
| "General Jacob stated he knew from the account given by the two who escaped that there had been no firing by the Indian patrol." | "What was the general's source of information **indicating no firing by the Indian patrol**?" | Reveals the key finding (no Indian firing) in the question itself |
| "General Jacob stated he would not forget what had been done to his soldiers." | "What did the general state **he would not forget** regarding his soldiers?" | Reveals the emotional commitment/memory structure |

**Taiwan Military Self-Reliance ([1975TAIPEI06471](output/1975TAIPEI06471.md))**

The cable assesses Taiwan's shift toward domestic weapons production amid concerns about US reliability.

| Claim | Generated Question | Problem |
|-------|-------------------|---------|
| "The cable authors expect the ROC to continue its efforts to expand domestic production." | "What ongoing effort do the cable authors **expect the ROC to maintain** concerning its internal manufacturing capabilities?" | Reveals it's an expectation/prediction about manufacturing |
| "Minister Kao said Taiwan has plans to produce tanks in the near future." | "What specific type of **armored ground combat vehicle** does Taiwan reportedly plan to manufacture?" | "Armored ground combat vehicle" essentially means "tank" |

### Why This Happens

Diplomatic cables often contain:
- **Assessments and predictions** ("We expect X to do Y") — Hard to ask about without revealing the prediction structure
- **Attributed statements** ("X said Y about Z") — The attribution itself is often the substance
- **Emotional or dramatic content** ("X went into a towering rage") — The tone is newsworthy and hard to neutralize

For these claim types, the *structure* of the answer is as revealing as the specific details.

---

## Finding 2: Technical Content Works Better

Cables with procedural or technical content produce cleaner questions.

**NATO MBFR ([1975NATO03493](output/1975NATO03493.md))**

This cable discusses Option III arms reduction negotiations—sequencing of work, committee procedures, numerical ceilings.

| Claim | Generated Question | Leakage |
|-------|-------------------|---------|
| "USMISSION NATO believes U.S. ability to accept an illustrative sub-ceiling of 700,000 on ground forces... would assure FRG acceptance" | "What specific numerical agreement on troop levels is believed to secure a key nation's endorsement?" | 0% |
| "The FRG and others are concerned that the East will cite U.S. nuclear withdrawals in Phase I as a precedent for further nuclear reductions in Phase II." | "What concern do some Western nations have about the initial removal of a particular nation's nuclear assets?" | 0% |

**Why it works**: The substance is in specific numbers, entity names, and procedural details—all of which can be abstracted without losing the question's utility.

### Leakage by Cable Type

| Cable Type | Avg Leakage | High-Leakage Questions |
|------------|-------------|------------------------|
| Technical/procedural (NATO MBFR) | ~2% | 1 of 28 |
| Assessment-heavy (Taiwan) | ~23% | 11 of 28 |
| Emotionally charged (Sino-Indian) | ~17% | 4 of 28 |

---

## Finding 3: Open Question on Contextual Queries

The contextual questions are the most promising for mosaic theory testing:

> "What was the state of border security and incidents between India and China in late 1975?"

> "What were the key dynamics shaping external support for regional autonomy movements in the South Pacific during the mid-1970s?"

These don't reveal specific cable content and could plausibly retrieve related documents that *together* reconstruct the classified information.

**However**: It remains unclear whether:

1. These queries would actually retrieve documents with relevant information
2. Retrieved documents would contain enough detail to reconstruct the source cable's claims
3. The reconstruction would be meaningfully "classified" information vs. already-public context

This is the key unknown that requires actual RAG evaluation to resolve. Our intuition is that reconstruction via contextual queries is **unlikely for most claims**—the cables contain specific details (names, dates, numbers, assessments) that wouldn't appear in broader contextual documents.

---

## Implications

### For RAG Evaluation

1. **Targeted questions** may only test whether the RAG system can retrieve the source document itself—not whether mosaic reconstruction is possible
2. **Contextual questions** are more interesting for mosaic theory but may produce negative results (no reconstruction possible)
3. **High-leakage questions** should be filtered or regenerated before use in evaluation

### For Mosaic Theory Generally

The difficulty of formulating non-leaking questions suggests that **the "questions" themselves may be the intelligence**. An adversary who knows *what to ask* already has significant information. The mosaic theory concern may be less about RAG retrieval and more about knowing the right queries to run.

---

## Next Steps

1. **Run RAG evaluation** with generated questions against unclassified corpus
2. **Measure reconstruction rates** for targeted vs. contextual questions
3. **Assess whether negative results** (no reconstruction) are due to query quality or genuine information compartmentalization

---

## Repository

- Pipeline code: [src/](src/)
- Sample outputs: [output/](output/)
- Usage instructions: [README.md](README.md)
