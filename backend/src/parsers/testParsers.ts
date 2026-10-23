import fs from 'fs';
import path from 'path';
import {
  parseDocument,
  DocumentParseError,
  FileEmptyError,
  FileTooLargeError,
  UnsupportedFormatError,
  MalformedDocumentError,
  MAX_FILE_SIZE_BYTES,
} from './index';

// Minimal valid standard 1-page PDF file with embedded text
function createMinimalPdfBuffer(sampleText: string): Buffer {
  const streamContent = `BT\n/F1 12 Tf\n50 700 Td\n(${sampleText}) Tj\nET`;
  const streamLength = Buffer.byteLength(streamContent, 'utf-8');

  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length ${streamLength} >>
stream
${streamContent}
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000229 00000 n 
0000000340 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
420
%%EOF`;

  return Buffer.from(pdf, 'utf-8');
}

async function runTestSuite() {
  console.log('===============================================================');
  console.log(' AccessCore Subphase 1.5 - Document Parser & Validation Tests  ');
  console.log('===============================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string, failureDetail?: string) {
    totalTests++;
    if (condition) {
      console.log(`  ✓ [PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`  ✗ [FAIL] ${testName}: ${failureDetail || 'Assertion failed'}`);
      throw new Error(`Test failed: ${testName}`);
    }
  }

  const assetsDir = path.resolve(__dirname, '../../../assets');
  const productDocsDir = path.join(assetsDir, 'product-documents');
  const supportTicketsDir = path.join(assetsDir, 'support-tickets');

  // --------------------------------------------------------------------------
  // TEST GROUP 1: Markdown Product Documents Parsing
  // --------------------------------------------------------------------------
  console.log('--- TEST GROUP 1: Markdown Product Documents ---');
  const mdFiles = ['PDOC-0001-webhook-delivery-troubleshooting.md', 'PDOC-0002-webhooks-overview.md', 'PDOC-0003-api-rate-limits.md', 'PDOC-0004-flow-loop-limits.md'];

  for (const filename of mdFiles) {
    const filePath = path.join(productDocsDir, filename);
    const buffer = fs.readFileSync(filePath);
    const parsed = await parseDocument({ filename, buffer });

    assert(parsed.format === 'markdown', `${filename} format is 'markdown'`);
    assert(parsed.document_id.startsWith('PDOC-'), `${filename} has valid document_id '${parsed.document_id}'`);
    assert(parsed.content.length > 100, `${filename} has extracted body content (${parsed.content.length} chars)`);
    assert(parsed.content_hash.length === 64, `${filename} has SHA-256 content_hash`);
    assert(parsed.metadata.allowed_groups.length >= 1, `${filename} has allowed_groups`);
  }

  // --------------------------------------------------------------------------
  // TEST GROUP 2: JSON Support Tickets Parsing
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: JSON Support Tickets ---');
  const ticketFiles = ['TKT-10421-brightwave-webhook-timeouts.json', 'TKT-10467-lumenfield-api-rate-limit.json', 'TKT-10533-harborpine-saml-failure.json'];

  for (const filename of ticketFiles) {
    const filePath = path.join(supportTicketsDir, filename);
    const buffer = fs.readFileSync(filePath);
    const parsed = await parseDocument({ filename, buffer });

    assert(parsed.format === 'json', `${filename} format is 'json'`);
    assert(parsed.document_id.startsWith('TKT-'), `${filename} has valid document_id '${parsed.document_id}'`);
    assert(parsed.content.includes('# Support Ticket:'), `${filename} content includes formatted header`);
    assert(parsed.content.includes('Issue Summary'), `${filename} content includes Issue Summary`);
    assert(parsed.content_hash.length === 64, `${filename} has SHA-256 hash`);
    assert(parsed.raw_data !== undefined, `${filename} preserved raw_data`);
  }

  // --------------------------------------------------------------------------
  // TEST GROUP 3: PDF Document Parsing
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: PDF Document Parsing ---');
  const samplePdfBuffer = createMinimalPdfBuffer('CloudDesk Platform Webhook Architecture');
  const parsedPdf = await parseDocument({
    filename: 'PDOC-0005-webhook-architecture.pdf',
    buffer: samplePdfBuffer,
    overrideMetadata: {
      document_id: 'PDOC-0005',
      title: 'CloudDesk Platform Webhook Architecture',
      document_type: 'formal_pdf',
      tenant_id: 'global',
      owner_team: 'engineering',
      allowed_groups: ['grp_engineering'],
      sensitivity: 'internal',
      disclosure_policy: 'internal_only',
      created_at: '2026-10-23T12:00:00Z',
      updated_at: '2026-10-23T12:00:00Z',
    },
  });

  assert(parsedPdf.format === 'pdf', "PDF format is 'pdf'");
  assert(parsedPdf.document_id === 'PDOC-0005', 'PDF document_id is PDOC-0005');
  assert(parsedPdf.content.includes('CloudDesk Platform Webhook Architecture'), 'PDF text correctly extracted');
  assert(parsedPdf.content_hash.length === 64, 'PDF SHA-256 hash calculated');
  assert((parsedPdf.raw_data as { page_count: number }).page_count >= 1, 'PDF page count verified');

  // --------------------------------------------------------------------------
  // TEST GROUP 4: Negative & Security Validation Tests
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 4: Negative & Security Validation Tests ---');

  // 4.1 Empty file (0 bytes)
  let threwEmpty = false;
  try {
    await parseDocument({ filename: 'empty.md', buffer: Buffer.alloc(0) });
  } catch (err) {
    if (err instanceof FileEmptyError && err.statusCode === 400 && err.code === 'FILE_EMPTY') {
      threwEmpty = true;
    }
  }
  assert(threwEmpty, 'Empty file (0 bytes) rejected with FileEmptyError (400)');

  // 4.2 Oversized file (>10MB)
  let threwOversized = false;
  try {
    const oversizedBuffer = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1024);
    await parseDocument({ filename: 'huge.pdf', buffer: oversizedBuffer });
  } catch (err) {
    if (err instanceof FileTooLargeError && err.statusCode === 413 && err.code === 'FILE_TOO_LARGE') {
      threwOversized = true;
    }
  }
  assert(threwOversized, 'Oversized file (>10MB) rejected with FileTooLargeError (413)');

  // 4.3 Unsupported file extension (.exe, .docx)
  let threwUnsupported = false;
  try {
    await parseDocument({ filename: 'malware.exe', buffer: Buffer.from('binary-content') });
  } catch (err) {
    if (err instanceof UnsupportedFormatError && err.statusCode === 415 && err.code === 'UNSUPPORTED_FORMAT') {
      threwUnsupported = true;
    }
  }
  assert(threwUnsupported, 'Unsupported extension (.exe) rejected with UnsupportedFormatError (415)');

  // 4.4 Malformed Markdown (missing frontmatter and no override)
  let threwMalformedMd = false;
  try {
    await parseDocument({
      filename: 'plain-notes.md',
      buffer: Buffer.from('# Some title\n\nNo frontmatter here.'),
    });
  } catch (err) {
    if (err instanceof MalformedDocumentError && err.code === 'MALFORMED_DOCUMENT') {
      threwMalformedMd = true;
    }
  }
  assert(threwMalformedMd, 'Markdown without frontmatter rejected with MalformedDocumentError');

  // 4.5 Empty Markdown body
  let threwEmptyMdBody = false;
  try {
    await parseDocument({
      filename: 'empty-body.md',
      buffer: Buffer.from(`---
document_id: PDOC-0001
title: Empty Body Doc
document_type: product_doc
tenant_id: global
owner_team: customer_support
allowed_groups:
  - grp_support
sensitivity: internal
disclosure_policy: internal_only
created_at: "2026-10-20T09:00:00Z"
updated_at: "2026-10-20T09:00:00Z"
version: "1.0"
---

   
`),
    });
  } catch (err) {
    if (err instanceof MalformedDocumentError) {
      threwEmptyMdBody = true;
    }
  }
  assert(threwEmptyMdBody, 'Markdown with empty body content rejected with MalformedDocumentError');

  // 4.6 Malformed JSON syntax
  let threwMalformedJson = false;
  try {
    await parseDocument({
      filename: 'corrupt.json',
      buffer: Buffer.from('{ "metadata": { "doc_id": "TKT-10421" '),
    });
  } catch (err) {
    if (err instanceof MalformedDocumentError) {
      threwMalformedJson = true;
    }
  }
  assert(threwMalformedJson, 'Malformed JSON syntax rejected with MalformedDocumentError');

  // 4.7 JSON ticket missing 'content'
  let threwMissingContentJson = false;
  try {
    await parseDocument({
      filename: 'missing-content.json',
      buffer: Buffer.from(JSON.stringify({
        metadata: {
          document_id: 'TKT-10421',
          title: 'Ticket Missing Content',
          document_type: 'support_ticket',
          tenant_id: 'ten_brightwave',
          owner_team: 'customer_support',
          allowed_groups: ['grp_support'],
          sensitivity: 'confidential',
          disclosure_policy: 'approved_summary_only',
          created_at: '2026-10-15T09:00:00Z',
          updated_at: '2026-10-16T11:00:00Z',
        },
      })),
    });
  } catch (err) {
    if (err instanceof MalformedDocumentError) {
      threwMissingContentJson = true;
    }
  }
  assert(threwMissingContentJson, "JSON ticket missing 'content' rejected with MalformedDocumentError");

  // 4.8 Corrupted PDF (fake header or random bytes)
  let threwCorruptPdf = false;
  try {
    await parseDocument({
      filename: 'corrupted.pdf',
      buffer: Buffer.from('NOT_A_PDF_HEADER_DATA_ABC123'),
    });
  } catch (err) {
    if (err instanceof MalformedDocumentError) {
      threwCorruptPdf = true;
    }
  }
  assert(threwCorruptPdf, "Corrupt PDF missing '%PDF-' header rejected with MalformedDocumentError");

  // 4.9 CloudDesk Blueprint Policy Violation
  // Blueprint Section 6.3: 'confidential' cannot be 'customer_shareable'
  let threwPolicyViolation = false;
  try {
    await parseDocument({
      filename: 'policy-violation.json',
      buffer: Buffer.from(JSON.stringify({
        metadata: {
          document_id: 'TKT-10421',
          title: 'Policy Violation Test',
          document_type: 'support_ticket',
          tenant_id: 'ten_brightwave',
          owner_team: 'customer_support',
          allowed_groups: ['grp_support'],
          sensitivity: 'confidential',
          disclosure_policy: 'customer_shareable', // VIOLATION!
          created_at: '2026-10-15T09:00:00Z',
          updated_at: '2026-10-16T11:00:00Z',
        },
        content: {
          customer_name: 'Brightwave',
          issue_summary: 'Testing policy violation',
        },
      })),
    });
  } catch (err) {
    if (err instanceof MalformedDocumentError) {
      threwPolicyViolation = true;
    }
  }
  assert(threwPolicyViolation, 'Policy violation (confidential + customer_shareable) rejected with MalformedDocumentError');

  console.log('\n===============================================================');
  console.log(` ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY! `);
  console.log(' Subphase 1.5 Acceptance Criteria Fully Met.                    ');
  console.log('===============================================================\n');
}

runTestSuite().catch((err) => {
  console.error('\nFatal test runner error:', err);
  process.exit(1);
});
