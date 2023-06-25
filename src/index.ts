import compression from 'compression'
import timeout from 'connect-timeout'
import cors from 'cors'
import express from 'express'
import fs from 'fs'
import type http from 'http'
import morgan from 'morgan'
import path from 'path'
import { runCommand } from './cmd-runner'
import { handleErrors, validateDependencyOperation, validateFileName, validateFunctionName, validatePackageName, validateParams } from './error-handler'
import { getFileList, isDirectory } from './file-utils'
import { getFunctionData, getFunctionList } from './function-utils'
import { logger } from './logger'

// Define constants for server configuration
const PORT = +(process.env.PORT ?? 3000)
const HOST = process.env.HOST ?? '127.0.0.1'
const TIMEOUT = '15000ms' // https://expressjs.com/en/resources/middleware/timeout.html
const BASE_PATH = process.env.BASE_PATH ?? path.resolve(__dirname, '..')
const ALLOW_OVERWRITE = process.env.ALLOW_OVERWRITE ?? false
const PKG_MANAGER = process.env.PKG_MANAGER ?? 'yarn'

/**
 * Resolves the file path for a given file name.
 *
 * @param {string} fileName - The name of the file.
 * @returns {string} The resolved file path.
 */
const resolveFilePath = (fileName: string) => {
  return path.join(BASE_PATH, decodeURIComponent(fileName))
}

/**
 * Reads the content of a file.
 *
 * @param {express.Request} req - The HTTP request object.
 * @param {boolean} content - Whether to read the file content.
 * @returns {Promise<Object>} An object containing the file name, file path, and file content.
 */
const readFileContent = async (req: express.Request, content = true) => {
  const fileName = decodeURIComponent(req.params[0])
  const filePath = resolveFilePath(fileName)
  return {
    fileName,
    filePath,
    fileContent: content ? await fs.promises.readFile(filePath, 'utf8') : undefined
  }
}

/**
 * Handles GET requests to /files.
 * Fetches the list of files under BASE_PATH and sends it in the response.
 *
 * @param {express.Request} req - The HTTP request object.
 * @param {express.Response} res - The HTTP response object.
 * @param {express.NextFunction} next - The next middleware function.
 */
const getFiles: express.RequestHandler = async (req, res, next) => {
  logger.info('getFiles')
  try {
    const files = await getFileList(BASE_PATH)
    res.send(files.map(fileName => encodeURIComponent(path.relative(BASE_PATH, fileName))))
  } catch (err) {
    next(err)
  }
}

const postNewFile: express.RequestHandler = async (req, res, next) => {
  validateParams(req, res, next)
  const fileName = req.params[0]
  const { content } = req.body
  logger.info(`Creating a new file named ${fileName}`)
  if (!content)
    return res.status(400).json({ error: 'Missing file content.' })
  const filePath = path.join(BASE_PATH, fileName)
  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    const fh = await fs.promises.open(filePath, ALLOW_OVERWRITE ? 'w' : 'wx')
    await fh.writeFile(content)
    await fh.close()
    logger.info(`Successfully created new file ${fileName}`)
    res.status(201).json({ message: 'File created successfully' })
  } catch (err) {
    next(err)
  }
}

/**
 * Handles GET requests to /files/:fileName.
 * Responds with file content or an error
 *
 * @param {express.Request} req - The HTTP request object.
 * @param {express.Response} res - The HTTP response object.
 * @param {express.NextFunction} next - The next middleware function.
 */
const getFileOrFolderContent: express.RequestHandler = async (req, res, next) => {
  validateParams(req, res, next)
  const { fileName, filePath } = await readFileContent(req, false)

  if (await isDirectory(filePath)) {
    logger.info(`Listing files in directory ${filePath}`)
    try {
      const files = await getFileList(filePath)
      res.send(files.map(fileName => encodeURIComponent(path.relative(BASE_PATH, fileName))))
    } catch (err) {
      next(err)
    }
    return
  }

  try {
    logger.info(`Reading file content file ${fileName}`)
    const { fileContent } = await readFileContent(req)
    if (!fileContent)
      return next({ error: 'No content found in file', fileName })
    const startByte = +(req.query['startByte'] ?? 0)
    const endByte = +(req.query['endByte'] ?? fileContent.length - 1)
    res.json({
      fileName,
      content: fileContent.substring(startByte, endByte),
      startByte,
      endByte
    })
  } catch (err) {
    next(err)
  }
}

/**
 * Handles GET requests to /functions.
 * Responds with a list of functions from all project .ts files
 *
 * @param {express.Request} req - The HTTP request object.
 * @param {express.Response} res - The HTTP response object.
 * @param {express.NextFunction} next - The next middleware function.
 */
const getAllFunctions: express.RequestHandler = async (req, res, next) => {
  logger.info('getAllFunctions')
  try {
    res.send(
      (await getFunctionList(BASE_PATH))
        .map(obj => ({ ...obj, fileName: path.relative(BASE_PATH, obj.fileName) }))
    )
  } catch (err) {
    next(err)
  }
}

/**
 * Handles GET requests to /files/:fileName/functions.
 * Responds with a list of functions from the specified .ts file
 *
 * @param {express.Request} req - The HTTP request object.
 * @param {express.Response} res - The HTTP response object.
 * @param {express.NextFunction} next - The next middleware function.
 */
