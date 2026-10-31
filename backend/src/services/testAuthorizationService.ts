import { query, closePool } from '../db';
import { runMigrations } from '../db/migrate';
import { seedIdentities } from '../db/seedIdentities';
import { authService } from './authService';
import { authorizationService, AuthzAction, AuthzResource } from './authorizationService';
import { AuthenticatedUser } from '../types/identity';

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

async function runAuthorizationServiceTestSuite() {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 2.5 — Central Authorization Service Tests   ');
  console.log('==================================================================\n');

  try {
    // 0. Ensure migrations and identities are initialized
    await runMigrations();
    await seedIdentities({ quiet: true });

    // Load actual seeded personas from PostgreSQL via authService
    const priya = (await authService.resolveAuthenticatedUser('emp_001'))!; // Support Agent (Brightwave, Lumenfield)
    const marcus = (await authService.resolveAuthenticatedUser('emp_002'))!; // Support Agent (Harborpine, Lumenfield)
    const elena = (await authService.resolveAuthenticatedUser('emp_003'))!; // Support Lead (Wildcard '*')
    const rafael = (await authService.resolveAuthenticatedUser('emp_008'))!; // IT Security Admin (grp_security_restricted)
    const meiLin = (await authService.resolveAuthenticatedUser('emp_007'))!; // Engineering Manager (grp_incident_review, '*')
    const hannah = (await authService.resolveAuthenticatedUser('cu_001'))!; // Customer User (Brightwave only)
    const suspended = (await authService.resolveAuthenticatedUser('emp_099'))!; // Suspended account

    // --------------------------------------------------------------------------
    // TEST GROUP 1: Default-Deny Security Guard
    // --------------------------------------------------------------------------
    console.log('--- TEST GROUP 1: Default-Deny Security Guard ---');

    // Missing user
    const rMissingUser = authorizationService.can(
      null as unknown as AuthenticatedUser,
      'read:document',
      { type: 'document', tenant_id: 'global', allowed_groups: ['grp_public'], sensitivity: 'public' }
    );
    assert(!rMissingUser.allowed, 'Denies when user is null');

    // Missing action
    const rMissingAction = authorizationService.can(
      priya,
      null as unknown as AuthzAction,
      { type: 'document', tenant_id: 'global', allowed_groups: ['grp_public'], sensitivity: 'public' }
    );
    assert(!rMissingAction.allowed, 'Denies when action is null');

    // Unsupported action
    const rUnsupportedAction = authorizationService.can(
      priya,
      'unsupported:action' as AuthzAction,
      { type: 'document', tenant_id: 'global', allowed_groups: ['grp_public'], sensitivity: 'public' }
    );
    assert(!rUnsupportedAction.allowed, 'Denies on unsupported action');

    // Unsupported resource type
    const rUnsupportedResource = authorizationService.can(
      priya,
      'read:document',
      { type: 'unknown_type' as unknown as 'document', tenant_id: 'global', allowed_groups: ['grp_public'], sensitivity: 'public' }
    );
    assert(!rUnsupportedResource.allowed, 'Denies on unrecognized resource type');

    // --------------------------------------------------------------------------
    // TEST GROUP 2: Account Lifecycle & Status Enforcement
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 2: Account Lifecycle & Status Enforcement ---');

    const globalDoc: AuthzResource = {
      type: 'document',
      document_id: 'PDOC-0001',
      tenant_id: 'global',
      allowed_groups: ['grp_public'],
      sensitivity: 'public',
      is_active: true,
      status: 'completed',
    };

    // Active user passes
    const rActive = authorizationService.can(priya, 'read:document', globalDoc);
    assert(rActive.allowed, 'Active user granted access');

    // Suspended user denied
    const rSuspended = authorizationService.can(suspended, 'read:document', globalDoc);
    assert(!rSuspended.allowed, 'Suspended user strictly denied');
    assert(rSuspended.reason?.includes('suspended') === true, 'Provides informative rejection reason for suspended user');

    // Inactive user denied
    const inactiveUser: AuthenticatedUser = {
      ...priya,
      status: 'inactive',
    };
    const rInactive = authorizationService.can(inactiveUser, 'read:document', globalDoc);
    assert(!rInactive.allowed, 'Inactive user strictly denied');

    // --------------------------------------------------------------------------
    // TEST GROUP 3: Tenant Isolation & Scope Rules
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 3: Tenant Isolation & Scope Rules ---');

    const brightwaveDoc: AuthzResource = {
      type: 'document',
      document_id: 'TKT-10421',
      tenant_id: 'ten_brightwave',
      allowed_groups: ['grp_support'],
      sensitivity: 'internal',
      is_active: true,
      status: 'completed',
    };

    const harborpineDoc: AuthzResource = {
      type: 'document',
      document_id: 'TKT-10499',
      tenant_id: 'ten_harborpine',
      allowed_groups: ['grp_support'],
      sensitivity: 'internal',
      is_active: true,
      status: 'completed',
    };

    const lumenfieldDoc: AuthzResource = {
      type: 'document',
      document_id: 'TKT-10467',
      tenant_id: 'ten_lumenfield',
      allowed_groups: ['grp_support'],
      sensitivity: 'internal',
      is_active: true,
      status: 'completed',
    };

    // Priya (Brightwave + Lumenfield)
    assert(authorizationService.can(priya, 'read:document', brightwaveDoc).allowed, 'Priya allowed for Brightwave doc');
    assert(authorizationService.can(priya, 'read:document', lumenfieldDoc).allowed, 'Priya allowed for Lumenfield doc');
    assert(!authorizationService.can(priya, 'read:document', harborpineDoc).allowed, 'Priya denied for Harborpine doc (cross-tenant denied)');

    // Marcus (Harborpine + Lumenfield)
    assert(authorizationService.can(marcus, 'read:document', harborpineDoc).allowed, 'Marcus allowed for Harborpine doc');
    assert(authorizationService.can(marcus, 'read:document', lumenfieldDoc).allowed, 'Marcus allowed for Lumenfield doc');
    assert(!authorizationService.can(marcus, 'read:document', brightwaveDoc).allowed, 'Marcus denied for Brightwave doc (cross-tenant denied)');

    // Elena (Wildcard '*')
    assert(authorizationService.can(elena, 'read:document', brightwaveDoc).allowed, 'Wildcard lead allowed for Brightwave doc');
    assert(authorizationService.can(elena, 'read:document', harborpineDoc).allowed, 'Wildcard lead allowed for Harborpine doc');
    assert(authorizationService.can(elena, 'read:document', lumenfieldDoc).allowed, 'Wildcard lead allowed for Lumenfield doc');

    // Hannah (Customer user - Brightwave only)
    const brightwaveCustomerDoc: AuthzResource = {
      type: 'document',
      document_id: 'DOC-BW-01',
      tenant_id: 'ten_brightwave',
      allowed_groups: ['cust_ten_brightwave_users'],
      sensitivity: 'internal',
      is_active: true,
      status: 'completed',
    };
    const harborpineCustomerDoc: AuthzResource = {
      type: 'document',
      document_id: 'DOC-HP-01',
      tenant_id: 'ten_harborpine',
      allowed_groups: ['cust_ten_harborpine_users'],
      sensitivity: 'internal',
      is_active: true,
      status: 'completed',
    };

    assert(authorizationService.can(hannah, 'read:document', brightwaveCustomerDoc).allowed, 'Customer user allowed in assigned tenant');
    assert(!authorizationService.can(hannah, 'read:document', harborpineCustomerDoc).allowed, 'Customer user quarantined from other customer tenant');

    // Active tenant context checks
    assert(authorizationService.authorizeTenantContext(priya, 'ten_brightwave').allowed, 'Priya authorized for Brightwave tenant context');
    assert(!authorizationService.authorizeTenantContext(priya, 'ten_harborpine').allowed, 'Priya denied for Harborpine tenant context');
    assert(authorizationService.authorizeTenantContext(elena, 'ten_harborpine').allowed, 'Wildcard user authorized for any customer tenant context');
    assert(!authorizationService.authorizeTenantContext(hannah, 'ten_lumenfield').allowed, 'Customer user denied for foreign tenant context');

    // Effective tenant scope narrowing
    assert(authorizationService.getEffectiveTenantScope(priya).length === 2, 'Priya effective scope returns assigned tenants');
    assert(authorizationService.getEffectiveTenantScope(priya, 'ten_brightwave')[0] === 'ten_brightwave', 'Priya effective scope narrowed to valid tenant');
    assert(authorizationService.getEffectiveTenantScope(priya, 'ten_harborpine').length === 0, 'Priya effective scope returns empty on unauthorized tenant');
    assert(authorizationService.getEffectiveTenantScope(elena, 'ten_harborpine')[0] === 'ten_harborpine', 'Wildcard user effective scope narrowed to requested tenant');

    // --------------------------------------------------------------------------
    // TEST GROUP 4: Strict Security Clearance for Restricted Sensitivity
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 4: Strict Security Clearance for Restricted Sensitivity ---');

    const restrictedDoc: AuthzResource = {
      type: 'document',
      document_id: 'SEC-INC-001',
      tenant_id: 'global',
      allowed_groups: ['grp_all_employees'],
      sensitivity: 'restricted',
      is_active: true,
      status: 'completed',
    };

    // Normal employee denied
    const rPriyaRestricted = authorizationService.can(priya, 'read:document', restrictedDoc);
    assert(!rPriyaRestricted.allowed, 'Normal employee denied access to restricted document despite grp_all_employees');

    // Wildcard tenant lead denied (Wildcard tenant does NOT bypass restricted sensitivity!)
    const rElenaRestricted = authorizationService.can(elena, 'read:document', restrictedDoc);
    assert(!rElenaRestricted.allowed, 'Wildcard tenant user denied access to restricted document without clearance');

    // Rafael (IT Security Admin holding grp_security_restricted) granted access
    const rRafaelRestricted = authorizationService.can(rafael, 'read:document', restrictedDoc);
    assert(rRafaelRestricted.allowed, 'IT security admin holding grp_security_restricted granted access');

    // Mei Lin (Engineering Manager holding grp_incident_review) granted access
    const rMeiLinRestricted = authorizationService.can(meiLin, 'read:document', restrictedDoc);
    assert(rMeiLinRestricted.allowed, 'Engineering manager holding grp_incident_review granted access');

    // Helper method check
    assert(authorizationService.hasRestrictedClearance(rafael) === true, 'hasRestrictedClearance returns true for Rafael');
    assert(authorizationService.hasRestrictedClearance(meiLin) === true, 'hasRestrictedClearance returns true for Mei Lin');
    assert(authorizationService.hasRestrictedClearance(priya) === false, 'hasRestrictedClearance returns false for Priya');
    assert(authorizationService.hasRestrictedClearance(elena) === false, 'hasRestrictedClearance returns false for Elena');

    // --------------------------------------------------------------------------
    // TEST GROUP 5: Group-Level Access Control
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 5: Group-Level Access Control ---');

    const engineeringOnlyDoc: AuthzResource = {
      type: 'document',
      document_id: 'ENG-ARCH-001',
      tenant_id: 'global',
      allowed_groups: ['grp_engineering'],
      sensitivity: 'internal',
      is_active: true,
      status: 'completed',
    };

    // Priya (Support) denied
    assert(!authorizationService.can(priya, 'read:document', engineeringOnlyDoc).allowed, 'Support agent denied engineering-only document');

    // Mei Lin (Engineering) allowed
    assert(authorizationService.can(meiLin, 'read:document', engineeringOnlyDoc).allowed, 'Engineering manager allowed engineering-only document');

    // Document with grp_public accessible to all in tenant scope
    const publicDoc: AuthzResource = {
      type: 'document',
      document_id: 'PUB-FAQ-001',
      tenant_id: 'global',
      allowed_groups: ['grp_public'],
      sensitivity: 'public',
      is_active: true,
      status: 'completed',
    };
    assert(authorizationService.can(priya, 'read:document', publicDoc).allowed, 'Support agent allowed grp_public document');
    assert(authorizationService.can(hannah, 'read:document', publicDoc).allowed, 'Customer user allowed global grp_public document');

    // --------------------------------------------------------------------------
    // TEST GROUP 6: Action-Specific Permission Checks
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 6: Action-Specific Permission Checks ---');

    // Citation and preview actions
    assert(authorizationService.can(priya, 'read:citation', brightwaveDoc).allowed, 'Priya allowed read:citation on authorized document');
    assert(authorizationService.can(priya, 'preview:document', brightwaveDoc).allowed, 'Priya allowed preview:document on authorized document');
    assert(!authorizationService.can(marcus, 'read:citation', brightwaveDoc).allowed, 'Marcus denied read:citation on unauthorized document');
    assert(!authorizationService.can(marcus, 'preview:document', brightwaveDoc).allowed, 'Marcus denied preview:document on unauthorized document');

    // Download action
    assert(authorizationService.can(priya, 'download:document', brightwaveDoc).allowed, 'Priya allowed download:document on authorized document');
    assert(!authorizationService.can(marcus, 'download:document', brightwaveDoc).allowed, 'Marcus denied download:document on unauthorized document');

    // Ingest action
    assert(authorizationService.canIngest(priya).allowed, 'Employee Priya allowed to ingest');
    assert(authorizationService.canIngest(priya, 'ten_brightwave').allowed, 'Priya allowed to ingest into scoped tenant');
    assert(!authorizationService.canIngest(priya, 'ten_harborpine').allowed, 'Priya denied from ingesting into foreign tenant');
    assert(!authorizationService.canIngest(hannah).allowed, 'Customer user Hannah strictly denied from ingesting');

    // Tenant management action
    assert(authorizationService.can(rafael, 'manage:tenant', { type: 'tenant', id: 'ten_brightwave' }).allowed, 'IT security admin allowed manage:tenant');
    assert(!authorizationService.can(priya, 'manage:tenant', { type: 'tenant', id: 'ten_brightwave' }).allowed, 'Support agent denied manage:tenant');

    // --------------------------------------------------------------------------
    // TEST GROUP 7: Document Lifecycle & Inactive Version Protection
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 7: Document Lifecycle & Inactive Version Protection ---');

    const inactiveVersionDoc: AuthzResource = {
      type: 'document',
      document_id: 'PDOC-0001',
      tenant_id: 'global',
      allowed_groups: ['grp_public'],
      sensitivity: 'public',
      is_active: false, // inactive version
      status: 'completed',
    };
    assert(!authorizationService.can(priya, 'read:document', inactiveVersionDoc).allowed, 'Inactive document version denied');

    const pendingDoc: AuthzResource = {
      type: 'document',
      document_id: 'PDOC-0001',
      tenant_id: 'global',
      allowed_groups: ['grp_public'],
      sensitivity: 'public',
      is_active: true,
      status: 'pending', // uncompleted ingestion
    };
    assert(!authorizationService.can(priya, 'read:document', pendingDoc).allowed, 'Uncompleted document status denied');

    // --------------------------------------------------------------------------
    // TEST GROUP 8: Database-Backed Authorization (authorizeDocumentById)
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 8: Database-Backed Authorization ---');

    // Priya authorizes Brightwave ticket TKT-10421 from database
    const dbPriyaAuthz = await authorizationService.authorizeDocumentById(priya, 'TKT-10421', 'read:document');
    assert(dbPriyaAuthz.allowed === true, 'Priya successfully authorized for TKT-10421 in PostgreSQL');
    assert(dbPriyaAuthz.document?.document_id === 'TKT-10421', 'Returns valid document record');

    // Marcus denied Brightwave ticket TKT-10421 from database
    const dbMarcusAuthz = await authorizationService.authorizeDocumentById(marcus, 'TKT-10421', 'read:document');
    assert(dbMarcusAuthz.allowed === false, 'Marcus denied for TKT-10421 in PostgreSQL');
    assert(dbMarcusAuthz.document === undefined, 'Does not return document record to unauthorized caller');

    // Nonexistent document returns not found
    const dbNonexistent = await authorizationService.authorizeDocumentById(priya, 'TKT-99999', 'read:document');
    assert(dbNonexistent.allowed === false, 'Nonexistent document returns allowed: false');

    // Global document PDOC-0001 from database
    const dbGlobal = await authorizationService.authorizeDocumentById(priya, 'PDOC-0001', 'read:document');
    assert(dbGlobal.allowed === true, 'Global document PDOC-0001 authorized from PostgreSQL');

    // --------------------------------------------------------------------------
    // TEST GROUP 9: Bulk Document Filtering (filterPermittedDocuments)
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 9: Bulk Document Filtering ---');

    const candidateDocuments = [
      { document_id: 'PDOC-0001', tenant_id: 'global', allowed_groups: ['grp_public'], sensitivity: 'public' as const },
      { document_id: 'TKT-10421', tenant_id: 'ten_brightwave', allowed_groups: ['grp_support'], sensitivity: 'internal' as const },
      { document_id: 'TKT-10499', tenant_id: 'ten_harborpine', allowed_groups: ['grp_support'], sensitivity: 'internal' as const },
      { document_id: 'TKT-10467', tenant_id: 'ten_lumenfield', allowed_groups: ['grp_support'], sensitivity: 'internal' as const },
      { document_id: 'SEC-001', tenant_id: 'global', allowed_groups: ['grp_all_employees'], sensitivity: 'restricted' as const },
    ];

    // Filter for Priya (Brightwave + Lumenfield + Global, no restricted)
    const priyaFiltered = authorizationService.filterPermittedDocuments(priya, candidateDocuments);
    assert(priyaFiltered.length === 3, 'Priya sees exactly 3 permitted documents');
    assert(priyaFiltered.some((d) => d.document_id === 'PDOC-0001'), 'Includes global doc');
    assert(priyaFiltered.some((d) => d.document_id === 'TKT-10421'), 'Includes Brightwave doc');
    assert(priyaFiltered.some((d) => d.document_id === 'TKT-10467'), 'Includes Lumenfield doc');
    assert(!priyaFiltered.some((d) => d.document_id === 'TKT-10499'), 'Excludes Harborpine doc');
    assert(!priyaFiltered.some((d) => d.document_id === 'SEC-001'), 'Excludes restricted doc');

    // Filter for Marcus (Harborpine + Lumenfield + Global, no restricted)
    const marcusFiltered = authorizationService.filterPermittedDocuments(marcus, candidateDocuments);
    assert(marcusFiltered.length === 3, 'Marcus sees exactly 3 permitted documents');
    assert(marcusFiltered.some((d) => d.document_id === 'TKT-10499'), 'Includes Harborpine doc');
    assert(!marcusFiltered.some((d) => d.document_id === 'TKT-10421'), 'Excludes Brightwave doc');

    // Filter for Rafael (Holding grp_security_restricted)
    const rafaelFiltered = authorizationService.filterPermittedDocuments(rafael, candidateDocuments);
    assert(rafaelFiltered.some((d) => d.document_id === 'SEC-001'), 'Rafael includes restricted doc');

    console.log('\n==================================================================');
    console.log(` RESULTS: All ${passedTests}/${totalTests} Central Authorization Tests PASSED!`);
    console.log('==================================================================\n');
  } catch (error) {
    console.error('\nTest Suite Execution Failed:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

runAuthorizationServiceTestSuite();

