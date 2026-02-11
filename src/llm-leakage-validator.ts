/**
 * LLM-based leakage validation
 *
 * Uses an LLM to semantically check if questions leak their answers.
 * Run as a batch operation after rule-based checks.
 */

import { getGeminiClient } from './gemini.js';
import type { Question, Claim, LLMResponse } from './types.js';

const VALIDATION_PROMPT = `You are evaluating retrieval questions for "leakage" - whether they give away their own answers.

A question LEAKS if:
- It contains or strongly implies the answer
- Someone could answer it without retrieving any documents
- It uses distinctive phrases that essentially state the fact being asked about
- It's structured as "Did X do Y?" where Y is exactly what we're testing

A question is OK if:
- It asks for information without revealing it
- It uses general domain vocabulary (countries, organizations, common terms)
- It genuinely requires document retrieval to answer
- An analyst could reasonably ask this question without knowing the answer

For each question-claim pair, you will evaluate and return a JSON verdict.

IMPORTANT: Be lenient with generic diplomatic terms. Words like "U.S.", "NATO", "allies", "proposal", "modification", "air manpower", "ground forces" are domain vocabulary, NOT leakage.`;

interface ValidationResult {
  question_id: string;
  verdict: 'OK' | 'LEAK';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

interface BatchValidationResponse {
  results: ValidationResult[];
}

/**
 * Validate a batch of questions using LLM
 */
export async function validateLeakageBatch(
  questions: Question[],
  claims: Claim[]
): Promise<{ results: Map<string, ValidationResult>; response: LLMResponse }> {
  const client = getGeminiClient();
  const claimMap = new Map(claims.map((c) => [c.claim_id, c]));

  // Format questions for the prompt
  const pairs: string[] = [];
  for (const q of questions) {
    const claim = claimMap.get(q.targets_claim_id);
    if (!claim) continue;

    pairs.push(`
---
Question ID: ${q.question_id}
Question: "${q.question_text}"
Target Claim: "${claim.claim_text}"
Question Style: ${q.question_style || 'targeted'}
---`);
  }

  const userPrompt = `Evaluate these ${questions.length} question-claim pairs for leakage.

${pairs.join('\n')}

For each question, determine if it LEAKS the answer or is OK.

Return JSON ONLY in this format:
{
  "results": [
    {
      "question_id": "t1",
      "verdict": "OK" or "LEAK",
      "confidence": "high", "medium", or "low",
      "reason": "Brief explanation"
    }
  ]
}`;

  const { data, response } = await client.generateJSON<BatchValidationResponse>(
    VALIDATION_PROMPT,
    userPrompt
  );

  // Convert to map
  const resultsMap = new Map<string, ValidationResult>();
  for (const result of data.results) {
    resultsMap.set(result.question_id, result);
  }

  return { results: resultsMap, response };
}

/**
 * Update leakage scores based on LLM validation
 */
export function applyValidationResults(
  questions: Question[],
  validationResults: Map<string, ValidationResult>
): Question[] {
  return questions.map((q) => {
    const result = validationResults.get(q.question_id);
    if (!result) return q;

    let adjustedScore = q.leakage_score;

    if (result.verdict === 'LEAK') {
      // LLM says it leaks - increase score
      if (result.confidence === 'high') {
        adjustedScore = Math.max(adjustedScore, 0.6);
      } else if (result.confidence === 'medium') {
        adjustedScore = Math.max(adjustedScore, 0.45);
      } else {
        adjustedScore = Math.max(adjustedScore, 0.35);
      }
    } else {
      // LLM says it's OK - cap the score
      if (result.confidence === 'high') {
        adjustedScore = Math.min(adjustedScore, 0.15);
      } else if (result.confidence === 'medium') {
        adjustedScore = Math.min(adjustedScore, 0.25);
      } else {
        adjustedScore = Math.min(adjustedScore, 0.3);
      }
    }

    return {
      ...q,
      leakage_score: adjustedScore,
      // Store validation result in a new field (extend type if needed)
    };
  });
}

/**
 * Run full validation pipeline
 */
export async function runLeakageValidation(
  questions: Question[],
  claims: Claim[],
  options: { ruleBasedThreshold?: number } = {}
): Promise<{
  validatedQuestions: Question[];
  report: string;
  response: LLMResponse;
}> {
  const { ruleBasedThreshold = 0.1 } = options;

  // Only validate questions that have some rule-based concern
  // (save tokens by not validating obviously clean questions)
  const questionsToValidate = questions.filter(
    (q) => q.leakage_score >= ruleBasedThreshold
  );

  console.log(`  Validating ${questionsToValidate.length}/${questions.length} questions with LLM...`);

  if (questionsToValidate.length === 0) {
    return {
      validatedQuestions: questions,
      report: 'No questions required LLM validation.',
      response: { content: '', tokens: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 },
    };
  }

  // Run validation in batches of 25
  const BATCH_SIZE = 25;
  const allResults = new Map<string, ValidationResult>();
  let totalTokens = 0;
  let totalCost = 0;

  for (let i = 0; i < questionsToValidate.length; i += BATCH_SIZE) {
    const batch = questionsToValidate.slice(i, i + BATCH_SIZE);
    const { results, response } = await validateLeakageBatch(batch, claims);

    for (const [id, result] of results) {
      allResults.set(id, result);
    }

    totalTokens += response.tokens;
    totalCost += response.cost_usd;

    if (i + BATCH_SIZE < questionsToValidate.length) {
      console.log(`    Batch ${Math.floor(i / BATCH_SIZE) + 1} complete...`);
    }
  }

  // Apply results
  const validatedQuestions = applyValidationResults(questions, allResults);

  // Generate report
  const report = generateValidationReport(allResults, questions);

  return {
    validatedQuestions,
    report,
    response: {
      content: '',
      tokens: totalTokens,
      prompt_tokens: 0,
      completion_tokens: 0,
      cost_usd: totalCost,
    },
  };
}

function generateValidationReport(
  results: Map<string, ValidationResult>,
  questions: Question[]
): string {
  const lines: string[] = ['LLM Leakage Validation Report', '='.repeat(50)];

  let okCount = 0;
  let leakCount = 0;

  const leaks: ValidationResult[] = [];
  const borderline: ValidationResult[] = [];

  for (const [id, result] of results) {
    if (result.verdict === 'OK') {
      okCount++;
    } else {
      leakCount++;
      if (result.confidence === 'high') {
        leaks.push(result);
      } else {
        borderline.push(result);
      }
    }
  }

  lines.push(`\nValidated: ${results.size} questions`);
  lines.push(`OK: ${okCount} | LEAK: ${leakCount}`);

  if (leaks.length > 0) {
    lines.push('\n### High-Confidence Leaks');
    for (const result of leaks) {
      const q = questions.find((q) => q.question_id === result.question_id);
      lines.push(`\n${result.question_id}: "${q?.question_text.slice(0, 50)}..."`);
      lines.push(`  Reason: ${result.reason}`);
    }
  }

  if (borderline.length > 0) {
    lines.push('\n### Borderline Cases');
    for (const result of borderline) {
      const q = questions.find((q) => q.question_id === result.question_id);
      lines.push(`\n${result.question_id} (${result.confidence}): "${q?.question_text.slice(0, 50)}..."`);
      lines.push(`  Reason: ${result.reason}`);
    }
  }

  return lines.join('\n');
}
