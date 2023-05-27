import cors from 'cors';
import express from 'express';
import { check, validationResult } from 'express-validator';
import * as fs from 'fs';
import morgan from 'morgan';
import path from 'path';
import winston from 'winston';
import { getFileList, getFunctionData, getFunctionList } from './function-utils';

const PORT = +(process.env.PORT ?? 3000);
const BASE_PATH = process.env.BASE_PATH ?? path.resolve(__dirname, '..', 'src')

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

type AsyncExpressRoute = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => Promise<void|express.Response>

const handleErrors: express.ErrorRequestHandler = (err, req, res, next) => {
  logger.error(err);
  if ((err as NodeJS.ErrnoException).code === 'ENOENT')
    return res.status(404).send({ error: 'File not found' });
  if ((err as NodeJS.ErrnoException).code === 'EACCES')
    return res.status(403).send({ error: 'Permission denied' });
  res.status(500).json({ error: 'Internal server error' });
}

// File path resolution function
const resolveFilePath = (fileName: string) => {
  return path.join(BASE_PATH, decodeURIComponent(fileName));
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

// Parameter validation function
const validateParams = (req: express.Request, res: express.Response) => {
  const errors = validationResult(req)
  if (!errors.isEmpty())
    return res.status(400).json({ errors: errors.array() });
}

// This function handles GET requests to /files.
// It fetches the list of files and sends it in the response.
const getFiles: AsyncExpressRoute = async (_req, res, next) => {
  logger.info('getFiles')
  try {
    const files = await getFileList(BASE_PATH);
    res.send(files.map(fileName => encodeURIComponent(path.relative(BASE_PATH, fileName))))
  } catch (err) {
    next(err)
  }
}

// This function handles GET requests to /files/:fileName.
// It validates the fileName parameter, reads the file content, and sends it in the response.
const getFileContent: AsyncExpressRoute = async (req, res, next) => {
  validateParams(req, res);
  try {
    logger.info(`Reading file content file ${req.params[0]}`)
    const { fileName, fileContent } = await readFileContent(req)
    res.json({ file: fileName, content: fileContent });
  } catch (err) {
    next(err)
  }
}

// This function handles GET requests to /functions.
// It fetches the list of all functions and sends it in the response.
const getAllFunctions: AsyncExpressRoute = async (req, res, next) => {
  logger.info('getAllFunctions')
  try {
    res.send(
      (await getFunctionList(BASE_PATH))
        .flat()
        .map(obj => ({ ...obj, file: path.relative(BASE_PATH, obj.file) }))
    )
  } catch (err) {
    next(err)
  }
}

// This function handles GET requests to /files/:fileName/functions.
// It fetches the list of functions in the specified file and sends it in the response.
const getFunctionsInFile: AsyncExpressRoute = async (req, res, next) => {
  validateParams(req, res);
  try {
    logger.info(`Reading file content file ${req.params[0]}`)
    const { fileName } = await readFileContent(req, false)
    res.send(
      (await getFunctionList(BASE_PATH, fileName))
        .flat()
        .map(obj => ({ ...obj, file: path.relative(BASE_PATH, obj.file) }))
    )
  } catch (err) {
    next(err)
  }
}

const getFunctionContent: AsyncExpressRoute = async (req, res, next) => {
  validateParams(req, res);
  try {
    const { functionName } = req.params;
    logger.info(`Reading file content file ${req.params[0]} to inspect function ${functionName}`)
    const { filePath } = await readFileContent(req, false)
    const functionCode = await getFunctionData(functionName, filePath)
    if (!functionCode)
      return res.status(404).json({ error: 'Function not found' });
    res.json(functionCode)
  } catch(err) {
    next(err)
  }
}

const app = express();
app.use(express.json()); // for parsing application/json
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Private-Network", "true")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
  next()
})
app.use(cors({
  origin: 'https://chat.openai.com',
  credentials: true
}))
app.use(morgan('dev'))
app.use(express.static('public'));
app.get('/files', getFiles)
app.get('/functions', getAllFunctions);
app.get('/files/*/functions/:functionName', [
  check('0').isString().withMessage('File name should be a string'),
  check('functionName').isString().withMessage('Function name should be a string'),
], getFunctionContent);
app.get('/files/*/functions', [
  check('0').isString().withMessage('File name should be a string'),
], getFunctionsInFile );
app.get('/files/*', [
  check('0').isString().withMessage('File name should be a string'),
], getFileContent)
app.use(handleErrors)
app.listen(PORT, () => {
  logger.info(`Starting server on port ${PORT}`)
});
