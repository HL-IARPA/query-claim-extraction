/**
 * Leakage detection for questions (improved version)
 *
 * Two-pass system:
 * 1. Rule-based heuristics (fast, catches obvious issues)
 * 2. LLM validation (semantic, catches subtle issues)
 */

import type { Claim, Question, LeakageCheckResult } from './types.js';

// =============================================================================
// Word Lists for Categorization
// =============================================================================

// Generic actors that are OK to mention (not leakage)
const GENERIC_ACTORS = new Set([
  'u.s.', 'us', 'united states', 'america', 'american',
  'ussr', 'soviet', 'soviets', 'russia', 'russian',
  'nato', 'warsaw pact', 'pact',
  'frg', 'west germany', 'germany', 'german',
  'uk', 'united kingdom', 'britain', 'british',
  'france', 'french',
  'mission', 'embassy', 'consulate',
  'allies', 'allied', 'alliance',
  'washington', 'moscow', 'bonn', 'london', 'paris',
  'european', 'europe', 'western', 'eastern',
  'east', 'west',
]);

// Structural/procedural terms (not leakage)
const STRUCTURAL_TERMS = new Set([
  'phase i', 'phase ii', 'phase 1', 'phase 2',
  'spc', 'mbfr', 'salt',
  'proposal', 'modification', 'amendment',
  'negotiation', 'negotiations', 'talks',
  'agreement', 'treaty', 'accord',
  'reduction', 'reductions',
  'ceiling', 'limit', 'limits',
]);

// Domain vocabulary (not leakage)
const DOMAIN_VOCABULARY = new Set([
  'air manpower', 'ground force', 'ground forces',
  'tank army', 'military', 'forces',
  'combat capability', 'combat readiness',
  'troop', 'troops', 'personnel',
  'precedent', 'concern', 'concerns',
  'recommendation', 'recommends',
  'assessment', 'assesses', 'considers',
  'voluntary', 'non-voluntary', 'involuntary',
]);

// =============================================================================
// Main Leakage Check
// =============================================================================

export function checkLeakage(question: Question, claim: Claim): LeakageCheckResult {
  const issues: string[] = [];

  const qText = normalizeText(question.question_text);
  const cText = normalizeText(claim.claim_text);
  const qWords = qText.split(/\s+/);
  const cWords = cText.split(/\s+/);

  // 1. Check for specific identifiers (not generic actors)
  const specificOverlap = computeSpecificEntityOverlap(question.question_text, claim.entities);
  if (specificOverlap > 0) {
    issues.push(`Specific identifier leak: ${specificOverlap} specific terms`);
  }

  // 2. Check for distinctive phrases (4+ words, not domain vocab)
  const distinctiveMatch = hasDistinctivePhrase(qWords, cWords);
  if (distinctiveMatch.found) {
    issues.push(`Distinctive phrase: "${distinctiveMatch.phrase}"`);
  }

  // 3. Check for answer-in-question patterns
  const answerEmbedded = checkAnswerEmbedded(question.question_text, claim.claim_text);
  if (answerEmbedded.found) {
    issues.push(`Answer embedded: ${answerEmbedded.reason}`);
  }

  // 4. Check banned terms (from the LLM's own list)
  const bannedFound = checkBannedTerms(question.question_text, question.banned_terms);
  if (bannedFound.length > 0) {
    // Filter out generic terms from banned list
    const trulyBanned = bannedFound.filter(term => !isGenericTerm(term));
    if (trulyBanned.length > 0) {
      issues.push(`Banned terms: ${trulyBanned.join(', ')}`);
    }
  }

  // Compute score with new weights
  const score = computeLeakageScore(
    specificOverlap,
    distinctiveMatch.found,
    answerEmbedded.found,
    bannedFound.filter(t => !isGenericTerm(t)).length
  );

  return {
    score,
    issues,
    ngram_overlap: 0, // deprecated
    entity_overlap: specificOverlap,
    verbatim_match: distinctiveMatch.found,
  };
}

