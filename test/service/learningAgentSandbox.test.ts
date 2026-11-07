import { isSandboxBackend } from 'deepagents';
import {
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  LEARNING_AGENT_FILESYSTEM_PERMISSIONS,
  LearningAgentService,
} from '../../src/service/LearningAgentService';

describe('LearningAgentService filesystem sandbox', () => {
  it('keeps filesystem tools inside the conversation workspace', async () => {
    const appDir = mkdtempSync(join(tmpdir(), 'learning-agent-sandbox-'));
    const service = new LearningAgentService();
    service.appDir = appDir;

    try {
      const backend: any = (service as any).createSandboxBackend(
        'openid-1',
        'conversation-1'
      );

      expect(isSandboxBackend(backend)).toBe(false);
      expect(typeof backend.execute).toBe('undefined');
      expect(backend.virtualMode).toBe(true);
      expect(backend.cwd.startsWith(join(appDir, 'output'))).toBe(true);

      await backend.write('/notes/plan.md', '# 学习计划');
      await expect(backend.read('/notes/plan.md')).resolves.toMatchObject({
        content: '# 学习计划',
      });

      await expect(backend.read('../../etc/passwd')).resolves.toMatchObject({
        error: expect.stringContaining('Path traversal not allowed'),
      });
      await expect(backend.read('/etc/passwd')).resolves.toMatchObject({
        error: expect.any(String),
      });

      const outsideFile = join(appDir, 'outside.txt');
      writeFileSync(outsideFile, 'outside secret');
      symlinkSync(outsideFile, join(backend.cwd, 'escape.txt'));
      await expect(backend.read('/escape.txt')).resolves.toMatchObject({
        error: expect.any(String),
      });
    } finally {
      rmSync(appDir, { recursive: true, force: true });
    }
  });

  it('denies system paths before the workspace allow rule', () => {
    expect(LEARNING_AGENT_FILESYSTEM_PERMISSIONS[0]).toMatchObject({
      mode: 'deny',
      operations: ['read', 'write'],
    });
    expect(LEARNING_AGENT_FILESYSTEM_PERMISSIONS[0].paths).toEqual(
      expect.arrayContaining(['/etc/**', '/Users/**', '/private/**'])
    );
    expect(LEARNING_AGENT_FILESYSTEM_PERMISSIONS[1]).toMatchObject({
      mode: 'allow',
      paths: ['/**'],
    });
  });
});
