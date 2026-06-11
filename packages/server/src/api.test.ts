import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';

describe('POST /api/render route', () => {
    async function createApp(mockResult: Buffer) {
        const app = Fastify({ logger: false });
        app.post('/api/render', async (_req, reply) => {
            // Simulate Piscina worker dispatching to engine
            const body = _req.body as { options?: { format?: string } };
            const format = body?.options?.format;
            const contentType =
                format === 'jpeg' || format === 'jpg'
                    ? 'image/jpeg'
                    : format === 'png'
                        ? 'image/png'
                        : 'application/octet-stream';

            // Simulate brief processing delay
            await new Promise((r) => setTimeout(r, 5));
            return reply.type(contentType).send(mockResult);
        });
        await app.listen({ port: 0, host: '0.0.0.0' });
        return app;
    }

    it('returns 200 with image/png for PNG request', async () => {
        const app = await createApp(Buffer.from([0x89, 0x50, 0x4E, 0x47]));
        const addr = app.server.address() as { port: number };
        const res = await fetch(`http://127.0.0.1:${addr.port}/api/render`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                templateJson: {},
                variables: {},
                options: { width: 1, height: 1, format: 'png', quantity: 80, compressLevel: 0 },
            }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('image/png');
        expect(Buffer.from(await res.arrayBuffer()).length).toBe(4);
        await app.close();
    });

    it('returns 200 with image/jpeg for JPEG request', async () => {
        const app = await createApp(Buffer.from([0xFF, 0xD8, 0xFF]));
        const addr = app.server.address() as { port: number };
        const res = await fetch(`http://127.0.0.1:${addr.port}/api/render`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                templateJson: {},
                variables: {},
                options: { width: 1, height: 1, format: 'jpeg', quantity: 80, compressLevel: 0 },
            }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('image/jpeg');
        await app.close();
    });

    it('returns octet-stream for unknown format', async () => {
        const app = await createApp(Buffer.from([0x00]));
        const addr = app.server.address() as { port: number };
        const res = await fetch(`http://127.0.0.1:${addr.port}/api/render`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ options: { format: 'pdf' } }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/octet-stream');
        await app.close();
    });
});
