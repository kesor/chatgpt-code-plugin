import { AST, AST_NODE_TYPES, parse } from '@typescript-eslint/typescript-estree';
import fs from 'fs';
import ignore from 'ignore';
import path from 'path';
import { logger } from './logger';

interface FileRef {
  fileName: string
  functions?: FunctionRef[]
}

interface FunctionRef {
  functionName: string,
  startByte: number,
  endByte: number
}

// Minimizes a given function body by only keeping the first and last lines
export function minimize(body: string): string {
  const bodyLines = body.split(/(\n|\r)/);
  const MIN_LINES = 2;
  if (bodyLines.length <= MIN_LINES)
    return body;
  return bodyLines[0] + '\n// ...\n' + bodyLines[bodyLines.length - 1];
}

function findFunctionsInFile(ast: AST<{range:true,loc:true}>) {
  // Initialize an empty array to hold the functions
  const functions: {name: string, start: number, end: number}[] = [];

  // Traverse the AST and find all functions
  for (const functionNode of ast.body) {

    if (AST_NODE_TYPES.FunctionDeclaration === functionNode.type)
      functions.push({
        name: functionNode.id?.name || 'anonymous',
        start: functionNode.range[0],
        end: functionNode.range[1],
      });

    if (AST_NODE_TYPES.VariableDeclaration === functionNode.type)
      for (const declarator of functionNode.declarations)
        if ((AST_NODE_TYPES.FunctionExpression === declarator.init?.type ||
            AST_NODE_TYPES.ArrowFunctionExpression === declarator.init?.type) &&
            AST_NODE_TYPES.Identifier === declarator.id.type)
          functions.push({
            name: declarator.id.name,
            start: functionNode.range[0],
            end: functionNode.range[1],
          });

    if (AST_NODE_TYPES.ClassDeclaration === functionNode.type)
      for (const method of functionNode.body.body)
        if (method.type === AST_NODE_TYPES.MethodDefinition && AST_NODE_TYPES.Identifier === method.key.type)
          functions.push({
            name: method.key.name,
            start: method.range[0],
            end: method.range[1],
          });

    if (AST_NODE_TYPES.ExportNamedDeclaration === functionNode.type)
      if (functionNode.declaration && functionNode.declaration.type === 'FunctionDeclaration')
        functions.push({
          name: functionNode.declaration.id?.name || 'anonymous',
          start: functionNode.range[0],
          end: functionNode.range[1],
        });
  }
  return functions;
}

export async function getFunctionList(directory: string = __dirname, fileName?: string): Promise<FileRef[]> {
  const functionList: FileRef[] = [];
  const files = await getFileList(directory)

  const actualFileName = fileName ? path.join(directory, fileName) : undefined
  for (const file of files) {
    if (
       (actualFileName && actualFileName !== file) // when filename is specified, only use that file
    || (!file.endsWith('.ts') && !file.endsWith('.js')) // must be a js/ts file
    || (!fs.statSync(file).isFile()) // must be a file
    )
      continue
    const content = await fs.promises.readFile(file, 'utf8');
    const ast = parse(content, { range: true, loc: true })
    functionList.push({
      fileName: file,
      functions: findFunctionsInFile(ast)
        .map(func => ({
          functionName: func.name,
          startByte: func.start,
          endByte: func.end
        }))
      })
  }

  return functionList
}

export async function getFileList(directory = __dirname, originalRoot = directory, ig = ignore()) {
  const fileList: string[] = [];
  const files = await fs.promises.readdir(directory);

  if (directory === originalRoot) {
    // always ignore .git folder and node_modules/ folders
    ig.add(['.git/**', 'node_modules/**'])

    // Check if there's a .gitignore file in the current directory
    // If .gitignore exists, add its rules to the ignore filter
    const gitignorePath = path.join(directory, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const gitignoreContent = (await fs.promises.readFile(gitignorePath)).toString('utf-8')
      logger.info(`Found gitignore file at ${gitignorePath}. Adding content to ignore rules.`)
      ig.add(
        gitignoreContent
          .split(/\n|\r/)
          .filter(line => !line.startsWith('#'))
          .map(line => line.startsWith('/') ? line.slice(1) : line)
      )
    }
    logger.info(ig); // log the rules of the ignore filter
  }

  for (const file of files) {
    const fullPath = path.join(directory, file)
    const fullRelativePath = path.relative(originalRoot, fullPath)

    const stat = await fs.promises.stat(fullPath);

    // If the file is a directory, recurse into it
    // Note that this will check for a .gitignore file in the directory
    if (stat.isDirectory()) {
      // Skip if the directory is ignored
      const ignored = ig.ignores(fullRelativePath.endsWith('/') ? fullRelativePath : fullRelativePath + '/')
      logger.info(`Checking directory ${fullRelativePath}/ is ignored: ${ignored}`)
      if (ignored)
        continue
      fileList.push(...await getFileList(fullPath, originalRoot, ig));
    } else if (stat.isFile()) {
      // Skip if the file is ignored
      if (ig.ignores(fullRelativePath))
        continue
      fileList.push(fullPath);
    }
  }

  return fileList;
}

export type FunctionData = {
  fileName: string,
  functionName: string
  content: {
    minimal: string,
    full: string
  },
  startByte: number,
  endByte: number
}

async function extractFunctionRange(ast: AST<{loc:true,range:true}>, functionName: string): Promise<{start:number,end:number}|undefined> {
  const functions = findFunctionsInFile(ast);
  const func = functions.find(func => func.name === functionName);
  if (func) {
    return { start: func.start, end: func.end };
  }
}

export async function getFunctionData(functionName:string, fileName: string): Promise<FunctionData | undefined> {
  const fileContent = await fs.promises.readFile(fileName, 'utf-8')
  const ast = parse(fileContent, { loc: true, range: true })
  const range = await extractFunctionRange(ast, functionName)
  if (range) {
    const functionContent = fileContent.substring(range.start, range.end)
    return {
      fileName,
      functionName,
      content: {
        minimal: minimize(functionContent),
        full: functionContent
      },
      startByte: range.start,
      endByte: range.end
    }
  }
}
