import { AST, AST_NODE_TYPES, parse } from '@typescript-eslint/typescript-estree';
import fs from 'fs';
import ignore from 'ignore';
import path from 'path';

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

export async function getFunctionList(directory: string = __dirname, fileName?: string): Promise<{ name: string, file: string }[]> {
  const functionList: { name: string, file: string }[] = [];
  const files = await fs.promises.readdir(directory);

  for (const file of files) {
    const fullPath = path.join(directory, file);
    const stat = await fs.promises.stat(fullPath);

    if (stat.isFile() && file.endsWith('.ts') && (!fileName || file === fileName)) {
      const content = await fs.promises.readFile(fullPath, 'utf8');
      const ast = parse(content, { range: true, loc: true })
      const functions = findFunctionsInFile(ast);
      for (const func of functions)
        functionList.push({
          name: func.name,
          file: fullPath,
        });
    }
  }

  return functionList;
}

export async function getFileList(directory: string = __dirname, relativePath: string = '') {
  const fileList: string[] = [];
  const files = await fs.promises.readdir(directory);

  // Create a new ignore instance
  const ig = ignore({
    allowRelativePaths: true,
    ignoreCase: true
  })
  // always ignore .git folder and node_modules/ folders
  .add(['.git/**', 'node_modules/**'])

  // Check if there's a .gitignore file in the current directory
  // If .gitignore exists, add its rules to the ignore filter
  const gitignorePath = path.join(directory, '.gitignore');
  if (fs.existsSync(gitignorePath))
    ig.add(fs.readFileSync(gitignorePath).toString().split(/\\n|\\r/).filter(x => x).flat())

  for (const file of files) {
    const fullPath = path.join(directory, file).replace(/\\/g, '/')
    const fullRelativePath = path.posix.join(relativePath, file)

    // Skip if the file is ignored
    if (ig.ignores(fullRelativePath))
      continue

    const stat = await fs.promises.stat(fullPath);

    // If the file is a directory, recurse into it
    // Note that this will check for a .gitignore file in the directory
    if (stat.isDirectory())
      fileList.push(...await getFileList(fullPath, fullRelativePath));
    else if (stat.isFile())
      fileList.push(fullPath);
  }

  return fileList;
}

export type FunctionData = {
  fileName: string,
  functionName: string
  content: { minimal: string, full: string }
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
      }
    }
  }
}