const getFunctionsInFile: express.RequestHandler = async (req, res, next) => {
  validateParams(req, res, next)
  try {
    logger.info(`Reading file content file ${req.params[0]}`)
    const { fileName } = await readFileContent(req, false)
    res.send(
      (await getFunctionList(BASE_PATH, fileName))
        .map(obj => ({ ...obj, fileName: path.relative(BASE_PATH, obj.fileName) }))
    )
  } catch (err) {
    next(err)
  }
}

/**
 * Handles GET requests to /files/:fileName/functions/:functionName.
 * Responds with the content of the named function in a specific file.
 *
 * @param {express.Request} req - The HTTP request object.
 * @param {express.Response} res - The HTTP response object.
 * @param {express.NextFunction} next - The next middleware function.
 */
const getFunctionContent: express.RequestHandler = async (req, res, next) => {
  validateParams(req, res, next)
  try {
    const { functionName } = req.params
    logger.info(`Reading file content file ${req.params[0]} to inspect function ${functionName}`)
    const { filePath } = await readFileContent(req, false)
    const functionCode = await getFunctionData(functionName, filePath)
    if (!functionCode)
      return res.status(404).json({ error: 'Function not found' })
    res.json(functionCode)
  } catch(err) {
    next(err)
  }
}

/**
 * Handles POST requests to /run-command.
 * Executes a command and streams the output.
 *
 * @param {express.Request} req - The HTTP request object.
 * @param {express.Response} res - The HTTP response object.
 * @param {express.NextFunction} next - The next middleware function.
 */
const runCmd: express.RequestHandler = async (req, res, next) => {
  const { command } = req.body;

  if (!command)
    return res.status(400).json({ error: 'Command is required' });

  try {
    const { exitCode, stdout, stderr } = await runCommand(command, BASE_PATH)
    res.json({ exitCode, stdout, stderr })
  } catch (error) {
    next(error);
  }
}

const getDependencies: express.RequestHandler = async (req, res, next) => {
  // Ignore PKG_MANAGER here because:
  //   github.com/yarnpkg/yarn/issues/3569
  const command = `npm list --json --depth=0 --omit dev`
  try {
    const { exitCode, stdout, stderr } = await runCommand(command, BASE_PATH, false)
    res.json({ exitCode, stdout, stderr })
  } catch (error) {
    next(error)
  }
}

const postDependencies: express.RequestHandler = async (req, res, next) => {
  const { operation, packageName, version } = req.body;
  let op, command = ''
  switch (operation) {
    case 'list':
      command = `${PKG_MANAGER} list`
      break
    case 'add':
      op = PKG_MANAGER === 'yarn' ? 'add' : 'install'
      command = `${PKG_MANAGER} ${op} ${packageName}${version ? `@${version}` : ''}`
      break
    case 'remove':
      op = PKG_MANAGER === 'yarn' ? 'remove' : 'uninstall'
      command = `${PKG_MANAGER} ${op} ${packageName}`
      break
    case 'update':
      op = PKG_MANAGER === 'yarn' ? 'upgrade' : 'update'
      command = `${PKG_MANAGER} ${op} ${packageName}${version ? `@${version}` : ''}`
      break
  }
  try {
    const { exitCode, stdout, stderr } = await runCommand(command, BASE_PATH, false)
    res.json({ exitCode, stdout, stderr })
  } catch (error) {
    next(error)
  }
}

/**
 * Sets extra CORS headers.
 * Middleware that adds headers required by OpenAI plugins to each response.
 *
 * @param {express.Request} req - The HTTP request object.
 * @param {express.Response} res - The HTTP response object.
 * @param {express.NextFunction} next - The next middleware function.
 */
const extraCors: express.RequestHandler = async (req, res, next) => {
  res.setHeader("Access-Control-Allow-Private-Network", "true")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
  next()
}

const app = express()
  .disable('x-powered-by')
  .use( timeout(TIMEOUT) )
  .use( compression() )
  .use( express.json({ strict: true }) )
  .use( extraCors )
  .use( cors({ credentials: true }) )
  .use( morgan('dev') )
  .use( express.static('public') )
  .get( '/files', [ timeout(TIMEOUT) ], getFiles )
  .post( '/files/*', [ timeout(TIMEOUT), validateFileName ], postNewFile )
  .get( '/functions', [ timeout(TIMEOUT) ], getAllFunctions )
  .get( '/files/*/functions/:functionName', [ timeout(TIMEOUT), validateFileName, validateFunctionName ], getFunctionContent )
  .get( '/files/*/functions', [ timeout(TIMEOUT), validateFileName ], getFunctionsInFile )
  .get( '/files/*', [ timeout(TIMEOUT), validateFileName ], getFileOrFolderContent )
  .post( '/run-command', [ timeout(TIMEOUT) ], runCmd )
  .get( '/dependencies', [ timeout(TIMEOUT) ], getDependencies )
  .post( '/dependencies', [ timeout(TIMEOUT), validateDependencyOperation, validatePackageName ], postDependencies )
  .use( handleErrors )

let server: http.Server

if (require.main === module) {
  server = app.listen( PORT, HOST, () => {
    console.error(`HTTP Server listening on ${HOST}:${PORT}`)
  })
}

process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server')
  server.close(() => {
    logger.info('HTTP server closed')
  })
})

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server')
  server.close(() => {
    logger.info('HTTP server closed')
  })
})

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err}`)
  server.close(() => {
    logger.info('HTTP server closed')
  })
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled promise rejection: ${JSON.stringify({ promise, reason })}`)
  server.close(() => {
    logger.info('HTTP server closed')
  })
  process.exit(1)
})

export { app }
