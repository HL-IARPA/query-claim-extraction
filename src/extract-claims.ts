/**
 * Claim extraction from diplomatic cables
 */

import { getGeminiClient } from './gemini.js';
import type { Cable, Claim, ClaimExtractionResult, LLMResponse } from './types.js';

const CLAIM_EXTRACTION_PROMPT = `You are extracting ATOMIC CLAIMS from a diplomatic cable for evaluation purposes.

DEFINITIONS:
- A claim is a single, checkable proposition (one main predicate/verb)
- Split compound sentences into multiple claims
- Do NOT invent facts not explicitly supported by the text
- Preserve uncertainty markers ("reportedly", "assessed", "possibly", "may") in the claim text

CLAIM TYPES:
- event: Something that happened or is happening
- assessment: An evaluation, judgment, or opinion
- plan: Future intention, proposal, or recommendation
- relationship: Connection between entities (alliances, conflicts, dependencies)
- logistics: Operational details (numbers, dates, locations, procedures)
- attribution: Who said/reported/believes something
- other: Anything that doesn't fit above categories

IMPORTANCE SCALE (1-5):
- 5: Core intelligence value (would be headline in briefing)
- 4: Significant supporting detail
- 3: Useful context
- 2: Minor detail
- 1: Routine/administrative information

EXTRACTION RULES:
1. Extract 5-20 claims depending on cable length and density
2. Focus on claims that would be valuable intelligence
3. Include who/what/when/where when present in the text
4. Keep entities as they appear (don't normalize country names)
5. Preserve the cable's own uncertainty language

OUTPUT FORMAT: Return ONLY valid JSON matching this structure:
{
  "claims": [
    {
      "claim_id": "c1",
      "claim_text": "The full claim as a complete sentence",
      "claim_type": "event|assessment|plan|relationship|logistics|attribution|other",
      "entities": ["Entity1", "Entity2"],
      "time_bounds": {"start": "1975-02", "end": null},
      "importance": 4
    }
  ]
}`;

export interface ClaimExtractionOptions {
  maxClaims?: number;
  minImportance?: number;
}

export async function extractClaims(
  cable: Cable,
  options: ClaimExtractionOptions = {}
): Promise<{ claims: Claim[]; response: LLMResponse }> {
  const { maxClaims = 20, minImportance = 1 } = options;

  const client = getGeminiClient();

  const userPrompt = `Extract atomic claims from the following diplomatic cable.

CABLE ID: ${cable.doc_nbr}
SUBJECT: ${cable.subject}
DATE: ${cable.date}
FROM: ${cable.from_field || 'UNKNOWN'}
TO: ${cable.to_field || 'UNKNOWN'}

--- CABLE BODY ---
${cable.body}
--- END CABLE BODY ---

Extract up to ${maxClaims} claims, focusing on those with importance >= ${minImportance}.`;

  const { data, response } = await client.generateJSON<ClaimExtractionResult>(
    CLAIM_EXTRACTION_PROMPT,
    userPrompt
  );

  // Validate and normalize claims
  const claims: Claim[] = data.claims.map((c, idx) => ({
    claim_id: c.claim_id || `c${idx + 1}`,
    claim_text: c.claim_text,
    claim_type: validateClaimType(c.claim_type),
    entities: c.entities || [],
    time_bounds: c.time_bounds,
    importance: Math.min(5, Math.max(1, c.importance || 3)),
  }));

  return { claims, response };
}

function validateClaimType(type: string): Claim['claim_type'] {
  const valid = ['event', 'assessment', 'plan', 'relationship', 'logistics', 'attribution', 'other'];
  return valid.includes(type) ? (type as Claim['claim_type']) : 'other';
}

/**
 * Format claims for display
 */
export function formatClaims(claims: Claim[]): string {
  const lines: string[] = [];

  // Group by type
  const byType = new Map<string, Claim[]>();
  for (const claim of claims) {
    const type = claim.claim_type;
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(claim);
  }

  // Sort by importance within each type
  for (const [type, typeClaims] of byType) {
    lines.push(`\n[${type.toUpperCase()}]`);
    const sorted = typeClaims.sort((a, b) => b.importance - a.importance);
    for (const claim of sorted) {
      const stars = '★'.repeat(claim.importance) + '☆'.repeat(5 - claim.importance);
      lines.push(`  ${claim.claim_id} ${stars}`);
      lines.push(`     "${claim.claim_text}"`);
      if (claim.entities.length > 0) {
        lines.push(`     Entities: ${claim.entities.join(', ')}`);
      }
      if (claim.time_bounds?.start || claim.time_bounds?.end) {
        const time = [claim.time_bounds.start, claim.time_bounds.end].filter(Boolean).join(' to ');
        lines.push(`     Time: ${time}`);
      }
    }
  }

  return lines.join('\n');
}
