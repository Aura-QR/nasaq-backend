import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common';
import { WhatsappInstanceService } from './whatsapp-instance.service';

/**
 * Connecting a school's own WhatsApp number.
 *
 * Every school used to send through one shared number: one ban would have
 * stopped all of them, and a parent received their child's password from a
 * number that was not their school's. These cover the parts where getting it
 * wrong is expensive — addressing the wrong school's instance, treating a
 * school that has simply never connected as a failure, and leaking the admin
 * key that controls every instance on the server.
 */
describe('WhatsappInstanceService', () => {
  const schoolId = '6a0000000000000000000001';
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
  });

  const build = (
    slug: string | null,
    handler: (method: string, path: string, body: any) => { status: number; body: any },
  ) => {
    const calls: { method: string; path: string; body: any; key?: string }[] = [];

    const schoolModel = {
      findById: () => ({
        select: () => ({
          lean: () => ({ exec: async () => (slug === null ? null : { slug }) }),
        }),
      }),
    };

    globalThis.fetch = (async (url: any, init: any) => {
      const path = String(url).replace('https://evo.test', '');
      const body = init?.body ? JSON.parse(init.body) : undefined;
      calls.push({ method: init.method, path, body, key: init.headers?.apikey });
      const result = handler(init.method, path, body);
      return new Response(JSON.stringify(result.body), { status: result.status });
    }) as any;

    process.env.EVOLUTION_API_URL = 'https://evo.test';
    process.env.EVOLUTION_API_KEY = 'admin-key';

    return { service: new WhatsappInstanceService(schoolModel as any), calls };
  };

  it('a school that never connected reads as not connected, not as an error', async () => {
    const { service } = build('andalus', () => ({ status: 404, body: { message: 'not found' } }));

    const status = await service.status(schoolId);

    expect(status.state).toBe('missing');
    expect(status.connected).toBe(false);
    expect(status.instance).toBe('andalus');
  });

  it('creates the instance under the school slug and returns a scannable QR', async () => {
    const { service, calls } = build('andalus', (method, path) => {
      if (path.startsWith('/instance/connectionState')) return { status: 404, body: {} };
      return { status: 201, body: { qrcode: { base64: 'AAAA' } } };
    });

    const result = await service.connect(schoolId);

    expect(calls[1].path).toBe('/instance/create');
    expect(calls[1].body.instanceName).toBe('andalus');
    expect(result.qr).toBe('data:image/png;base64,AAAA');
    expect(result.state).toBe('connecting');
  });

  it('a school reconnecting is paired again, not created again', async () => {
    const { service, calls } = build('andalus', (method, path) => {
      if (path.startsWith('/instance/connectionState'))
        return { status: 200, body: { instance: { state: 'close' } } };
      return { status: 200, body: { base64: 'BBBB' } };
    });

    const result = await service.connect(schoolId);

    expect(calls.some((call) => call.path === '/instance/create')).toBe(false);
    expect(calls[1].path).toBe('/instance/connect/andalus');
    expect(result.qr).toBe('data:image/png;base64,BBBB');
  });

  it('an already connected school is not sent back to the QR screen', async () => {
    const { service } = build('andalus', (method, path) => {
      if (path.startsWith('/instance/connectionState'))
        return { status: 200, body: { instance: { state: 'open' } } };
      return { status: 200, body: [{ ownerJid: '966500000000@s.whatsapp.net' }] };
    });

    const result = await service.connect(schoolId);

    expect(result.connected).toBe(true);
    expect(result.qr).toBeNull();
    expect(result.number).toBe('966500000000');
  });

  it('refuses a slug that could address another instance', async () => {
    // Evolution takes the instance from the URL path, so "../nasaq2" is a way
    // to send from a number that belongs to someone else.
    for (const slug of ['../nasaq2', 'a b', '', 'x']) {
      const { service } = build(slug, () => ({ status: 200, body: {} }));
      await expect(service.status(schoolId)).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('refuses a school that does not exist', async () => {
    const { service } = build(null, () => ({ status: 200, body: {} }));
    await expect(service.status(schoolId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('never lets the admin key out, and sends it only to Evolution', async () => {
    const { service, calls } = build('andalus', (method, path) => {
      if (path.startsWith('/instance/connectionState')) return { status: 404, body: {} };
      return { status: 201, body: { qrcode: { base64: 'AAAA' } } };
    });

    const result = await service.connect(schoolId);

    expect(calls.every((call) => call.key === 'admin-key')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('admin-key');
  });

  it('logging out keeps the instance so the school can pair again', async () => {
    const { service, calls } = build('andalus', () => ({ status: 200, body: {} }));

    const result = await service.disconnect(schoolId);

    expect(calls[0].path).toBe('/instance/logout/andalus');
    expect(calls.some((call) => call.path.includes('/instance/delete'))).toBe(false);
    expect(result.connected).toBe(false);
  });

  it('reports the reason Evolution refused, rather than a bare failure', async () => {
    const { service } = build('andalus', (method, path) => {
      if (path.startsWith('/instance/connectionState')) return { status: 404, body: {} };
      return { status: 403, body: { response: { message: 'instance limit reached' } } };
    });

    await expect(service.connect(schoolId)).rejects.toThrow(/instance limit reached/);
  });

  it('says so plainly when the server has no Evolution configured', async () => {
    const { service } = build('andalus', () => ({ status: 200, body: {} }));
    process.env.EVOLUTION_API_URL = '';

    await expect(service.status(schoolId)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a network failure is a gateway problem, not a school problem', async () => {
    const schoolModel = {
      findById: () => ({
        select: () => ({ lean: () => ({ exec: async () => ({ slug: 'andalus' }) }) }),
      }),
    };
    process.env.EVOLUTION_API_URL = 'https://evo.test';
    process.env.EVOLUTION_API_KEY = 'admin-key';
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as any;

    const service = new WhatsappInstanceService(schoolModel as any);
    await expect(service.status(schoolId)).rejects.toBeInstanceOf(BadGatewayException);
  });
});
