import fs from 'fs';
import ignore from 'ignore';
import path from 'path';

export async function isDirectory(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(filePath)
    return stat.isDirectory()
  } catch (err) {
    return false
  }
}

export async function getFileList(directory = __dirname, originalRoot = directory, ig = ignore()) {
  const fileList: string[] = [];
  const files = await fs.promises.readdir(directory);

  if (directory === originalRoot) {
    // always ignore .git folder and node_modules/ folders
    ig.add(['.git/**', 'node_modules/**']);

    // Check if there's a .gitignore file in the current directory
    // If .gitignore exists, add its rules to the ignore filter
    const gitignorePath = path.join(directory, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const gitignoreContent = await fs.promises.readFile(gitignorePath, 'utf8');
      ig.add(
        gitignoreContent
          .split(/\n|\r/)
          .filter(line => !line.startsWith('#'))
          .map(line => line.startsWith('/') ? line.slice(1) : line)
      );
    }
  }

  for (const file of files) {
    const fullPath = path.join(directory, file);
    const fullRelativePath = path.relative(originalRoot, fullPath);

    // Skip if the file or directory is ignored
    if (ig.ignores(fullRelativePath) || ig.ignores(fullRelativePath.endsWith('/') ? fullRelativePath : fullRelativePath + '/'))
      continue;

    const stat = await fs.promises.stat(fullPath);

    // If the file is a directory, recurse into it
    if (stat.isDirectory()) {
      fileList.push(...await getFileList(fullPath, originalRoot, ig));
    } else if (stat.isFile()) {
      if (fullPath.endsWith('.gitignore')) {
        const gitignoreContent = fs.readFileSync(fullPath, 'utf8')
        ig.add(
          gitignoreContent.split(/\n|\r/)
          .filter(line => !line.startsWith('#'))
          .map(line => path.dirname(fullPath) + '/' + (line.startsWith('/') ? line.slice(1) : line))
        )
      }
      fileList.push(fullPath);
    }
  }

  return fileList;
}
