/**
 * Question generation for claims
 *
 * Two styles of questions:
 * 1. TARGETED - Directly probes a specific claim (factoid-style)
 * 2. CONTEXTUAL - Asks about broader situation that might reveal the claim
 */

import { getGeminiClient } from './gemini.js';
import type { Claim, Question, QuestionGenerationResult, LLMResponse, Cable, QuestionStyle } from './types.js';

// =============================================================================
// Targeted Questions (Factoid-style)
// =============================================================================

const TARGETED_QUESTION_PROMPT = `You write TARGETED retrieval questions that directly probe specific claims from diplomatic cables.

These are "factoid" questions - they ask for the specific information in the claim, but without giving away the answer.

CRITICAL RULES:
1. Do NOT include the answer in the question
2. Do NOT copy distinctive phrases from the claim
3. Do NOT use unique identifiers (full names, exact codenames, cable IDs)
4. Do NOT use exact dates or numbers (use ranges: "early 1975", "approximately 60,000")
5. The question should directly target the claim's core information

GOOD TARGETED QUESTIONS:
- "What specific concerns did Western European nations raise about phased force reductions?"
- "What were the estimated troop reduction numbers being discussed in early 1975?"
- "How did the U.S. Mission assess the proposal's chances of allied acceptance?"

OUTPUT FORMAT: Return ONLY valid JSON:
{
  "questions": [
    {
      "question_id": "t1",
      "targets_claim_id": "c1",
      "question_text": "...",
      "question_style": "targeted",
      "answer_type": "who|what|when|where|why|how|numeric|list",
      "allowed_hints": ["time_window", "region"],
      "banned_terms": ["term1", "term2"]
    }
  ]
}`;

// =============================================================================
// Contextual Questions (Exploratory)
// =============================================================================

const CONTEXTUAL_QUESTION_PROMPT = `You write CONTEXTUAL retrieval questions that explore the broader situation surrounding diplomatic claims.

These questions DON'T directly ask for the claim's information. Instead, they ask about:
- The general state of affairs in a domain
- Relationships between actors
- Trends and patterns over time
- Background context that might reveal the claim indirectly

The idea: an analyst asking these broader questions might retrieve documents that, when pieced together, reveal the specific claim (mosaic theory).

CONTEXTUAL QUESTION PATTERNS:
- "What was the state of [negotiation type] between [parties] during [time period]?"
- "How were [actor type] responding to [category of proposals] in [region/context]?"
- "What tensions existed among [alliance members] regarding [issue area]?"
- "What were the key dynamics shaping [policy domain] in [time window]?"
- "How did [event/development] affect relations between [parties]?"

GOOD CONTEXTUAL QUESTIONS:
- "What was the general state of NATO-Warsaw Pact arms reduction negotiations in early 1975?"
- "How were European allies responding to superpower-led force reduction proposals?"
- "What internal tensions existed within NATO regarding burden-sharing in the mid-1970s?"
- "What factors were shaping U.S. diplomatic strategy toward European defense arrangements?"

BAD CONTEXTUAL QUESTIONS (too specific):
- "What did the U.S. Mission recommend about the Vienna proposal?" (too targeted)
- "What percentage reduction was proposed for FRG air manpower?" (factoid, not contextual)

OUTPUT FORMAT: Return ONLY valid JSON:
{
  "questions": [
    {
      "question_id": "x1",
      "targets_claim_ids": ["c1", "c2", "c3"],
      "question_text": "...",
      "question_style": "contextual",
      "answer_type": "what|how|why",
      "allowed_hints": ["time_window", "region", "topic_area"],
      "banned_terms": ["specific_term1"]
    }
  ]
}`;

// =============================================================================
// Thematic Questions (Pattern-seeking)
// =============================================================================

