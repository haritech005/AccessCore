import assert from 'assert';
import { conversationService } from './conversationService';
import { closePool } from '../db';
import { runMigrations } from '../db/migrate';
import { seedIdentities } from '../db/seedIdentities';

async function runConversationTests() {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 5.2 — Chat Conversations & Isolation Suite  ');
  console.log('==================================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>): Promise<void> {
    return Promise.resolve()
      .then(fn)
      .then(() => {
        console.log(`  ✓ [PASS] ${name}`);
        passed++;
      })
      .catch((err) => {
        console.error(`  ✗ [FAIL] ${name}`);
        console.error(`    ${err instanceof Error ? err.message : String(err)}`);
        failed++;
      });
  }

  // Ensure migrations and identities are initialized
  await runMigrations();
  await seedIdentities({ quiet: true });

  const userHannah = 'cu_001'; // Brightwave customer user
  const userLeo = 'cu_002';    // Harborpine customer user

  try {
    console.log('--- TEST GROUP 1: Conversation Lifecycle & Persistence ---');

    let hannahConvId = '';

    await test('User can create a conversation with default title', async () => {
      const conv = await conversationService.createConversation(userHannah);
      assert(conv.id, 'Must generate conversation UUID');
      assert.strictEqual(conv.user_id, userHannah);
      assert.strictEqual(conv.title, 'New Chat');
      hannahConvId = conv.id;
    });

    await test('User can add messages and trigger auto-titling', async () => {
      const prompt = 'What is the status of Brightwave webhook timeouts?';
      const userMsg = await conversationService.addMessage({
        conversationId: hannahConvId,
        userId: userHannah,
        role: 'user',
        content: prompt,
        autoTitle: true,
      });

      assert.strictEqual(userMsg.role, 'user');
      assert.strictEqual(userMsg.content, prompt);

      const assistantMsg = await conversationService.addMessage({
        conversationId: hannahConvId,
        userId: userHannah,
        role: 'assistant',
        content: 'We are currently investigating webhook timeouts. [TKT-10421]',
        citations: [{ document_id: 'TKT-10421', title: 'Brightwave Webhook' }],
        metadata: { audience: 'customer' },
      });

      assert.strictEqual(assistantMsg.role, 'assistant');
      assert.strictEqual(assistantMsg.citations.length, 1);

      // Verify conversation title updated from 'New Chat'
      const conv = await conversationService.getConversation(userHannah, hannahConvId);
      assert.strictEqual(conv.messages.length, 2);
      assert(conv.title.includes('Brightwave webhook'), `Title should reflect prompt: ${conv.title}`);
    });

    await test('User lists only their own conversations', async () => {
      const hannahList = await conversationService.listConversations(userHannah);
      assert(hannahList.some((c) => c.id === hannahConvId));
      assert(hannahList.every((c) => c.user_id === userHannah));

      const leoList = await conversationService.listConversations(userLeo);
      assert(!leoList.some((c) => c.id === hannahConvId), "Leo must not see Hannah's conversation in his list");
    });

    console.log('\n--- TEST GROUP 2: Cross-User Security Isolation ---');

    await test("User Leo cannot read Hannah's conversation (enforces 403 Forbidden)", async () => {
      let threw403 = false;
      try {
        await conversationService.getConversation(userLeo, hannahConvId);
      } catch (err: any) {
        if (err.statusCode === 403 && err.code === 'FORBIDDEN') {
          threw403 = true;
        }
      }
      assert.strictEqual(threw403, true, 'Cross-user conversation read must throw 403 FORBIDDEN');
    });

    await test("User Leo cannot append messages to Hannah's conversation (enforces 403 Forbidden)", async () => {
      let threw403 = false;
      try {
        await conversationService.addMessage({
          conversationId: hannahConvId,
          userId: userLeo,
          role: 'user',
          content: 'Adversarial message injection attempt',
        });
      } catch (err: any) {
        if (err.statusCode === 403 && err.code === 'FORBIDDEN') {
          threw403 = true;
        }
      }
      assert.strictEqual(threw403, true, 'Cross-user message append must throw 403 FORBIDDEN');
    });

    await test("User Leo cannot delete Hannah's conversation (enforces 403 Forbidden)", async () => {
      let threw403 = false;
      try {
        await conversationService.deleteConversation(userLeo, hannahConvId);
      } catch (err: any) {
        if (err.statusCode === 403 && err.code === 'FORBIDDEN') {
          threw403 = true;
        }
      }
      assert.strictEqual(threw403, true, 'Cross-user conversation deletion must throw 403 FORBIDDEN');
    });

    await test('Owner can delete their conversation with cascading message removal', async () => {
      const deleted = await conversationService.deleteConversation(userHannah, hannahConvId);
      assert.strictEqual(deleted, true);

      let threw404 = false;
      try {
        await conversationService.getConversation(userHannah, hannahConvId);
      } catch (err: any) {
        if (err.statusCode === 404 && err.code === 'NOT_FOUND') {
          threw404 = true;
        }
      }
      assert.strictEqual(threw404, true, 'Deleted conversation must return 404 NOT_FOUND');
    });

    console.log('\n==================================================================');
    console.log(` RESULTS: ${passed} passed, ${failed} failed across ${passed + failed} tests`);
    console.log('==================================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    await closePool();
  }
}

if (require.main === module) {
  runConversationTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal execution error:', err);
      process.exit(1);
    });
}

