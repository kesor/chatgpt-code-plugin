import winston from 'winston';

const ALLOWED_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?'

/**
 * Sanitizes a log message.
 *
 * This function takes a string as input and returns a new string where each character
 * is either included as is (if it's in the whitelist of allowed characters) or replaced
 * with its hexadecimal Unicode value (if it's not in the whitelist).
 *
 * @param {string} message - The log message to sanitize.
 * @returns {string} The sanitized log message.
 */
const sanitizeMessage = (message: string): string =>
  message.split('').map(char =>
    ALLOWED_CHARACTERS.includes(char) ? char : '\\x' + char.charCodeAt(0).toString(16)
  ).join('')


const sanitizeFormat = winston.format(
  info => (info.message ? { ...info, message: sanitizeMessage(info.message) } : info)
)

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    sanitizeFormat(),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error', handleExceptions: true, handleRejections: true }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
  exitOnError: false
});
