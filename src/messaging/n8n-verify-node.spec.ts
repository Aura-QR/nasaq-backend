import { createHmac, webcrypto } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createContext, runInContext } from 'vm';

/**
 * The `Verify signature` Code node, run as the sandbox actually runs it.
 *
 * Three times in a row a change to this node passed review and then died in
 * n8n on a name the sandbox does not define: `TextEncoder`, then
 * `crypto.createHmac`, then `crypto.subtle`. None of that is visible from
 * reading the JSON, and n8n answers the webhook 200 either way, so the only
 * symptom downstream was a preparation that quietly filled nothing.
 *
 * So the node source is lifted out of the workflow files and executed here
 * against a signature produced by the same `createHmac(...).digest('hex')`
 * line the services sign with. The sandbox below is deliberately impoverished:
 * no `TextEncoder`, and `crypto` only where a case says otherwise.
 */

const WORKFLOWS = [
  'nasaq-whatsapp-credentials.json',
  'nasaq-lesson-content.json',
] as const;

const SECRET = 'a-secret-with-Arabic-عربي-and-symbols-#$%';

/** Reads the jsCode of the workflow's `Verify signature` node. */
function verifyNodeSource(file: string): string {
  const raw = readFileSync(join(__dirname, '..', '..', 'n8n', file), 'utf8');
  const nodes = JSON.parse(raw).nodes as any[];
  const node = nodes.find(
    (n) => n.type?.endsWith('.code') && /verify/i.test(n.name ?? ''),
  );
  if (!node) throw new Error(`${file} has no Verify signature Code node`);
  return node.parameters.jsCode as string;
}

/** Exactly what the services put in X-Nasaq-Signature. */
const sign = (body: string) =>
  'sha256=' + createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');

type RunOptions = { crypto?: unknown; envReadable?: boolean };

async function runNode(
  source: string,
  item: any,
  { crypto: cryptoGlobal, envReadable = true }: RunOptions = {},
) {
  const sandbox: Record<string, any> = {
    Buffer,
    Uint8Array,
    DataView,
    Math,
    JSON,
    Array,
    Error,
    $input: { first: () => item },
  };

  if (cryptoGlobal !== undefined) sandbox.crypto = cryptoGlobal;

  if (envReadable) {
    sandbox.$env = { NASAQ_WEBHOOK_SECRET: SECRET };
  } else {
    // n8n does not hand back undefined when env access is off — it throws.
    Object.defineProperty(sandbox, '$env', {
      get() {
        throw new Error('access to env vars denied');
      },
    });
  }

  // The whole point: the sandbox must not carry the name that broke it.
  expect('TextEncoder' in sandbox).toBe(false);

  const context = createContext(sandbox);
  return runInContext(`(async () => {\n${source}\n})()`, context, {
    timeout: 5000,
  });
}

const body = JSON.stringify({
  event: 'preparation.generate',
  lessonTitle: 'الدرس (١) أحب أن أكون',
  unit: 'وحدة القيم الإسلامية',
  objectives: ['أن يميّز الطالب بين الجملة الاسمية والفعلية'],
});

/** The shape the Webhook node produces with Raw Body on. */
const rawBodyItem = (signature: string) => ({
  binary: { data: { data: Buffer.from(body, 'utf8').toString('base64') } },
  json: { headers: { 'x-nasaq-signature': signature } },
});

describe.each(WORKFLOWS)('n8n Verify signature — %s', (file) => {
  const source = verifyNodeSource(file);

  it('never mentions TextEncoder, which the sandbox does not define', () => {
    // The comment explaining its absence is allowed; a use of it is not.
    expect(source).not.toMatch(/new\s+TextEncoder/);
  });

  it('accepts a body signed by the backend, with no crypto in the sandbox', async () => {
    const out = await runNode(source, rawBodyItem(sign(body)));
    expect(out[0].json.valid).toBe(true);
    expect(out[0].json.payload.lessonTitle).toBe('الدرس (١) أحب أن أكون');
  });

  it('rejects a forged signature', async () => {
    const out = await runNode(source, rawBodyItem('sha256=' + 'a'.repeat(64)));
    expect(out[0].json.valid).toBe(false);
  });

  it('rejects a body altered after signing', async () => {
    const signature = sign(body);
    const tampered = {
      binary: {
        data: {
          data: Buffer.from(
            body.replace('أحب أن أكون', 'شيء آخر تماما'),
            'utf8',
          ).toString('base64'),
        },
      },
      json: { headers: { 'x-nasaq-signature': signature } },
    };
    const out = await runNode(source, tampered);
    expect(out[0].json.valid).toBe(false);
  });

  it('does not depend on a crypto the host may or may not expose', async () => {
    for (const cryptoGlobal of [undefined, webcrypto, {}]) {
      const out = await runNode(source, rawBodyItem(sign(body)), {
        crypto: cryptoGlobal,
      });
      expect(out[0].json.valid).toBe(true);
    }
  });

  it('names the switch to flip when $env access is blocked', async () => {
    await expect(
      runNode(source, rawBodyItem(sign(body)), { envReadable: false }),
    ).rejects.toThrow(/N8N_BLOCK_ENV_ACCESS_IN_NODE/);
  });

  it('still verifies when the webhook passes JSON instead of a raw body', async () => {
    const out = await runNode(source, {
      json: {
        body: JSON.parse(body),
        headers: { 'x-nasaq-signature': sign(JSON.stringify(JSON.parse(body))) },
      },
    });
    expect(out[0].json.valid).toBe(true);
  });
});
