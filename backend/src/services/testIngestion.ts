import fs from 'fs';
import path from 'path';
import { closePool, query } from '../db';
import { ingestionService, IngestionError } from './ingestionService';

async function runIngestionTestSuite() {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 1.6 - Ingestion & Safe Document Updates Test ');
  console.log('==================================================================\n');

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

  try {
    // --------------------------------------------------------------------------
    // CLEANUP / ISOLATION: Clean up test documents if present
    // --------------------------------------------------------------------------
    console.log('[Setup] Cleaning existing test documents from database...');
    await query("DELETE FROM documents WHERE document_id LIKE 'PDOC-%' OR document_id LIKE 'TKT-%' OR document_id = 'TEST-0001'");

    // --------------------------------------------------------------------------
    // TEST 1: Initial Upload of a Document (PDOC-0001 v1)
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 1: Initial Document Upload (Version 1) ---');
    const pdoc1Filename = 'PDOC-0001-webhook-delivery-troubleshooting.md';
    const pdoc1Buffer = fs.readFileSync(path.join(productDocsDir, pdoc1Filename));

    const result1 = await ingestionService.ingestDocument({
      filename: pdoc1Filename,
      buffer: pdoc1Buffer,
    });

    assert(result1.document_id === 'PDOC-0001', 'Initial ingestion assigned stable document_id PDOC-0001');
    assert(result1.version === 1, 'Initial ingestion set version = 1');
    assert(result1.status === 'completed', "Initial ingestion returned status = 'completed'");
    assert(result1.is_new_version === true, 'Flagged as new version');
    assert(result1.is_reused === false, 'Flagged as not reused');

    // Verify in PostgreSQL database
    const docDbRes = await query<{ current_version: number; status: string }>(
      'SELECT current_version, status FROM documents WHERE document_id = $1',
      ['PDOC-0001']
    );
    assert(docDbRes.rows[0]?.current_version === 1, 'DB documents table has current_version = 1');
    assert(docDbRes.rows[0]?.status === 'completed', "DB documents table has status = 'completed'");

    const verDbRes = await query<{ version: number; status: string }>(
      'SELECT version, status FROM document_versions WHERE document_id = $1',
      [result1.doc_uuid]
    );
    assert(verDbRes.rows.length === 1, 'Exactly one version record created in DB');
    assert(verDbRes.rows[0]?.status === 'active', "Version 1 is marked 'active'");

    // --------------------------------------------------------------------------
    // TEST 2: Reuploading with Identical Content (Safe Deduplication)
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 2: Reuploading Identical Content (No-Op Reuse) ---');
    const result2 = await ingestionService.ingestDocument({
      filename: pdoc1Filename,
      buffer: pdoc1Buffer,
    });

    assert(result2.is_reused === true, 'Detected identical content hash: is_reused = true');
    assert(result2.version === 1, 'Version remained 1');
    assert(result2.is_new_version === false, 'No new version created');

    const verCountRes = await query<{ count: string }>(
      'SELECT count(*) FROM document_versions WHERE document_id = $1',
      [result1.doc_uuid]
    );
    assert(parseInt(verCountRes.rows[0].count, 10) === 1, 'Database versions count remains 1 (no duplicate)');

    // --------------------------------------------------------------------------
    // TEST 3: Reuploading with Modified Content (Safe Version Increment)
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 3: Reuploading Modified Content (Version 2 Publication) ---');
    const modifiedPdoc1Text = pdoc1Buffer
      .toString('utf-8')
      .replace(
        '# Webhook Delivery Troubleshooting',
        '# Webhook Delivery Troubleshooting (Revised v2 Content)'
      );
    const modifiedPdoc1Buffer = Buffer.from(modifiedPdoc1Text, 'utf-8');

    const result3 = await ingestionService.ingestDocument({
      filename: pdoc1Filename,
      buffer: modifiedPdoc1Buffer,
    });

    assert(result3.version === 2, 'New version incremented to 2');
    assert(result3.status === 'completed', 'Version 2 status is completed');
    assert(result3.is_new_version === true, 'Flagged as new version');

    // Verify DB version statuses: v2 must be 'active', v1 must be 'archived'
    const allVersionsRes = await query<{ version: number; status: string }>(
      'SELECT version, status FROM document_versions WHERE document_id = $1 ORDER BY version ASC',
      [result1.doc_uuid]
    );
    assert(allVersionsRes.rows.length === 2, 'Now exactly 2 versions in database');
    assert(allVersionsRes.rows[0]?.status === 'archived', "Version 1 is transitioned to 'archived'");
    assert(allVersionsRes.rows[1]?.status === 'active', "Version 2 is published as 'active'");

    const docUpdatedRes = await query<{ current_version: number; status: string }>(
      'SELECT current_version, status FROM documents WHERE document_id = $1',
      ['PDOC-0001']
    );
    assert(docUpdatedRes.rows[0]?.current_version === 2, 'Documents table current_version updated to 2');

    // --------------------------------------------------------------------------
    // TEST 4: Failed Update Protection (Previous Active Version Preserved)
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 4: Failed Update Handling & Version Safety ---');
    const modifiedPdoc1V3Text = pdoc1Buffer
      .toString('utf-8')
      .replace(
        '# Webhook Delivery Troubleshooting',
        '# Webhook Delivery Troubleshooting (Attempted v3)'
      );
    const modifiedPdoc1V3Buffer = Buffer.from(modifiedPdoc1V3Text, 'utf-8');

    let threwUpdateFailure = false;
    try {
      await ingestionService.ingestDocument({
        filename: pdoc1Filename,
        buffer: modifiedPdoc1V3Buffer,
        simulateProcessingFailure: true,
      });
    } catch (err) {
      if (err instanceof IngestionError && err.code === 'INGESTION_FAILED') {
        threwUpdateFailure = true;
      }
    }
    assert(threwUpdateFailure, 'Simulated update failure caught and rejected safely');

    // CRITICAL ACCEPTANCE CHECK: Verify Version 2 is STILL active and document current_version is STILL 2!
    const docCheckAfterFail = await query<{ current_version: number; status: string }>(
      'SELECT current_version, status FROM documents WHERE document_id = $1',
      ['PDOC-0001']
    );
    assert(
      docCheckAfterFail.rows[0]?.current_version === 2,
      'Documents table current_version is STILL 2 after failed v3 attempt'
    );
    assert(
      docCheckAfterFail.rows[0]?.status === 'completed',
      'Documents table status is STILL completed'
    );

    const v2CheckAfterFail = await query<{ status: string }>(
      'SELECT status FROM document_versions WHERE document_id = $1 AND version = 2',
      [result1.doc_uuid]
    );
    assert(
      v2CheckAfterFail.rows[0]?.status === 'active',
      'Version 2 is STILL active and untouched!'
    );

    const v3CheckAfterFail = await query<{ status: string; error_message: string }>(
      'SELECT status, error_message FROM document_versions WHERE document_id = $1 AND version = 3',
      [result1.doc_uuid]
    );
    assert(
      v3CheckAfterFail.rows[0]?.status === 'failed',
      'Version 3 recorded as failed without polluting active retrieval'
    );
    assert(
      v3CheckAfterFail.rows[0]?.error_message?.includes('Simulated processing failure') === true,
      'Version 3 captured diagnostic error message'
    );

    // --------------------------------------------------------------------------
    // TEST 5: Negative Testing - Invalid and Malformed Documents Fail Safely
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 5: Invalid Uploads Fail Safely Without Corrupting Database ---');
    let threwEmpty = false;
    try {
      await ingestionService.ingestDocument({
        filename: 'empty-test.md',
        buffer: Buffer.alloc(0),
      });
    } catch {
      threwEmpty = true;
    }
    assert(threwEmpty, 'Empty document buffer rejected safely');

    let threwCorruptJson = false;
    try {
      await ingestionService.ingestDocument({
        filename: 'broken.json',
        buffer: Buffer.from('{ invalid: json '),
      });
    } catch {
      threwCorruptJson = true;
    }
    assert(threwCorruptJson, 'Malformed JSON rejected safely before version staging');

    // --------------------------------------------------------------------------
    // TEST 6: Ingest Complete CloudDesk Sample Dataset (4 Docs + 3 Tickets)
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 6: Ingest Full CloudDesk Sample Dataset ---');
    const remainingMdFiles = [
      'PDOC-0002-webhooks-overview.md',
      'PDOC-0003-api-rate-limits.md',
      'PDOC-0004-flow-loop-limits.md',
    ];
    for (const file of remainingMdFiles) {
      const buffer = fs.readFileSync(path.join(productDocsDir, file));
      const res = await ingestionService.ingestDocument({ filename: file, buffer });
      assert(res.status === 'completed', `Ingested ${file} (${res.document_id})`);
    }

    const ticketFiles = [
      'TKT-10421-brightwave-webhook-timeouts.json',
      'TKT-10467-lumenfield-api-rate-limit.json',
      'TKT-10533-harborpine-saml-failure.json',
    ];
    for (const file of ticketFiles) {
      const buffer = fs.readFileSync(path.join(supportTicketsDir, file));
      const res = await ingestionService.ingestDocument({ filename: file, buffer });
      assert(res.status === 'completed', `Ingested ${file} (${res.document_id})`);
    }

    // Verify all 7 documents exist in DB
    const allDocs = await ingestionService.listDocuments();
    assert(allDocs.length === 7, `Total documents in database is 7 (found ${allDocs.length})`);

    // Verify tenant filtering
    const brightwaveDocs = await ingestionService.listDocuments({ tenantId: 'ten_brightwave' });
    assert(brightwaveDocs.length === 1, 'Tenant filter ten_brightwave returned 1 document (TKT-10421)');
    assert(brightwaveDocs[0]?.document_id === 'TKT-10421', 'Filtered document ID is TKT-10421');

    // Verify sensitivity filtering
    const confidentialDocs = await ingestionService.listDocuments({ sensitivity: 'confidential' });
    assert(confidentialDocs.length === 3, 'Sensitivity filter confidential returned 3 documents');

    // Verify getDocumentById
    const docDetail = await ingestionService.getDocumentById('PDOC-0001');
    assert(docDetail !== null, 'getDocumentById(PDOC-0001) returned valid document');
    assert(docDetail!.versions.length === 3, 'PDOC-0001 has 3 recorded versions in history (v1, v2, failed v3)');

    console.log('\n==================================================================');
    console.log(` ALL ${passedTests}/${totalTests} INGESTION & UPDATE TESTS PASSED! `);
    console.log(' Subphase 1.6 Acceptance Criteria Fully Met.                      ');
    console.log('==================================================================\n');
  } finally {
    await closePool();
  }
}

runIngestionTestSuite().catch((err) => {
  console.error('\nFatal Ingestion test runner error:', err);
  process.exit(1);
});
