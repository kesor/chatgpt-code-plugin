import { spawn } from 'child_process';

const ALLOWED_COMMANDS = [
  'yarn test',
  'npm test',
  'npm run test',
  'yarn install',
  'npm install'
]

export type CommandResult = {
  exitCode: number|null
  stdout: string
  stderr: string
}

/**
 * Executes a command and returns stdout, stderr and exit code.
 *
 * @param {string} command - The command to execute
 */
export function runCommand (command: string, base_path: string, strict = true) {
  if (!command)
    throw new Error('Command is required')

  if (strict && !ALLOWED_COMMANDS.includes(command.trim()))
    throw new Error(`Allowed commands are strictly ${ALLOWED_COMMANDS.join(',')}. This command is not allowed.`)

  return new Promise<CommandResult>(
    (resolve, reject) => {
      const childProcess = spawn(command, {
        cwd: base_path,
        shell: true,
      })

      let stdout = ''
      let stderr = ''

      childProcess.stdout.on('data', data => { stdout += data; })
      childProcess.stderr.on('data', data => { stderr += data; })

      childProcess.on('close', exitCode => resolve({
        exitCode,
        stdout,
        stderr
      }))

      childProcess.on('error', error => reject(error))
    })
}
