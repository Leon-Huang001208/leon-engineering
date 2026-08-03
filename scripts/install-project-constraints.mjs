import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), "project-constraints.mjs");
const DIRECTORY = ".agents";
const FILENAME = "project-constraints.mjs";

function rootDirectory(projectRoot) {
  const root = fs.realpathSync(projectRoot);
  if (!fs.statSync(root).isDirectory()) throw new Error("project root is not a directory");
  return root;
}

function projectDirectory(root, {create = false} = {}) {
  const directory = path.join(root, DIRECTORY);
  if (!fs.existsSync(directory)) {
    if (!create) return directory;
    fs.mkdirSync(directory, {mode: 0o700});
  }
  if (fs.lstatSync(directory).isSymbolicLink() || !fs.statSync(directory).isDirectory()) {
    throw new Error("invalid project constraints directory");
  }
  return directory;
}

function sourceContent() {
  if (fs.lstatSync(SOURCE).isSymbolicLink() || !fs.statSync(SOURCE).isFile()) {
    throw new Error("invalid canonical constraints checker");
  }
  return fs.readFileSync(SOURCE);
}

function checksum(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function atomicWrite(destination, content) {
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, {mode: 0o600});
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}

export function previewProjectConstraintsInstall({projectRoot}) {
  const root = rootDirectory(projectRoot);
  const directory = projectDirectory(root);
  const content = sourceContent();
  return {projectRoot: root, source: SOURCE, destination: path.join(directory, FILENAME), sourceChecksum: checksum(content)};
}

export function installProjectConstraints({projectRoot, replace = false}) {
  const preview = previewProjectConstraintsInstall({projectRoot});
  const directory = projectDirectory(preview.projectRoot, {create: true});
  const destination = path.join(directory, FILENAME);
  if (fs.existsSync(destination)) {
    if (fs.lstatSync(destination).isSymbolicLink() || !fs.statSync(destination).isFile()) {
      throw new Error("invalid project constraints checker");
    }
    if (!replace) throw new Error("existing project constraints checker");
  }
  const content = sourceContent();
  atomicWrite(destination, content);
  return {...preview, destination, sourceChecksum: checksum(content)};
}

function parseArgs(args) {
  const options = {write: false, replace: false};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--project") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--project requires a value");
      options.project = value;
      index += 1;
    } else if (argument === "--write") options.write = true;
    else if (argument === "--replace") options.replace = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  if (!options.project) throw new Error("--project requires a value");
  if (options.replace && !options.write) throw new Error("--replace requires --write");
  return options;
}

function main(args) {
  const options = parseArgs(args);
  const result = options.write
    ? installProjectConstraints({projectRoot: options.project, replace: options.replace})
    : previewProjectConstraintsInstall({projectRoot: options.project});
  process.stdout.write(`${JSON.stringify({written: options.write, ...result})}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`project constraints installation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