const THEMATIC_QUESTION_PROMPT = `You write THEMATIC questions that explore patterns, themes, and relationships across diplomatic reporting.

These questions are even more abstract than contextual questions. They ask about:
- Recurring themes in diplomatic communications
- Patterns of behavior or decision-making
- Underlying motivations and strategic calculus
- Cross-cutting issues that appear in multiple contexts

The idea: these questions cast a wide net and might retrieve diverse documents that collectively illuminate the specific situation.

THEMATIC QUESTION PATTERNS:
- "How did [actor type] typically approach [type of negotiation] during the Cold War?"
- "What patterns emerged in allied consultations on [issue category]?"
- "What strategic considerations drove [country's] positions on [policy area]?"
- "How did concerns about precedent-setting affect [type of negotiations]?"

GOOD THEMATIC QUESTIONS:
- "How did concerns about military capability affect allied positions on force reduction proposals?"
- "What role did precedent-setting play in multilateral arms negotiations?"
- "How did smaller NATO members influence U.S. diplomatic initiatives?"
- "What patterns characterized U.S. efforts to build allied consensus on security issues?"

OUTPUT FORMAT: Return ONLY valid JSON:
{
  "questions": [
    {
      "question_id": "th1",
      "targets_claim_ids": ["c1", "c5", "c8"],
      "question_text": "...",
      "question_style": "thematic",
      "answer_type": "what|how|why",
      "allowed_hints": ["topic_area", "org_type"],
      "banned_terms": []
    }
  ]
}`;

// =============================================================================
// Generation Functions
// =============================================================================

export interface QuestionGenerationOptions {
  styles?: QuestionStyle[];  // Which styles to generate (default: all)
  questionsPerClaim?: number;  // For targeted questions
  contextualCount?: number;    // Number of contextual questions
  thematicCount?: number;      // Number of thematic questions
  cableContext?: Cable;
}

/**
 * Generate all question types for a set of claims
 */
export async function generateQuestions(
  claims: Claim[],
  options: QuestionGenerationOptions = {}
): Promise<{ questions: Question[]; response: LLMResponse }> {
  const {
    styles = ['targeted', 'contextual', 'thematic'],
    questionsPerClaim = 1,
    contextualCount = 5,
    thematicCount = 3,
    cableContext,
  } = options;

  const allQuestions: Question[] = [];
  let totalTokens = 0;
  let totalCost = 0;

  // Generate targeted questions
  if (styles.includes('targeted')) {
    const { questions, response } = await generateTargetedQuestions(claims, {
      questionsPerClaim,
      cableContext,
    });
    allQuestions.push(...questions);
    totalTokens += response.tokens;
    totalCost += response.cost_usd;
  }

  // Generate contextual questions
  if (styles.includes('contextual')) {
    const { questions, response } = await generateContextualQuestions(claims, {
      count: contextualCount,
      cableContext,
    });
    allQuestions.push(...questions);
    totalTokens += response.tokens;
    totalCost += response.cost_usd;
  }

  // Generate thematic questions
  if (styles.includes('thematic')) {
    const { questions, response } = await generateThematicQuestions(claims, {
      count: thematicCount,
      cableContext,
    });
    allQuestions.push(...questions);
    totalTokens += response.tokens;
    totalCost += response.cost_usd;
  }

  return {
    questions: allQuestions,
    response: {
      content: '',
      tokens: totalTokens,
      prompt_tokens: 0,
      completion_tokens: 0,
      cost_usd: totalCost,
    },
  };
}

/**
 * Generate targeted (factoid) questions - one per claim
 */
async function generateTargetedQuestions(
  claims: Claim[],
  options: { questionsPerClaim?: number; cableContext?: Cable }
): Promise<{ questions: Question[]; response: LLMResponse }> {
  const { questionsPerClaim = 1, cableContext } = options;
  const client = getGeminiClient();

  const claimsText = formatClaimsForPrompt(claims);
  const contextInfo = formatCableContext(cableContext);

  const userPrompt = `Generate ${questionsPerClaim} TARGETED question(s) per claim.

${contextInfo}

CLAIMS TO TARGET:
${claimsText}

Each question should directly probe the claim's core information without giving away the answer.`;

  const { data, response } = await client.generateJSON<QuestionGenerationResult>(
    TARGETED_QUESTION_PROMPT,
    userPrompt
  );

  const questions: Question[] = data.questions.map((q, idx) => ({
    question_id: q.question_id || `t${idx + 1}`,
    targets_claim_id: q.targets_claim_id,
    targets_claim_ids: [q.targets_claim_id],
    question_text: q.question_text,
    question_style: 'targeted' as QuestionStyle,
    answer_type: validateAnswerType(q.answer_type),
    allowed_hints: q.allowed_hints || [],
    banned_terms: q.banned_terms || [],
    leakage_score: 0,
  }));

  return { questions, response };
}

