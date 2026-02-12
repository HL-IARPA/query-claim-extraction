/**
 * Query-Claim Extraction Pipeline
 *
 * Extracts atomic claims from diplomatic cables and generates
 * questions for RAG evaluation (mosaic theory testing).
 *
 * USAGE:
 *   # Process a specific cable by doc ID
 *   npx tsx src/index.ts --csv /path/to/noforn.csv --doc-id 1975NATO00670
 *
 *   # Process first N cables from the CSV
 *   npx tsx src/index.ts --csv /path/to/noforn.csv --limit 5
 *
 *   # Process raw text directly
 *   npx tsx src/index.ts --text "The ambassador reported..."
 *
 *   # Show CSV statistics
 *   npx tsx src/index.ts --csv /path/to/noforn.csv --stats
 *
 * OUTPUTS:
 *   - output/<doc_id>.json      - Full JSON with claims, questions, metadata
 *   - output/<doc_id>.md        - Human-readable report
 *   - output/extractions.jsonl  - Combined JSONL (one line per cable)
 *   - output/batch-summary.md   - Summary of batch processing
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseCablesFromCSV, getCableByDocNbr, countCablesWithBody } from './csv-parser.js';
import { parseRAGTargets } from './rag-csv-parser.js';
import { extractClaims, formatClaims } from './extract-claims.js';
import { generateQuestions, formatQuestions } from './generate-questions.js';
import { checkAllLeakage, generateLeakageReport, getHighLeakageQuestions } from './leakage-checker.js';
import { runLeakageValidation } from './llm-leakage-validator.js';
import { generateReport, generateBatchSummary } from './report-generator.js';
import type { Cable, ExtractionOutput, QuestionStyle } from './types.js';

// Load environment variables from .env
import { config } from 'dotenv';
config();

// =============================================================================
// CLI Argument Parsing
// =============================================================================

interface CLIOptions {
  csvPath?: string;
  ragCsvPath?: string;  // For RAG retrieval CSV (tag_retriever_elbow.csv)
  docId?: string;
  text?: string;
  limit?: number;
  offset?: number;
  outputDir?: string;
  verbose?: boolean;
  claimsOnly?: boolean;
  stats?: boolean;
  styles?: QuestionStyle[];
  validateLeakage?: boolean;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    outputDir: './output',
    verbose: false,
    claimsOnly: false,
    styles: ['targeted', 'contextual', 'thematic'],
    validateLeakage: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--csv':
        options.csvPath = args[++i];
        break;
      case '--rag-csv':
        options.ragCsvPath = args[++i];
        break;
      case '--doc-id':
        options.docId = args[++i];
        break;
      case '--text':
        options.text = args[++i];
        break;
      case '--limit':
        options.limit = parseInt(args[++i], 10);
        break;
      case '--offset':
        options.offset = parseInt(args[++i], 10);
        break;
      case '--output':
        options.outputDir = args[++i];
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--claims-only':
        options.claimsOnly = true;
        break;
      case '--targeted-only':
        options.styles = ['targeted'];
        break;
      case '--contextual-only':
        options.styles = ['contextual', 'thematic'];
        break;
      case '--stats':
        options.stats = true;
        break;
      case '--validate-leakage':
      case '--validate':
        options.validateLeakage = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║           QUERY-CLAIM EXTRACTION PIPELINE                        ║
║                                                                  ║
║  Extracts claims from diplomatic cables and generates            ║
║  questions for RAG evaluation (mosaic theory testing)            ║
╚══════════════════════════════════════════════════════════════════╝

INPUTS (choose one):
  --csv <path>           Path to NOFORN CSV file
  --rag-csv <path>       Path to RAG retrieval CSV (tag_retriever_elbow.csv)
  --doc-id <id>          Process specific cable by doc_nbr (requires --csv)
  --text <text>          Process raw text directly
  --limit <n>            Process first N cables from CSV
  --offset <n>           Skip first N cables

OPTIONS:
  --output <dir>         Output directory (default: ./output)
  --claims-only          Extract claims only, skip questions
  --targeted-only        Only generate targeted (factoid) questions
  --contextual-only      Only generate contextual/thematic questions
  --validate-leakage     Run LLM validation on leakage (costs extra tokens)
  --verbose, -v          Show detailed output during processing
  --stats                Show CSV statistics and exit
  --help, -h             Show this help

OUTPUTS:
  For each cable processed:
    - <doc_id>.json      Full structured data (claims, questions, metadata)
    - <doc_id>.md        Human-readable report

  Combined outputs:
    - extractions.jsonl  All extractions as JSON lines
    - batch-summary.md   Summary table (if multiple cables)

EXAMPLES:

  # Process a single cable and generate report
  npx tsx src/index.ts --csv /Users/chim/Downloads/noforn.csv \\
      --doc-id 1975NATO00670

  # Process first 5 cables
  npx tsx src/index.ts --csv /Users/chim/Downloads/noforn.csv --limit 5

  # Process text directly
  npx tsx src/index.ts --text "The ambassador reported that negotiations..."

  # Check how many cables have content
  npx tsx src/index.ts --csv /Users/chim/Downloads/noforn.csv --stats

QUESTION STYLES:
  🎯 Targeted    - Directly probe specific claims (factoid-style)
  🔍 Contextual  - Ask about broader situation (exploratory)
  🌐 Thematic    - Ask about patterns and behaviors (wide net)
`);
}

// =============================================================================
// Main Processing
// =============================================================================

async function processCable(
  cable: Cable,
  options: CLIOptions
): Promise<ExtractionOutput> {
  const startTime = Date.now();
  let totalTokens = 0;
  let totalCost = 0;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Processing: ${cable.doc_nbr}`);
  console.log(`Subject: ${cable.subject}`);
  console.log(`Body: ${cable.body.length} characters`);
  console.log('─'.repeat(60));

  // Step 1: Extract claims
  console.log('\n📋 Step 1: Extracting claims...');
  const { claims, response: claimResponse } = await extractClaims(cable);
  totalTokens += claimResponse.tokens;
  totalCost += claimResponse.cost_usd;

  console.log(`   ✓ Found ${claims.length} claims`);
  console.log(`   ✓ Tokens: ${claimResponse.tokens} | Cost: $${claimResponse.cost_usd.toFixed(4)}`);

  // Show claim breakdown
  const claimTypes = new Map<string, number>();
  for (const c of claims) {
    claimTypes.set(c.claim_type, (claimTypes.get(c.claim_type) || 0) + 1);
  }
  const breakdown = [...claimTypes.entries()].map(([t, n]) => `${t}:${n}`).join(', ');
  console.log(`   ✓ Types: ${breakdown}`);

  if (options.verbose) {
    console.log(formatClaims(claims));
  }

  // Step 2: Generate questions (unless claims-only)
  let questions: ExtractionOutput['questions'] = [];
  if (!options.claimsOnly) {
    console.log('\n❓ Step 2: Generating questions...');
    const { questions: rawQuestions, response: questionResponse } = await generateQuestions(
      claims,
      {
        cableContext: cable,
        styles: options.styles,
      }
    );
    totalTokens += questionResponse.tokens;
    totalCost += questionResponse.cost_usd;

    console.log(`   ✓ Generated ${rawQuestions.length} questions`);
    console.log(`   ✓ Tokens: ${questionResponse.tokens} | Cost: $${questionResponse.cost_usd.toFixed(4)}`);

    // Show question style breakdown
    const styleBreakdown = new Map<string, number>();
    for (const q of rawQuestions) {
      const style = q.question_style || 'targeted';
      styleBreakdown.set(style, (styleBreakdown.get(style) || 0) + 1);
    }
    const qBreakdown = [...styleBreakdown.entries()].map(([s, n]) => `${s}:${n}`).join(', ');
    console.log(`   ✓ Styles: ${qBreakdown}`);

    // Step 3: Check leakage (rule-based)
    console.log('\n🔍 Step 3: Checking leakage (rule-based)...');
    questions = checkAllLeakage(rawQuestions, claims);
    let highLeakage = getHighLeakageQuestions(questions);
    let avgLeakage = questions.reduce((sum, q) => sum + q.leakage_score, 0) / questions.length;

    console.log(`   ✓ Rule-based check complete`);
    console.log(`   ✓ Flagged: ${highLeakage.length} questions (>30%)`);
    console.log(`   ✓ Average: ${(avgLeakage * 100).toFixed(1)}%`);

    // Step 4: LLM validation (optional)
    if (options.validateLeakage) {
      console.log('\n🤖 Step 4: LLM leakage validation...');
      const { validatedQuestions, report, response: validationResponse } = await runLeakageValidation(
        questions,
        claims
      );
      questions = validatedQuestions;
      totalTokens += validationResponse.tokens;
      totalCost += validationResponse.cost_usd;

      // Recompute stats
      highLeakage = getHighLeakageQuestions(questions);
      avgLeakage = questions.reduce((sum, q) => sum + q.leakage_score, 0) / questions.length;

      console.log(`   ✓ Validation complete`);
      console.log(`   ✓ Tokens: ${validationResponse.tokens} | Cost: $${validationResponse.cost_usd.toFixed(4)}`);
      console.log(`   ✓ Final flagged: ${highLeakage.length} questions (>30%)`);
      console.log(`   ✓ Final average: ${(avgLeakage * 100).toFixed(1)}%`);

      if (options.verbose) {
        console.log('\n' + report);
      }
    }

    if (highLeakage.length > 0) {
      console.log(`\n   ⚠️  ${highLeakage.length} questions have high leakage (>30%)`);
    } else {
      console.log(`\n   ✓ No high-leakage questions`);
    }

    if (options.verbose) {
      console.log(formatQuestions(questions, claims));
      console.log('\n' + generateLeakageReport(questions, claims));
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n✅ Complete in ${elapsed}s | Total: ${totalTokens} tokens | $${totalCost.toFixed(4)}`);

  return {
    doc_id: cable.doc_nbr,
    doc_subject: cable.subject,
    doc_date: cable.date,
    claims,
    questions,
    metadata: {
      extraction_timestamp: new Date().toISOString(),
      model: 'gemini-2.5-flash',
      total_tokens: totalTokens,
      cost_usd: totalCost,
    },
  };
}

async function main(): Promise<void> {
  const options = parseArgs();

  // Ensure output directory exists
  fs.mkdirSync(options.outputDir!, { recursive: true });

  // Handle --stats
  if (options.stats && options.csvPath) {
    console.log('\n📊 CSV Statistics');
    console.log('─'.repeat(40));
    console.log('Counting cables with body text...');
    const stats = countCablesWithBody(options.csvPath);
    console.log(`Total rows: ${stats.total}`);
    console.log(`With body (>=100 chars): ${stats.withBody}`);
    console.log(`\nUse --limit ${Math.min(10, stats.withBody)} to process a sample`);
    return;
  }

  // Collect cables to process
  let cables: Cable[] = [];

  if (options.text) {
    // Direct text input
    cables.push({
      doc_nbr: 'text_input_' + Date.now(),
      subject: 'Direct text input',
      date: new Date().toISOString().split('T')[0],
      body: options.text,
    });
  } else if (options.csvPath && options.docId) {
    // Single cable by doc_nbr
    console.log(`\n🔎 Looking up cable: ${options.docId}`);
    const cable = getCableByDocNbr(options.csvPath, options.docId);
    if (!cable) {
      console.error(`❌ Cable not found: ${options.docId}`);
      process.exit(1);
    }
    cables.push(cable);
  } else if (options.ragCsvPath) {
    // RAG retrieval CSV (tag_retriever_elbow.csv format)
    cables = parseRAGTargets(options.ragCsvPath, {
      limit: options.limit,
      offset: options.offset,
    });
  } else if (options.csvPath) {
    // Batch from CSV
    cables = parseCablesFromCSV(options.csvPath, {
      limit: options.limit,
      offset: options.offset,
    });
  } else {
    console.error('❌ No input specified.');
    console.error('\nUse one of:');
    console.error('  --csv <path> --doc-id <id>   Process specific cable');
    console.error('  --csv <path> --limit <n>    Process N cables');
    console.error('  --text "..."                Process raw text');
    console.error('\nRun with --help for full usage.');
    process.exit(1);
  }

  if (cables.length === 0) {
    console.error('❌ No cables to process');
    process.exit(1);
  }

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║           QUERY-CLAIM EXTRACTION PIPELINE                        ║
╚══════════════════════════════════════════════════════════════════╝
`);
  console.log(`📁 Input: ${options.ragCsvPath || options.csvPath || 'direct text'}`);
  console.log(`📄 Cables to process: ${cables.length}`);
  console.log(`📂 Output directory: ${options.outputDir}`);
  if (options.claimsOnly) {
    console.log(`⚙️  Mode: Claims only (no questions)`);
  } else {
    console.log(`⚙️  Question styles: ${options.styles?.join(', ')}`);
  }

  // Process each cable
  const results: ExtractionOutput[] = [];
  let totalCost = 0;

  for (let i = 0; i < cables.length; i++) {
    const cable = cables[i];
    console.log(`\n[${i + 1}/${cables.length}]`);

    try {
      const result = await processCable(cable, options);
      results.push(result);
      totalCost += result.metadata.cost_usd;

      // Write JSON output
      const jsonPath = path.join(options.outputDir!, `${cable.doc_nbr}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));

      // Write Markdown report
      const mdPath = path.join(options.outputDir!, `${cable.doc_nbr}.md`);
      const report = generateReport(cable, result);
      fs.writeFileSync(mdPath, report);

      console.log(`\n📄 Output files:`);
      console.log(`   - ${jsonPath}`);
      console.log(`   - ${mdPath}`);
    } catch (error) {
      console.error(`\n❌ Error processing ${cable.doc_nbr}:`, error);
    }
  }

  // Write combined outputs
  if (results.length > 0) {
    // JSONL
    const jsonlPath = path.join(options.outputDir!, 'extractions.jsonl');
    const jsonl = results.map((r) => JSON.stringify(r)).join('\n');
    fs.writeFileSync(jsonlPath, jsonl);

    // Batch summary (if multiple cables)
    if (results.length > 1) {
      const summaryPath = path.join(options.outputDir!, 'batch-summary.md');
      const summary = generateBatchSummary(results);
      fs.writeFileSync(summaryPath, summary);
    }

    // Final summary
    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                         SUMMARY                                  ║
╚══════════════════════════════════════════════════════════════════╝
`);
    console.log(`✓ Processed: ${results.length} cables`);
    console.log(`✓ Total claims: ${results.reduce((sum, r) => sum + r.claims.length, 0)}`);
    console.log(`✓ Total questions: ${results.reduce((sum, r) => sum + r.questions.length, 0)}`);
    console.log(`✓ Total cost: $${totalCost.toFixed(4)}`);
    console.log(`\n📁 Output files:`);
    console.log(`   - ${options.outputDir}/<doc_id>.json  (individual JSON)`);
    console.log(`   - ${options.outputDir}/<doc_id>.md    (individual reports)`);
    console.log(`   - ${jsonlPath} (combined JSONL)`);
    if (results.length > 1) {
      console.log(`   - ${options.outputDir}/batch-summary.md`);
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
