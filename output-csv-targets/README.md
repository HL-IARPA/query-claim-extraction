# CSV Targets Output

This folder will contain Stage 1 (query-claim extraction) output for the target documents in `tag_retriever_elbow.csv`.

## Why a Separate Folder?

The existing `output/` folder contains extractions for 10 specific cables that were used during development. The CSV file contains different target documents that need to be processed for the reconstruction evaluation pipeline.

## Processing Instructions

When ready to process:

```bash
# Process all targets from the CSV
npx tsx src/index.ts \
  --csv /path/to/tag_retriever_elbow.csv \
  --output-dir ./output-csv-targets \
  --extract-targets

# Or process specific rows
npx tsx src/index.ts \
  --csv /path/to/tag_retriever_elbow.csv \
  --output-dir ./output-csv-targets \
  --limit 10
```

## Expected Output

For each target document in the CSV:
- `{doc_id}.json` - claims and questions
- `{doc_id}.md` - human-readable report

## Status

- [ ] CSV targets identified
- [ ] Stage 1 processing complete
- [ ] Ready for Stage 2 (document-reconstructor)
