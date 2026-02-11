/**
 * CSV parser for NOFORN cables
 */

import * as fs from 'fs';
import { parse } from 'csv-parse/sync';
import type { Cable } from './types.js';

// Column indices based on the CSV header
const COLUMNS = {
  doc_nbr: 0,
  date: 8,
  subject: 58,
  to_field: 59,
  body: 62,
  from_field: 67,
  classification: 76,
  handling: 27,
};

export interface ParseOptions {
  limit?: number;
  offset?: number;
  filterEmpty?: boolean;
}

/**
 * Parse the NOFORN CSV file and return Cable objects
 */
export function parseCablesFromCSV(csvPath: string, options: ParseOptions = {}): Cable[] {
  const { limit, offset = 0, filterEmpty = true } = options;

  console.log(`Reading CSV from ${csvPath}...`);
  const content = fs.readFileSync(csvPath, 'utf-8');

  console.log('Parsing CSV...');
  const records = parse(content, {
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
  }) as string[][];

  // Skip header
  const dataRows = records.slice(1);
  console.log(`Found ${dataRows.length} rows (excluding header)`);

  let cables: Cable[] = [];

  for (let i = offset; i < dataRows.length; i++) {
    if (limit && cables.length >= limit) break;

    const row = dataRows[i];
    const body = row[COLUMNS.body] || '';

    // Skip cables with empty bodies
    if (filterEmpty && !body.trim()) {
      continue;
    }

    // Clean up the body text
    const cleanBody = cleanCableBody(body);

    // Skip if body is too short after cleaning
    if (filterEmpty && cleanBody.length < 100) {
      continue;
    }

    cables.push({
      doc_nbr: row[COLUMNS.doc_nbr] || `row_${i}`,
      subject: row[COLUMNS.subject] || 'UNKNOWN SUBJECT',
      date: row[COLUMNS.date] || '',
      body: cleanBody,
      from_field: row[COLUMNS.from_field] || '',
      to_field: row[COLUMNS.to_field] || '',
      classification: row[COLUMNS.classification] || '',
      handling: row[COLUMNS.handling] || '',
    });
  }

  console.log(`Parsed ${cables.length} cables with non-empty bodies`);
  return cables;
}

/**
 * Clean up cable body text
 */
function cleanCableBody(body: string): string {
  let cleaned = body
    // Remove page markers
    .replace(/PAGE \d+\s+\w+\s+\d+\s+\d+Z/g, '')
    // Remove classification markers in the middle of text
    .replace(/\n\s*(SECRET|CONFIDENTIAL|UNCLASSIFIED)\s*\n/g, '\n')
    // Remove << END OF DOCUMENT >> markers
    .replace(/<< END OF DOCUMENT >>/g, '')
    // Remove excessive whitespace
    .replace(/\n{3,}/g, '\n\n')
    // Trim
    .trim();

  return cleaned;
}

/**
 * Get a single cable by doc_nbr
 */
export function getCableByDocNbr(csvPath: string, docNbr: string): Cable | null {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(content, {
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
  }) as string[][];

  for (let i = 1; i < records.length; i++) {
    const row = records[i];
    if (row[COLUMNS.doc_nbr] === docNbr) {
      return {
        doc_nbr: row[COLUMNS.doc_nbr],
        subject: row[COLUMNS.subject] || 'UNKNOWN SUBJECT',
        date: row[COLUMNS.date] || '',
        body: cleanCableBody(row[COLUMNS.body] || ''),
        from_field: row[COLUMNS.from_field] || '',
        to_field: row[COLUMNS.to_field] || '',
        classification: row[COLUMNS.classification] || '',
        handling: row[COLUMNS.handling] || '',
      };
    }
  }

  return null;
}

/**
 * Count cables with non-empty bodies
 */
export function countCablesWithBody(csvPath: string): { total: number; withBody: number } {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(content, {
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
  }) as string[][];

  const dataRows = records.slice(1);
  let withBody = 0;

  for (const row of dataRows) {
    const body = row[COLUMNS.body] || '';
    if (body.trim().length >= 100) {
      withBody++;
    }
  }

  return { total: dataRows.length, withBody };
}
