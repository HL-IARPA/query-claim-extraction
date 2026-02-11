/**
 * Type definitions for the query-claim extraction pipeline
 */

// =============================================================================
// Claim Types
// =============================================================================

export type ClaimType =
  | 'event'        // Something that happened
  | 'assessment'   // An evaluation or judgment
  | 'plan'         // Future intention or proposal
  | 'relationship' // Connection between entities
  | 'logistics'    // Operational details (dates, numbers, locations)
  | 'attribution'  // Who said/reported something
  | 'other';

export interface Claim {
  claim_id: string;
  claim_text: string;
  claim_type: ClaimType;
  entities: string[];
  time_bounds?: {
    start?: string;
    end?: string;
  };
  importance: number; // 1-5, where 5 is most important
}

// =============================================================================
// Question Types
// =============================================================================

export type AnswerType =
  | 'who'
  | 'what'
  | 'when'
  | 'where'
  | 'why'
  | 'how'
  | 'numeric'
  | 'list';

/**
 * Question styles for different retrieval strategies:
 * - targeted: Directly probes a specific claim (factoid-style)
 * - contextual: Asks about the broader situation/context (exploratory)
 * - thematic: Asks about themes, relationships, or patterns across the domain
 */
export type QuestionStyle = 'targeted' | 'contextual' | 'thematic';

export interface Question {
  question_id: string;
  targets_claim_id: string;       // For targeted questions, the specific claim
  targets_claim_ids?: string[];   // For contextual/thematic, may relate to multiple claims
  question_text: string;
  question_style: QuestionStyle;
  answer_type: AnswerType;
  allowed_hints: string[];  // e.g., ["time_window", "region", "org_type"]
  banned_terms: string[];   // terms that shouldn't appear in question
  leakage_score: number;    // 0-1, lower is better
}

// =============================================================================
// Pipeline Output
// =============================================================================

export interface ExtractionOutput {
  doc_id: string;
  doc_subject: string;
  doc_date?: string;
  claims: Claim[];
  questions: Question[];
  metadata: {
    extraction_timestamp: string;
    model: string;
    total_tokens: number;
    cost_usd: number;
  };
}

// =============================================================================
// Cable Data (from CSV)
// =============================================================================

export interface Cable {
  doc_nbr: string;
  subject: string;
  date: string;
  body: string;
  from_field?: string;
  to_field?: string;
  classification?: string;
  handling?: string;
  tags?: string[];
}

// =============================================================================
// LLM Response
// =============================================================================

export interface LLMResponse {
  content: string;
  tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
}

// =============================================================================
// Extraction Results (raw from LLM)
// =============================================================================

export interface ClaimExtractionResult {
  claims: Array<{
    claim_id: string;
    claim_text: string;
    claim_type: string;
    entities: string[];
    time_bounds?: { start?: string; end?: string };
    importance: number;
  }>;
}

export interface QuestionGenerationResult {
  questions: Array<{
    question_id: string;
    targets_claim_id: string;
    targets_claim_ids?: string[];
    question_text: string;
    question_style?: string;
    answer_type: string;
    allowed_hints: string[];
    banned_terms: string[];
  }>;
}

// =============================================================================
// Leakage Check Result
// =============================================================================

export interface LeakageCheckResult {
  score: number;
  issues: string[];
  ngram_overlap: number;
  entity_overlap: number;
  verbatim_match: boolean;
}
