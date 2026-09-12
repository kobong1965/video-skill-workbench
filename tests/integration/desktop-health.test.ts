import { it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { harness } from '../helpers';

it('桌面握手证明本机密钥和发行身份，不暴露密钥，不接受任意挑战', async () => {
  const h = await harness('desktop_health');
  try {
    const challenge = 'b'.repeat(32);
    const response = await h.app.inject(`/api/health?challenge=${challenge}`);
    const body = response.json();
    expect(body.desktopRelease).toBe('development');
    expect(body.proof).toBe(createHmac('sha256', Buffer.from(h.context.masterKey, 'hex')).update(`video-skill-workbench|development|${challenge}`).digest('hex'));
    expect(response.body).not.toContain(h.context.masterKey);
    expect((await h.app.inject('/api/health?challenge=invalid')).json().proof).toBeUndefined();
  } finally { await h.close(); }
});