// =============================================================================
// Entity Categorization
// =============================================================================

function isGenericTerm(term: string): boolean {
  const lower = term.toLowerCase();

  // Check against our word lists
  if (GENERIC_ACTORS.has(lower)) return true;
  if (STRUCTURAL_TERMS.has(lower)) return true;

  // Check for partial matches in domain vocabulary
  for (const vocab of DOMAIN_VOCABULARY) {
    if (lower.includes(vocab) || vocab.includes(lower)) return true;
  }

  // Check for common patterns
  if (/^(the |a |an )?[a-z]+ (proposal|modification|concern|recommendation)$/i.test(term)) {
    return true;
  }

  return false;
}

function computeSpecificEntityOverlap(questionText: string, entities: string[]): number {
  const qLower = questionText.toLowerCase();
  let overlap = 0;

  for (const entity of entities) {
    if (entity.length < 3) continue;

    // Skip generic terms
    if (isGenericTerm(entity)) continue;

    // Check if entity appears in question
    if (qLower.includes(entity.toLowerCase())) {
      overlap++;
    }
  }

  return overlap;
}

// =============================================================================
// Distinctive Phrase Detection
// =============================================================================

function hasDistinctivePhrase(qWords: string[], cWords: string[]): { found: boolean; phrase: string } {
  // Look for 4+ word sequences that appear in both
  // but filter out common diplomatic phrases

  for (let len = 6; len >= 4; len--) {
    for (let i = 0; i <= qWords.length - len; i++) {
      const phrase = qWords.slice(i, i + len).join(' ');

      // Skip if it's mostly stopwords or generic terms
      const meaningfulWords = qWords.slice(i, i + len).filter(w => !isStopWord(w) && !isGenericTerm(w));
      if (meaningfulWords.length < 2) continue;

      // Check if this phrase appears in claim
      const cText = cWords.join(' ');
      if (cText.includes(phrase)) {
        return { found: true, phrase };
      }
    }
  }

  return { found: false, phrase: '' };
}

// =============================================================================
// Answer-in-Question Detection
// =============================================================================

function checkAnswerEmbedded(question: string, claim: string): { found: boolean; reason: string } {
  const qLower = question.toLowerCase();
  const cLower = claim.toLowerCase();

  // Pattern 1: Question contains specific numbers from claim
  const claimNumbers = claim.match(/\b\d[\d,]*\b/g) || [];
  for (const num of claimNumbers) {
    if (qLower.includes(num) && num.length > 2) {
      return { found: true, reason: `Contains number "${num}" from claim` };
    }
  }

  // Pattern 2: Question contains specific percentages
  const claimPercentages = claim.match(/\d+\s*percent/gi) || [];
  for (const pct of claimPercentages) {
    if (qLower.includes(pct.toLowerCase())) {
      return { found: true, reason: `Contains percentage "${pct}" from claim` };
    }
  }

  // Pattern 3: Question restates the claim as a yes/no
  if (/^(did|does|is|was|were|has|have|will|would|could|should)\s/i.test(question)) {
    // Check if the rest of the question closely matches the claim
    const qContent = qLower.replace(/^(did|does|is|was|were|has|have|will|would|could|should)\s+/i, '');
    const overlap = computeWordOverlap(qContent.split(/\s+/), cLower.split(/\s+/));
    if (overlap > 0.5) {
      return { found: true, reason: 'Yes/no question restates claim' };
    }
  }

  return { found: false, reason: '' };
}

function computeWordOverlap(words1: string[], words2: string[]): number {
  const set1 = new Set(words1.filter(w => !isStopWord(w)));
  const set2 = new Set(words2.filter(w => !isStopWord(w)));

  if (set1.size === 0) return 0;

  let overlap = 0;
  for (const word of set1) {
    if (set2.has(word)) overlap++;
  }

  return overlap / set1.size;
}

