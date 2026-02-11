/**
 * Human-readable report generator
 *
 * Generates markdown reports showing every step of the pipeline
 */

import type { Cable, Claim, Question, ExtractionOutput } from './types.js';

export function generateReport(cable: Cable, output: ExtractionOutput): string {
  const lines: string[] = [];

  // Header
  lines.push('# Cable Analysis Report');
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Model:** ${output.metadata.model}`);
  lines.push(`**Cost:** $${output.metadata.cost_usd.toFixed(4)} (${output.metadata.total_tokens} tokens)`);
  lines.push('');

  // ==========================================================================
  // Step 1: Input Cable
  // ==========================================================================
  lines.push('---');
  lines.push('');
  lines.push('## Step 1: Input Cable');
  lines.push('');
  lines.push('### Metadata');
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| **Doc ID** | ${cable.doc_nbr} |`);
  lines.push(`| **Subject** | ${cable.subject} |`);
  lines.push(`| **Date** | ${cable.date || 'Unknown'} |`);
  lines.push(`| **From** | ${cable.from_field || 'Unknown'} |`);
  lines.push(`| **To** | ${cable.to_field || 'Unknown'} |`);
  lines.push(`| **Classification** | ${cable.classification || 'Unknown'} |`);
  lines.push(`| **Handling** | ${cable.handling || 'Unknown'} |`);
  lines.push('');

  lines.push('### Cable Body');
  lines.push('');
  lines.push('```');
  // Truncate very long cables for readability
  const bodyPreview = cable.body.length > 4000
    ? cable.body.slice(0, 4000) + '\n\n[... truncated for readability ...]'
    : cable.body;
  lines.push(bodyPreview);
  lines.push('```');
  lines.push('');

  // ==========================================================================
  // Step 2: Extracted Claims
  // ==========================================================================
  lines.push('---');
  lines.push('');
  lines.push('## Step 2: Extracted Claims');
  lines.push('');
  lines.push(`**Total claims extracted:** ${output.claims.length}`);
  lines.push('');

  // Group claims by type
  const claimsByType = groupBy(output.claims, c => c.claim_type);
  const typeOrder = ['event', 'assessment', 'plan', 'relationship', 'logistics', 'attribution', 'other'];

  for (const type of typeOrder) {
    const claims = claimsByType.get(type);
    if (!claims || claims.length === 0) continue;

    const typeLabel = {
      event: '🔴 Events',
      assessment: '🔵 Assessments',
      plan: '🟢 Plans/Recommendations',
      relationship: '🟡 Relationships',
      logistics: '🟣 Logistics/Numbers',
      attribution: '🟠 Attributions',
      other: '⚪ Other',
    }[type] || type;

    lines.push(`### ${typeLabel}`);
    lines.push('');

    // Sort by importance
    const sorted = [...claims].sort((a, b) => b.importance - a.importance);

    for (const claim of sorted) {
      const stars = '★'.repeat(claim.importance) + '☆'.repeat(5 - claim.importance);
      lines.push(`**${claim.claim_id}** ${stars}`);
      lines.push('');
      lines.push(`> ${claim.claim_text}`);
      lines.push('');

      const meta: string[] = [];
      if (claim.entities.length > 0) {
        meta.push(`Entities: ${claim.entities.join(', ')}`);
      }
      if (claim.time_bounds?.start || claim.time_bounds?.end) {
        const time = [claim.time_bounds.start, claim.time_bounds.end].filter(Boolean).join(' → ');
        meta.push(`Time: ${time}`);
      }
      if (meta.length > 0) {
        lines.push(`*${meta.join(' | ')}*`);
        lines.push('');
      }
    }
  }

  // ==========================================================================
  // Step 3: Generated Questions
  // ==========================================================================
  lines.push('---');
  lines.push('');
  lines.push('## Step 3: Generated Questions');
  lines.push('');
  lines.push(`**Total questions generated:** ${output.questions.length}`);
  lines.push('');

  // Group by style
  const questionsByStyle = groupBy(output.questions, q => q.question_style || 'targeted');

  // Targeted Questions
  const targeted = questionsByStyle.get('targeted') || [];
  if (targeted.length > 0) {
    lines.push('### 🎯 Targeted Questions (Factoid-style)');
    lines.push('');
    lines.push('*These questions directly probe specific claims. They ask for the specific information without giving away the answer.*');
    lines.push('');

    for (const q of targeted) {
      const claim = output.claims.find(c => c.claim_id === q.targets_claim_id);
      const leakageIndicator = q.leakage_score > 0.3 ? ' ⚠️ HIGH LEAKAGE' : '';

      lines.push(`**${q.question_id}** → ${q.targets_claim_id}${leakageIndicator}`);
      lines.push('');
      lines.push(`> **Q:** ${q.question_text}`);
      lines.push('');
      if (claim) {
        lines.push(`> **Target claim:** "${claim.claim_text}"`);
        lines.push('');
      }
      if (q.leakage_score > 0) {
        lines.push(`*Leakage score: ${(q.leakage_score * 100).toFixed(1)}%*`);
        lines.push('');
      }
    }
  }

  // Contextual Questions
  const contextual = questionsByStyle.get('contextual') || [];
  if (contextual.length > 0) {
    lines.push('### 🔍 Contextual Questions (Exploratory)');
    lines.push('');
    lines.push('*These questions ask about the broader situation. They might retrieve documents that indirectly reveal the claims (mosaic theory).*');
    lines.push('');

    for (const q of contextual) {
      const targetIds = q.targets_claim_ids || [q.targets_claim_id];

      lines.push(`**${q.question_id}**`);
      lines.push('');
      lines.push(`> **Q:** ${q.question_text}`);
      lines.push('');
      lines.push(`*Could help reveal: ${targetIds.join(', ')}*`);
      lines.push('');
    }
  }

  // Thematic Questions
  const thematic = questionsByStyle.get('thematic') || [];
  if (thematic.length > 0) {
    lines.push('### 🌐 Thematic Questions (Pattern-seeking)');
    lines.push('');
    lines.push('*These abstract questions ask about patterns and typical behaviors. They cast a wide net across the corpus.*');
    lines.push('');

    for (const q of thematic) {
      const targetIds = q.targets_claim_ids || [q.targets_claim_id];

      lines.push(`**${q.question_id}**`);
      lines.push('');
      lines.push(`> **Q:** ${q.question_text}`);
      lines.push('');
      lines.push(`*Could help contextualize: ${targetIds.join(', ')}*`);
      lines.push('');
    }
  }

  // ==========================================================================
  // Step 4: Leakage Analysis
  // ==========================================================================
  lines.push('---');
  lines.push('');
  lines.push('## Step 4: Leakage Analysis');
  lines.push('');

  const highLeakage = output.questions.filter(q => q.leakage_score > 0.3);
  const avgLeakage = output.questions.reduce((sum, q) => sum + q.leakage_score, 0) / output.questions.length;

  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total questions | ${output.questions.length} |`);
  lines.push(`| High leakage (>30%) | ${highLeakage.length} |`);
  lines.push(`| Average leakage | ${(avgLeakage * 100).toFixed(1)}% |`);
  lines.push('');

  if (highLeakage.length > 0) {
    lines.push('### Questions with High Leakage');
    lines.push('');
    lines.push('*These questions may give away too much of the answer and should be reviewed or regenerated.*');
    lines.push('');

    for (const q of highLeakage) {
      lines.push(`- **${q.question_id}** (${(q.leakage_score * 100).toFixed(1)}%): "${q.question_text.slice(0, 80)}..."`);
    }
    lines.push('');
  }

  // ==========================================================================
  // Summary
  // ==========================================================================
  lines.push('---');
  lines.push('');
  lines.push('## Summary');
  lines.push('');

  const claimTypeCounts = [...claimsByType.entries()]
    .map(([type, claims]) => `${type}: ${claims.length}`)
    .join(', ');

  const questionStyleCounts = [...questionsByStyle.entries()]
    .map(([style, qs]) => `${style}: ${qs.length}`)
    .join(', ');

  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| **Input** | ${cable.doc_nbr} - ${cable.subject} |`);
  lines.push(`| **Claims** | ${output.claims.length} (${claimTypeCounts}) |`);
  lines.push(`| **Questions** | ${output.questions.length} (${questionStyleCounts}) |`);
  lines.push(`| **Processing cost** | $${output.metadata.cost_usd.toFixed(4)} |`);
  lines.push('');

  // ==========================================================================
  // Appendix: Claim-Question Mapping
  // ==========================================================================
  lines.push('---');
  lines.push('');
  lines.push('## Appendix: Claim-Question Mapping');
  lines.push('');
  lines.push('*Which questions target which claims?*');
  lines.push('');

  for (const claim of output.claims) {
    const targetingQuestions = output.questions.filter(q =>
      q.targets_claim_id === claim.claim_id ||
      q.targets_claim_ids?.includes(claim.claim_id)
    );

    if (targetingQuestions.length > 0) {
      lines.push(`**${claim.claim_id}**: "${claim.claim_text.slice(0, 60)}..."`);
      for (const q of targetingQuestions) {
        const style = q.question_style === 'targeted' ? '🎯' :
                      q.question_style === 'contextual' ? '🔍' : '🌐';
        lines.push(`  - ${style} ${q.question_id}: "${q.question_text.slice(0, 50)}..."`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Generate a batch summary report for multiple cables
 */
export function generateBatchSummary(outputs: ExtractionOutput[]): string {
  const lines: string[] = [];

  lines.push('# Batch Processing Summary');
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Cables processed:** ${outputs.length}`);
  lines.push('');

  const totalClaims = outputs.reduce((sum, o) => sum + o.claims.length, 0);
  const totalQuestions = outputs.reduce((sum, o) => sum + o.questions.length, 0);
  const totalCost = outputs.reduce((sum, o) => sum + o.metadata.cost_usd, 0);

  lines.push('## Overall Statistics');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total cables | ${outputs.length} |`);
  lines.push(`| Total claims | ${totalClaims} |`);
  lines.push(`| Total questions | ${totalQuestions} |`);
  lines.push(`| Avg claims/cable | ${(totalClaims / outputs.length).toFixed(1)} |`);
  lines.push(`| Avg questions/cable | ${(totalQuestions / outputs.length).toFixed(1)} |`);
  lines.push(`| Total cost | $${totalCost.toFixed(4)} |`);
  lines.push('');

  lines.push('## Per-Cable Summary');
  lines.push('');
  lines.push('| Doc ID | Subject | Claims | Questions | Cost |');
  lines.push('|--------|---------|--------|-----------|------|');

  for (const output of outputs) {
    const subject = output.doc_subject.length > 40
      ? output.doc_subject.slice(0, 40) + '...'
      : output.doc_subject;
    lines.push(`| ${output.doc_id} | ${subject} | ${output.claims.length} | ${output.questions.length} | $${output.metadata.cost_usd.toFixed(4)} |`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*Individual reports available in the output directory.*');

  return lines.join('\n');
}

// Helper function
function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return map;
}
