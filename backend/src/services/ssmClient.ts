import logger from '../logger';

const INSTANCE_ID = 'i-082e968d59c8c157b';
const REGION = 'us-east-1';
const SSM_NOT_AVAILABLE = { stdout: 'SSM not available — running in read-only context', stderr: '', exitCode: 0 };

// Lazy-loaded SSM SDK — not in package.json, so we use dynamic require with fallback
let ssmAvailable: boolean | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSsmClient(): Promise<any | null> {
  if (ssmAvailable === false) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SSMClient } = require('@aws-sdk/client-ssm');
    ssmAvailable = true;
    return new SSMClient({ region: REGION });
  } catch {
    if (ssmAvailable === null) {
      logger.warn('VegaSSMClient: @aws-sdk/client-ssm not installed — SSM commands will return mock output');
    }
    ssmAvailable = false;
    return null;
  }
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class VegaSSMClient {
  private readonly instanceId: string;

  constructor(instanceId = INSTANCE_ID) {
    this.instanceId = instanceId;
  }

  async runCommand(command: string, timeoutSeconds = 30): Promise<CommandResult> {
    const client = await getSsmClient();
    if (!client) return SSM_NOT_AVAILABLE;

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { SendCommandCommand, GetCommandInvocationCommand } = require('@aws-sdk/client-ssm');

      const sendResult = await client.send(new SendCommandCommand({
        InstanceIds: [this.instanceId],
        DocumentName: 'AWS-RunShellScript',
        Parameters: { commands: [command] },
        TimeoutSeconds: timeoutSeconds,
      }));

      const commandId: string = sendResult.Command?.CommandId;
      if (!commandId) {
        return { stdout: '', stderr: 'No commandId returned from SSM', exitCode: 1 };
      }

      // Poll for completion
      const deadline = Date.now() + (timeoutSeconds + 5) * 1000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 1500));
        try {
          const invocation = await client.send(new GetCommandInvocationCommand({
            CommandId: commandId,
            InstanceId: this.instanceId,
          }));
          const status: string = invocation.Status ?? '';
          if (['Success', 'Failed', 'Cancelled', 'TimedOut'].includes(status)) {
            return {
              stdout: invocation.StandardOutputContent ?? '',
              stderr: invocation.StandardErrorContent ?? '',
              exitCode: status === 'Success' ? 0 : 1,
            };
          }
        } catch (pollErr) {
          // InvocationDoesNotExist can happen briefly — keep polling
          logger.debug('SSM poll transient error', { error: (pollErr as Error).message });
        }
      }

      return { stdout: '', stderr: 'Command timed out waiting for SSM invocation result', exitCode: 1 };
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      logger.error('VegaSSMClient.runCommand failed', { error: msg, command });
      return { stdout: '', stderr: msg, exitCode: 1 };
    }
  }

  async getContainerLogs(containerName: string, lines = 100): Promise<string> {
    const result = await this.runCommand(
      `docker logs --tail ${lines} ${containerName} 2>&1`,
      30,
    );
    if (result.exitCode !== 0 && result.stderr) {
      return `Error: ${result.stderr}`;
    }
    return result.stdout || '(no log output)';
  }

  async getSystemStats(): Promise<string> {
    const result = await this.runCommand(
      `echo "=== Docker containers ===" && docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" && echo "" && echo "=== CPU/Memory ===" && top -bn1 | head -5 && echo "" && echo "=== Disk ===" && df -h / | tail -1`,
      15,
    );
    return result.stdout || result.stderr || 'Unable to retrieve system stats';
  }
}