// =============================================================================
// Scoring
// =============================================================================

function computeLeakageScore(
  specificOverlap: number,
  distinctivePhrase: boolean,
  answerEmbedded: boolean,
  bannedTermCount: number
): number {
  let score = 0;

  // Specific identifier overlap: 0.2 per identifier (up to 0.4)
  score += Math.min(specificOverlap * 0.2, 0.4);

  // Distinctive phrase match: 0.35
  if (distinctivePhrase) score += 0.35;

  // Answer embedded: 0.4
  if (answerEmbedded) score += 0.4;

  // Banned terms (non-generic): 0.1 per term (up to 0.3)
  score += Math.min(bannedTermCount * 0.1, 0.3);

  return Math.min(score, 1.0);
}

// =============================================================================
// Helpers
// =============================================================================

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isStopWord(word: string): boolean {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can',
    'that', 'which', 'who', 'whom', 'this', 'these', 'those', 'it', 'its',
    'what', 'when', 'where', 'why', 'how', 'about', 'regarding', 'concerning',
  ]);
  return stopWords.has(word.toLowerCase());
}

function checkBannedTerms(text: string, bannedTerms: string[]): string[] {
  const textLower = text.toLowerCase();
  return bannedTerms.filter((term) => textLower.includes(term.toLowerCase()));
}

// =============================================================================
// Batch Processing
// =============================================================================

export function checkAllLeakage(questions: Question[], claims: Claim[]): Question[] {
  const claimMap = new Map(claims.map((c) => [c.claim_id, c]));

  return questions.map((q) => {
    const targetIds = q.targets_claim_ids || [q.targets_claim_id];
    const targetClaims = targetIds
      .map((id) => claimMap.get(id))
      .filter((c): c is Claim => c !== undefined);

    if (targetClaims.length === 0) {
      return { ...q, leakage_score: 0 };
    }

    // Check against all target claims, take max
    let maxScore = 0;
    for (const claim of targetClaims) {
      const result = checkLeakage(q, claim);
      maxScore = Math.max(maxScore, result.score);
    }

    // Contextual/thematic questions are intentionally broader
    const styleDiscount = q.question_style === 'targeted' ? 1.0 : 0.6;
    const adjustedScore = maxScore * styleDiscount;

    return { ...q, leakage_score: adjustedScore };
  });
}

export function filterLowLeakage(questions: Question[], threshold = 0.3): Question[] {
  return questions.filter((q) => q.leakage_score <= threshold);
}

export function getHighLeakageQuestions(questions: Question[], threshold = 0.3): Question[] {
  return questions.filter((q) => q.leakage_score > threshold);
}

// =============================================================================
// Report Generation
// =============================================================================

export function generateLeakageReport(questions: Question[], claims: Claim[]): string {
  const claimMap = new Map(claims.map((c) => [c.claim_id, c]));
  const lines: string[] = ['Leakage Analysis Report', '='.repeat(50)];

  let totalLeakage = 0;
  let highLeakageCount = 0;

  for (const q of questions) {
    const claim = claimMap.get(q.targets_claim_id);
    if (!claim) continue;

    const result = checkLeakage(q, claim);
    totalLeakage += result.score;
    if (result.score > 0.3) highLeakageCount++;

    if (result.issues.length > 0) {
      lines.push(`\n${q.question_id} (score: ${(result.score * 100).toFixed(1)}%)`);
      lines.push(`  Q: "${q.question_text.slice(0, 60)}..."`);
      for (const issue of result.issues) {
        lines.push(`  ⚠️  ${issue}`);
      }
    }
  }

  lines.push('\n' + '='.repeat(50));
  lines.push(`Total questions: ${questions.length}`);
  lines.push(`High leakage (>30%): ${highLeakageCount}`);
  lines.push(`Average leakage: ${((totalLeakage / questions.length) * 100).toFixed(1)}%`);

  return lines.join('\n');
}
