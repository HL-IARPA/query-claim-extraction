/**
 * Parser for the RAG retrieval results CSV (tag_retriever_elbow.csv)
 *
 * This CSV has a different format than noforn.csv:
 * - ex id: row index
 * - Target: full document text (first line is doc_id)
 * - Doc 0-9: retrieved documents
 */

import * as fs from 'fs';
import { parse } from 'csv-parse/sync';
import type { Cable } from './types.js';

export interface RAGRow {
  ex_id: number;
  target: string;
  target_doc_id: string;
  target_subject: string;
  retrieved_docs: string[];
  llm_judge: string;
  rationale: string;
  per_doc_judgements: boolean[];
}

/**
 * Parse the RAG retrieval CSV and extract targets as Cable objects
 */
export function parseRAGTargets(csvPath: string, options: { limit?: number; offset?: number } = {}): Cable[] {
  const { limit, offset = 0 } = options;

  console.log(`Reading RAG CSV from ${csvPath}...`);
  const content = fs.readFileSync(csvPath, 'utf-8');

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
  }) as Record<string, string>[];

  console.log(`Found ${records.length} rows`);

  const cables: Cable[] = [];

  for (let i = offset; i < records.length; i++) {
    if (limit && cables.length >= limit) break;

    const row = records[i];
    const target = row['Target'] || '';

    // Skip empty or invalid targets
    if (!target || target.length < 50) {
      console.log(`  Skipping row ${i}: empty or too short`);
      continue;
    }

    // Extract doc_id from first line (format: 1976SINGAP02176)
    const lines = target.split('\n');
    const firstLine = lines[0]?.trim() || '';
    const docIdMatch = firstLine.match(/^(\d{4}[A-Z]+\d+)/);

    if (!docIdMatch) {
      console.log(`  Skipping row ${i}: no valid doc_id found in "${firstLine.slice(0, 50)}"`);
      continue;
    }

    const doc_id = docIdMatch[1];

    // Subject is usually the second line
    const subject = lines[1]?.trim() || 'UNKNOWN SUBJECT';

    // Body is everything after the header
    const body = lines.slice(1).join('\n').trim();

    if (body.length < 100) {
      console.log(`  Skipping row ${i} (${doc_id}): body too short (${body.length} chars)`);
      continue;
    }

    cables.push({
      doc_nbr: doc_id,
      subject: subject,
      date: extractDateFromDocId(doc_id),
      body: body,
    });

    console.log(`  ✓ Row ${i}: ${doc_id} - ${subject.slice(0, 50)}...`);
  }

  console.log(`\nParsed ${cables.length} valid target documents`);
  return cables;
}

/**
 * Parse the full RAG row including retrieved documents
 */
export function parseRAGRow(csvPath: string, exId: number): RAGRow | null {
  const content = fs.readFileSync(csvPath, 'utf-8');

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
  }) as Record<string, string>[];

  const row = records.find(r => parseInt(r['ex id']) === exId);
  if (!row) return null;

  const target = row['Target'] || '';
  const lines = target.split('\n');
  const firstLine = lines[0]?.trim() || '';
  const docIdMatch = firstLine.match(/^(\d{4}[A-Z]+\d+)/);

  // Parse per-doc judgements
  let perDocJudgements: boolean[] = [];
  try {
    const judgementStr = row['Per-Doc Judgements'] || '[]';
    perDocJudgements = JSON.parse(judgementStr.replace(/True/g, 'true').replace(/False/g, 'false'));
  } catch {
    perDocJudgements = [];
  }

  // Extract retrieved docs
  const retrievedDocs: string[] = [];
  for (let i = 0; i <= 9; i++) {
    const doc = row[`Doc ${i}`];
    if (doc) {
      retrievedDocs.push(doc);
    }
  }

  return {
    ex_id: parseInt(row['ex id']),
    target: target,
    target_doc_id: docIdMatch?.[1] || `unknown_${exId}`,
    target_subject: lines[1]?.trim() || 'UNKNOWN',
    retrieved_docs: retrievedDocs,
    llm_judge: row['LLM Judge'] || '',
    rationale: row['Rationale'] || '',
    per_doc_judgements: perDocJudgements,
  };
}

/**
 * Get all RAG rows with their retrieved documents
 */
export function getAllRAGRows(csvPath: string): RAGRow[] {
  const content = fs.readFileSync(csvPath, 'utf-8');

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
  }) as Record<string, string>[];

  const rows: RAGRow[] = [];

  for (const row of records) {
    const exId = parseInt(row['ex id']);
    if (isNaN(exId)) continue;

    const target = row['Target'] || '';
    if (!target || target.length < 50) continue;

    const lines = target.split('\n');
    const firstLine = lines[0]?.trim() || '';
    const docIdMatch = firstLine.match(/^(\d{4}[A-Z]+\d+)/);

    if (!docIdMatch) continue;

    // Parse per-doc judgements
    let perDocJudgements: boolean[] = [];
    try {
      const judgementStr = row['Per-Doc Judgements'] || '[]';
      perDocJudgements = JSON.parse(judgementStr.replace(/True/g, 'true').replace(/False/g, 'false'));
    } catch {
      perDocJudgements = [];
    }

    // Extract retrieved docs
    const retrievedDocs: string[] = [];
    for (let i = 0; i <= 9; i++) {
      const doc = row[`Doc ${i}`];
      if (doc) {
        retrievedDocs.push(doc);
      }
    }

    rows.push({
      ex_id: exId,
      target: target,
      target_doc_id: docIdMatch[1],
      target_subject: lines[1]?.trim() || 'UNKNOWN',
      retrieved_docs: retrievedDocs,
      llm_judge: row['LLM Judge'] || '',
      rationale: row['Rationale'] || '',
      per_doc_judgements: perDocJudgements,
    });
  }

  return rows;
}

/**
 * Extract year from doc_id (e.g., 1976SINGAP02176 -> 1976)
 */
function extractDateFromDocId(docId: string): string {
  const match = docId.match(/^(\d{4})/);
  return match ? match[1] : '';
}