/**
 * Generate contextual (exploratory) questions - about the broader situation
 */
async function generateContextualQuestions(
  claims: Claim[],
  options: { count?: number; cableContext?: Cable }
): Promise<{ questions: Question[]; response: LLMResponse }> {
  const { count = 5, cableContext } = options;
  const client = getGeminiClient();

  // Extract key themes from claims
  const themes = extractThemes(claims);
  const claimsText = formatClaimsForPrompt(claims);
  const contextInfo = formatCableContext(cableContext);

  const userPrompt = `Generate ${count} CONTEXTUAL questions that explore the broader situation.

${contextInfo}

KEY THEMES IDENTIFIED:
${themes.join('\n')}

CLAIMS (for reference - questions should NOT directly target these):
${claimsText}

Generate broad, exploratory questions that:
1. Ask about the general state of affairs, not specific facts
2. Could retrieve documents that INDIRECTLY reveal the claims
3. Sound like questions an analyst would ask to understand context
4. Don't give away that you're looking for specific information

For each question, list which claims it MIGHT help reveal (targets_claim_ids).`;

  const { data, response } = await client.generateJSON<QuestionGenerationResult>(
    CONTEXTUAL_QUESTION_PROMPT,
    userPrompt
  );

  const questions: Question[] = data.questions.map((q, idx) => ({
    question_id: q.question_id || `x${idx + 1}`,
    targets_claim_id: q.targets_claim_ids?.[0] || q.targets_claim_id || 'general',
    targets_claim_ids: q.targets_claim_ids || [q.targets_claim_id].filter(Boolean),
    question_text: q.question_text,
    question_style: 'contextual' as QuestionStyle,
    answer_type: validateAnswerType(q.answer_type),
    allowed_hints: q.allowed_hints || [],
    banned_terms: q.banned_terms || [],
    leakage_score: 0,
  }));

  return { questions, response };
}

/**
 * Generate thematic questions - about patterns and relationships
 */
async function generateThematicQuestions(
  claims: Claim[],
  options: { count?: number; cableContext?: Cable }
): Promise<{ questions: Question[]; response: LLMResponse }> {
  const { count = 3, cableContext } = options;
  const client = getGeminiClient();

  const themes = extractThemes(claims);
  const claimsText = formatClaimsForPrompt(claims);
  const contextInfo = formatCableContext(cableContext);

  const userPrompt = `Generate ${count} THEMATIC questions about patterns and relationships.

${contextInfo}

KEY THEMES IDENTIFIED:
${themes.join('\n')}

CLAIMS (for reference only):
${claimsText}

Generate abstract, pattern-seeking questions that:
1. Ask about recurring themes, strategic patterns, or typical behaviors
2. Cast a wide net across the diplomatic corpus
3. Could retrieve diverse documents that collectively illuminate the situation
4. Are general enough to apply to multiple similar situations

For each question, list which claims it MIGHT help contextualize (targets_claim_ids).`;

  const { data, response } = await client.generateJSON<QuestionGenerationResult>(
    THEMATIC_QUESTION_PROMPT,
    userPrompt
  );

  const questions: Question[] = data.questions.map((q, idx) => ({
    question_id: q.question_id || `th${idx + 1}`,
    targets_claim_id: q.targets_claim_ids?.[0] || q.targets_claim_id || 'general',
    targets_claim_ids: q.targets_claim_ids || [q.targets_claim_id].filter(Boolean),
    question_text: q.question_text,
    question_style: 'thematic' as QuestionStyle,
    answer_type: validateAnswerType(q.answer_type),
    allowed_hints: q.allowed_hints || [],
    banned_terms: q.banned_terms || [],
    leakage_score: 0,
  }));

  return { questions, response };
}

// =============================================================================
// Helper Functions
// =============================================================================

