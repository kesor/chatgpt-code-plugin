import compression from 'compression'
import timeout from 'connect-timeout'
import cors from 'cors'
import express from 'express'
import fs from 'fs'
import morgan from 'morgan'
import path from 'path'
import { handleErrors, validateFileName, validateFunctionName, validateParams } from './error-handler'
import { getFileList, getFunctionData, getFunctionList } from './function-utils'
import { logger } from './logger'

const PORT = +(process.env.PORT ?? 3000)
const HOST = process.env.HOST ?? '127.0.0.1'
const TIMEOUT = '5000ms' // https://expressjs.com/en/resources/middleware/timeout.html
const BASE_PATH = process.env.BASE_PATH ?? path.resolve(__dirname, '..', 'src')

// File path resolution function
const resolveFilePath = (fileName: string) => {
  return path.join(BASE_PATH, decodeURIComponent(fileName))
}

const readFileContent = async (req: express.Request, content = true) => {
  const fileName = decodeURIComponent(req.params[0])
  const filePath = resolveFilePath(fileName)
  return {
    fileName,
    filePath,
    fileContent: content ? await fs.promises.readFile(filePath, 'utf8') : undefined
  }
}

// This function handles GET requests to /files.
// It fetches the list of files and sends it in the response.
const getFiles: express.RequestHandler = async (req, res, next) => {
  logger.info('getFiles')
  try {
    const files = await getFileList(BASE_PATH)
    res.send(files.map(fileName => encodeURIComponent(path.relative(BASE_PATH, fileName))))
  } catch (err) {
    next(err)
  }
}

// This function handles GET requests to /files/:fileName.
// It validates the fileName parameter, reads the file content, and sends it in the response.
const getFileContent: express.RequestHandler = async (req, res, next) => {
  validateParams(req, res, next)
  try {
    logger.info('Reading file content file %s', req.params[0])
    const { fileName, fileContent } = await readFileContent(req)
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

// This function handles GET requests to /functions.
// It fetches the list of all functions and sends it in the response.
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

// This function handles GET requests to /files/:fileName/functions.
// It fetches the list of functions in the specified file and sends it in the response.
const getFunctionsInFile: express.RequestHandler = async (req, res, next) => {
  validateParams(req, res, next)
  try {
    logger.info('Reading file content file %s', req.params[0])
    const { fileName } = await readFileContent(req, false)
    res.send(
      (await getFunctionList(BASE_PATH, fileName))
        .map(obj => ({ ...obj, fileName: path.relative(BASE_PATH, obj.fileName) }))
    )
  } catch (err) {
    next(err)
  }
}

const getFunctionContent: express.RequestHandler = async (req, res, next) => {
  validateParams(req, res, next)
  try {
    const { functionName } = req.params
    logger.info(`Reading file content file %s to inspect function %s`, req.params[0], functionName)
    const { filePath } = await readFileContent(req, false)
    const functionCode = await getFunctionData(functionName, filePath)
    if (!functionCode)
      return res.status(404).json({ error: 'Function not found' })
    res.json(functionCode)
  } catch(err) {
    next(err)
  }
}

const extraCors: express.RequestHandler = async (req, res, next) => {
  res.setHeader("Access-Control-Allow-Private-Network", "true")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
  next()
}

const server = express()
  .disable('x-powered-by')
  .use( timeout(TIMEOUT) )
  .use( compression() )
  .use( express.json({ strict: true }) )
  .use( extraCors )
  .use( cors({ credentials: true }) )
  .use( morgan('dev') )
  .use( express.static('public') )
  .get( '/files', [ timeout(TIMEOUT) ], getFiles )
  .get( '/functions', [ timeout(TIMEOUT) ], getAllFunctions )
  .get( '/files/*/functions/:functionName', [ timeout(TIMEOUT), validateFileName, validateFunctionName ], getFunctionContent )
  .get( '/files/*/functions', [ timeout(TIMEOUT), validateFileName ], getFunctionsInFile )
  .get( '/files/*', [ timeout(TIMEOUT), validateFileName ], getFileContent )
  .use( handleErrors )
  .listen( PORT, HOST, () => {
    console.error(`HTTP Server listening on ${HOST}:${PORT}`)
  })

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
  logger.error('Uncaught exception', err)
  server.close(() => {
    logger.info('HTTP server closed')
  })
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', { promise, reason })
  server.close(() => {
    logger.info('HTTP server closed')
  })
  process.exit(1)
})
