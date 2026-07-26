import { jest } from '@jest/globals';

const execFileSyncMock = jest.fn();

jest.mock('child_process', () => ({
  execFileSync: execFileSyncMock,
}));

describe('MutationTester command execution safety', () => {
  beforeEach(() => {
    jest.resetModules();
    execFileSyncMock.mockReset();
    execFileSyncMock.mockReturnValue('');
  });

  it('should reject custom mutmut test commands without explicit opt-in', async () => {
    const { MutationTester } = await import('../../src/core/mutation-tester');
    const tester = new MutationTester();

    await expect(
      tester.runMutationTest({
        framework: 'mutmut',
        testCommand: 'pytest; touch /tmp/owned',
      })
    ).rejects.toThrow('Custom mutmut test commands are disabled by default');

    expect(execFileSyncMock).toHaveBeenCalledWith(
      'mutmut',
      ['--version'],
      expect.objectContaining({ stdio: 'ignore' })
    );
    expect(execFileSyncMock).not.toHaveBeenCalledWith(
      'mutmut',
      expect.arrayContaining(['run']),
      expect.anything()
    );
  });

  it('should pass custom mutmut runner as an argv value when explicitly allowed', async () => {
    execFileSyncMock.mockImplementation((...callArgs: unknown[]) => {
      const [cmd, args] = callArgs as [string, string[]];
      if (cmd === 'mutmut' && args[0] === 'results') {
        return 'Killed mutants: 1\nSurvived mutants: 0\n';
      }
      return '';
    });

    const { MutationTester } = await import('../../src/core/mutation-tester');
    const tester = new MutationTester();

    await tester.runMutationTest({
      framework: 'mutmut',
      testCommand: 'pytest',
      allowUnsafeTestCommand: true,
    });

    expect(execFileSyncMock).toHaveBeenCalledWith(
      'mutmut',
      ['run', '--runner', 'pytest'],
      expect.objectContaining({ encoding: 'utf-8' })
    );
  });
});