function formatClaimsForPrompt(claims: Claim[]): string {
  return claims
    .map((c) => {
      let text = `${c.claim_id}: "${c.claim_text}"`;
      text += `\n   Type: ${c.claim_type}`;
      text += `\n   Entities: ${c.entities.join(', ') || 'none'}`;
      if (c.time_bounds?.start || c.time_bounds?.end) {
        text += `\n   Time: ${c.time_bounds.start || '?'} to ${c.time_bounds.end || '?'}`;
      }
      text += `\n   Importance: ${c.importance}/5`;
      return text;
    })
    .join('\n\n');
}

function formatCableContext(cable?: Cable): string {
  if (!cable) return '';
  return `
CABLE CONTEXT (DO NOT leak these specifics in questions):
- Subject: ${cable.subject}
- Date: ${cable.date}
- From: ${cable.from_field || 'UNKNOWN'}
- Classification: ${cable.classification || 'UNKNOWN'}
`;
}

function extractThemes(claims: Claim[]): string[] {
  // Extract unique entities and group by type
  const entities = new Set<string>();
  const claimTypes = new Set<string>();

  for (const claim of claims) {
    claimTypes.add(claim.claim_type);
    for (const entity of claim.entities) {
      entities.add(entity);
    }
  }

  const themes: string[] = [];

  // Add entity-based themes
  const entityList = [...entities].slice(0, 10);
  if (entityList.length > 0) {
    themes.push(`Key actors: ${entityList.join(', ')}`);
  }

  // Add claim-type themes
  if (claimTypes.has('assessment')) themes.push('Diplomatic assessments and evaluations');
  if (claimTypes.has('plan')) themes.push('Proposed actions and recommendations');
  if (claimTypes.has('relationship')) themes.push('Inter-party relationships and alliances');
  if (claimTypes.has('logistics')) themes.push('Specific numbers, dates, and operational details');
  if (claimTypes.has('event')) themes.push('Events and developments');

  return themes;
}

function validateAnswerType(type: string): Question['answer_type'] {
  const valid = ['who', 'what', 'when', 'where', 'why', 'how', 'numeric', 'list'];
  return valid.includes(type) ? (type as Question['answer_type']) : 'what';
}

/**
 * Format questions for display, grouped by style
 */
export function formatQuestions(questions: Question[], claims: Claim[]): string {
  const lines: string[] = [];
  const claimMap = new Map(claims.map((c) => [c.claim_id, c]));

  // Group by style
  const byStyle = new Map<QuestionStyle, Question[]>();
  for (const q of questions) {
    const style = q.question_style || 'targeted';
    if (!byStyle.has(style)) byStyle.set(style, []);
    byStyle.get(style)!.push(q);
  }

  const styleLabels: Record<QuestionStyle, string> = {
    targeted: 'TARGETED (Factoid)',
    contextual: 'CONTEXTUAL (Exploratory)',
    thematic: 'THEMATIC (Pattern-seeking)',
  };

  for (const [style, styleQuestions] of byStyle) {
    lines.push(`\n${'─'.repeat(60)}`);
    lines.push(styleLabels[style] || style.toUpperCase());
    lines.push('─'.repeat(60));

    for (const q of styleQuestions) {
      const targetIds = q.targets_claim_ids || [q.targets_claim_id];
      lines.push(`\n${q.question_id} → ${targetIds.join(', ')}`);
      lines.push(`  Q: "${q.question_text}"`);
      lines.push(`  Type: ${q.answer_type} | Hints: ${q.allowed_hints.join(', ') || 'none'}`);

      if (q.banned_terms.length > 0) {
        lines.push(`  Banned: ${q.banned_terms.slice(0, 5).join(', ')}${q.banned_terms.length > 5 ? '...' : ''}`);
      }

      if (q.leakage_score > 0) {
        const indicator = q.leakage_score > 0.3 ? '⚠️ ' : '';
        lines.push(`  ${indicator}Leakage: ${(q.leakage_score * 100).toFixed(1)}%`);
      }

      // Show target claim snippets for targeted questions
      if (style === 'targeted') {
        const claim = claimMap.get(q.targets_claim_id);
        if (claim) {
          lines.push(`  Target: "${claim.claim_text.slice(0, 70)}..."`);
        }
      }
    }
  }

  return lines.join('\n');
}
