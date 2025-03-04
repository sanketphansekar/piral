import { resolve, join, extname, basename, dirname, relative } from 'path';
import { log, fail } from './log';
import { cliVersion } from './info';
import { unpackTarball } from './archive';
import { getDependencies, getDependencyPackages, getDevDependencies, getDevDependencyPackages } from './language';
import { ForceOverwrite } from './enums';
import { checkAppShellCompatibility } from './compatibility';
import { deepMerge } from './merge';
import { readImportmap } from './importmap';
import { filesTar, filesOnceTar, declarationEntryExtensions, bundlerNames } from './constants';
import { getHash, checkIsDirectory, matchFiles } from './io';
import { readJson, copy, updateExistingJson, findFile, checkExists } from './io';
import { isGitPackage, isLocalPackage, makeGitUrl, makeFilePath } from './npm';
import { makePiletExternals, makeExternals, findPackageRoot, findSpecificVersion } from './npm';
import {
  SourceLanguage,
  Framework,
  FileInfo,
  PiletsInfo,
  TemplateFileLocation,
  PiletPackageData,
  PiralPackageData,
  SharedDependency,
  PiletDefinition,
  AppDefinition,
  PiralInstancePackageData,
} from '../types';

export interface PiralInstanceData {
  packageName: Framework;
  language: SourceLanguage;
  reactVersion: number;
  reactRouterVersion: number;
}

async function appendBundler(devDependencies: Record<string, string>, bundler: string, proposedVersion: string) {
  if (bundler && bundler !== 'none') {
    if (isValidDependency(bundler)) {
      const sep = bundler.indexOf('@', 1);
      const hasVersion = sep !== -1;
      const proposedName = bundler.substring(0, hasVersion ? sep : bundler.length);
      const givenVersion = hasVersion ? bundler.substring(sep + 1) : proposedVersion;
      const name = bundlerNames.includes(proposedName as any) ? `piral-cli-${bundler}` : proposedName;
      const versions = new Set([
        givenVersion,
        givenVersion.includes('-beta.') && 'next',
        givenVersion.includes('-alpha.') && 'canary',
        'latest',
      ]);

      for (const version of versions) {
        if (version) {
          const isAvailable = await findSpecificVersion(name, version);

          // only if something was returned we know that the version exists; so we can take it.
          if (isAvailable) {
            devDependencies[name] = version;
            return;
          }
        }
      }

      log('generalWarning_0001', `Could not find a valid version for the provided bundler "${bundler}".'`);
    } else {
      //Error case - print warning and ignore
      log('generalWarning_0001', `The provided bundler name "${bundler}" does not refer to a valid package name.'`);
    }
  }
}

function getDependencyVersion(
  name: string,
  devDependencies: Record<string, string | true>,
  allDependencies: Record<string, string>,
) {
  const version = devDependencies[name];
  const selected = typeof version === 'string' ? version : version === true ? allDependencies[name] : undefined;

  if (!selected) {
    log('cannotResolveVersion_0052', name);
  }

  return selected || 'latest';
}

interface FileDescriptor {
  sourcePath: string;
  targetPath: string;
}

const globPatternStartIndicators = ['*', '?', '[', '!(', '?(', '+(', '@('];

async function getMatchingFiles(
  source: string,
  target: string,
  file: string | TemplateFileLocation,
): Promise<Array<FileDescriptor>> {
  const { from, to, deep = true } = typeof file === 'string' ? { from: file, to: file, deep: true } : file;
  const sourcePath = resolve(source, from);
  const targetPath = resolve(target, to);
  const isDirectory = await checkIsDirectory(sourcePath);

  if (isDirectory) {
    log('generalDebug_0003', `Matching in directory "${sourcePath}".`);
    const pattern = deep ? '**/*' : '*';
    const files = await matchFiles(sourcePath, pattern);
    return files.map((file) => ({
      sourcePath: file,
      targetPath: resolve(targetPath, relative(sourcePath, file)),
    }));
  } else if (globPatternStartIndicators.some((m) => from.indexOf(m) !== -1)) {
    log('generalDebug_0003', `Matching using glob "${sourcePath}".`);
    const files = await matchFiles(source, from);
    const parts = sourcePath.split('/');

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (globPatternStartIndicators.some((m) => part.indexOf(m) !== -1)) {
        parts.splice(i, parts.length - i);
        break;
      }
    }

    const relRoot = parts.join('/');
    const tarRoot = resolve(target, to);

    return files.map((file) => ({
      sourcePath: file,
      targetPath: resolve(tarRoot, relative(relRoot, file)),
    }));
  }

  log('generalDebug_0003', `Assume direct path source "${sourcePath}".`);

  return [
    {
      sourcePath,
      targetPath,
    },
  ];
}

export function getPiralPath(root: string, name: string) {
  const path = findPackageRoot(name, root);

  if (!path) {
    fail('invalidPiralReference_0043');
  }

  return dirname(path);
}

function findPiralInstances(
  proposedApps: Array<string>,
  piletPackage: PiletPackageData,
  piletDefinition: undefined | PiletDefinition,
  baseDir: string,
): Array<PiralInstancePackageData> {
  if (proposedApps) {
    // do nothing
  } else if (piletDefinition) {
    const availableApps = Object.keys(piletDefinition.piralInstances || {});
    proposedApps = availableApps.filter((m) => piletDefinition.piralInstances[m].selected);

    if (proposedApps.length === 0) {
      proposedApps = availableApps.slice(0, 1);
    }
  } else {
    proposedApps = [piletPackage.piral?.name].filter(Boolean);
  }

  if (proposedApps.length > 0) {
    return proposedApps.map((proposedApp) => {
      const path = findPackageRoot(proposedApp, baseDir);

      if (path) {
        log('generalDebug_0003', `Following the app package in "${path}" ...`);
        const appPackage = require(path);
        const root = dirname(path);
        const relPath = appPackage && appPackage.app;
        appPackage.app = relPath && resolve(root, relPath);
        appPackage.root = root;
        return appPackage;
      }

      fail('appInstanceNotFound_0010', proposedApp);
    });
  }

  return [];
}

export function readPiralPackage(root: string, name: string): Promise<PiralPackageData> {
  log('generalDebug_0003', `Reading the piral package in "${root}" ...`);
  const path = getPiralPath(root, name);
  return readJson(path, 'package.json');
}

export async function patchPiralPackage(
  root: string,
  app: string,
  data: PiralInstanceData,
  version: string,
  bundler?: string,
) {
  log('generalDebug_0003', `Patching the package.json in "${root}" ...`);
  const pkg = await getPiralPackage(app, data, version, bundler);

  await updateExistingJson(root, 'package.json', pkg);
  log('generalDebug_0003', `Succesfully patched the package.json.`);

  await updateExistingJson(root, 'piral.json', { pilets: getPiletsInfo({}) });
  log('generalDebug_0003', `Succesfully patched the pilet.json.`);
}

export async function getPiralPackage(app: string, data: PiralInstanceData, version: string, bundler?: string) {
  const framework = data.packageName;
  const devDependencies = {
    ...getDevDependencies(
      data.language,
      getDevDependencyPackages(framework, data.reactVersion, data.reactRouterVersion),
    ),
    'piral-cli': `${version}`,
  };
  const dependencies = {
    ...getDependencies(data.language, getDependencyPackages(framework, data.reactVersion, data.reactRouterVersion)),
  };

  await appendBundler(devDependencies, bundler, version);

  return {
    app,
    scripts: {
      start: 'piral debug',
      build: 'piral build',
    },
    importmap: {
      imports: {},
      inherit: [
        'piral-base', // this we take in any case
        framework !== 'piral-base' && 'piral-core', // this we take unless we selected piral-base, then obviously core is not invited to the party
        framework === 'piral' && 'piral', // this we take only if we selected piral
        framework === 'piral-native' && 'piral-native', // this we also only take if we selected piral-native
      ].filter(Boolean),
    },
    dependencies,
    devDependencies,
  };
}

async function getAvailableFiles(
  root: string,
  name: string,
  dirName: string,
  fileMap: Array<TemplateFileLocation>,
): Promise<Array<FileDescriptor>> {
  const source = getPiralPath(root, name);
  const tgz = `${dirName}.tar`;
  log('generalDebug_0003', `Checking if "${tgz}" exists in "${source}" ...`);
  const exists = await checkExists(resolve(source, tgz));

  if (exists) {
    await unpackTarball(source, tgz);
  }

  log('generalDebug_0003', `Get matching files from "${source}".`);
  const base = resolve(source, dirName);
  const files = await matchFiles(base, '**/*');

  return files.map((file) => ({
    sourcePath: file,
    targetPath: resolve(root, relative(base, file)),
  }));
}

export async function getFileStats(root: string, name: string, fileMap: Array<TemplateFileLocation> = []) {
  const files = await getAvailableFiles(root, name, filesTar, fileMap);

  return await Promise.all(
    files.map(async (file) => {
      const { sourcePath, targetPath } = file;
      const sourceHash = await getHash(sourcePath);
      log('generalDebug_0003', `Obtained hash from "${sourcePath}": ${sourceHash}`);
      const targetHash = await getHash(targetPath);
      log('generalDebug_0003', `Obtained hash from "${targetPath}": ${targetHash}`);
      return {
        path: targetPath,
        hash: targetHash,
        changed: sourceHash !== targetHash,
      };
    }),
  );
}

async function copyFiles(
  subfiles: Array<FileDescriptor>,
  forceOverwrite: ForceOverwrite,
  originalFiles: Array<FileInfo>,
  variables?: Record<string, string>,
) {
  for (const subfile of subfiles) {
    const { sourcePath, targetPath } = subfile;
    const exists = await checkExists(sourcePath);

    if (exists) {
      const overwrite = originalFiles.some((m) => m.path === targetPath && !m.changed);
      const force = overwrite ? ForceOverwrite.yes : forceOverwrite;
      await copy(sourcePath, targetPath, force);
    } else {
      fail('cannotFindFile_0046', sourcePath);
    }
  }
}

export async function copyScaffoldingFiles(
  source: string,
  target: string,
  files: Array<string | TemplateFileLocation>,
  piralInfo?: any,
  variables?: Record<string, string>,
) {
  log('generalDebug_0003', `Copying the scaffolding files ...`);
  const allFiles: Array<FileDescriptor> = [];

  for (const file of files) {
    const subfiles = await getMatchingFiles(source, target, file);
    allFiles.push(...subfiles);
  }

  if (piralInfo) {
    await extendPackageOverridesFromTemplateFragment(target, piralInfo, allFiles);
  }

  await copyFiles(allFiles, ForceOverwrite.yes, [], variables);
}

async function extendPackageOverridesFromTemplateFragment(root: string, piralInfo: any, files: Array<FileDescriptor>) {
  const packageTarget = resolve(root, 'package.json');

  for (let i = files.length; i--; ) {
    const file = files[i];

    if (file.targetPath === packageTarget) {
      const fragment = await readJson(dirname(file.sourcePath), basename(file.sourcePath));
      files.splice(i, 1);

      if (!piralInfo.pilets) {
        piralInfo.pilets = {};
      }

      if (!piralInfo.pilets.packageOverrides) {
        piralInfo.pilets.packageOverrides = {};
      }

      piralInfo.pilets.packageOverrides = {
        ...piralInfo.pilets.packageOverrides,
        ...fragment,
      };
    }
  }
}

function isTemplateFileLocation(item: string | TemplateFileLocation): item is TemplateFileLocation {
  return typeof item === 'object';
}

function tryFindPackageVersion(packageName: string): string {
  try {
    const { version } = require(`${packageName}/package.json`);
    return version;
  } catch {
    return undefined;
  }
}

export async function copyPiralFiles(
  root: string,
  name: string,
  piralInfo: PiralPackageData,
  forceOverwrite: ForceOverwrite,
  variables: Record<string, string>,
  originalFiles?: Array<FileInfo>,
) {
  log('generalDebug_0003', `Copying the Piral files ...`);
  const { files: _files } = getPiletsInfo(piralInfo);
  const fileMap = _files.filter(isTemplateFileLocation);
  const files = await getAvailableFiles(root, name, filesTar, fileMap);

  if (originalFiles === undefined) {
    const initialFiles = await getAvailableFiles(root, name, filesOnceTar, fileMap);
    files.push(...initialFiles);
    originalFiles = [];
  }

  await extendPackageOverridesFromTemplateFragment(root, piralInfo, files);
  await copyFiles(files, forceOverwrite, originalFiles, variables);
}

export function getPiletsInfo(piralInfo: Partial<PiralPackageData>): PiletsInfo {
  const {
    files = [],
    scripts = {},
    template = 'default',
    validators = {},
    devDependencies = {},
    preScaffold = '',
    postScaffold = '',
    preUpgrade = '',
    postUpgrade = '',
    packageOverrides = {},
  } = piralInfo.pilets || {};

  return {
    files,
    scripts,
    template,
    validators,
    devDependencies,
    preScaffold,
    postScaffold,
    preUpgrade,
    postUpgrade,
    packageOverrides,
  };
}

export async function retrievePiralRoot(baseDir: string, entry: string) {
  const rootDir = join(baseDir, entry);
  log('generalDebug_0003', `Retrieving Piral root from "${rootDir}" ...`);

  if (!declarationEntryExtensions.includes(extname(rootDir).toLowerCase())) {
    const packageName = basename(rootDir) === 'package.json' ? rootDir : join(rootDir, 'package.json');
    log('generalDebug_0003', `Trying to get entry point from "${packageName}".`);
    const exists = await checkExists(packageName);

    if (!exists) {
      fail('entryPointMissing_0070', rootDir);
    }

    const { app } = require(packageName);

    if (!app) {
      fail('entryPointMissing_0071');
    }

    log('generalDebug_0003', `Found app entry point in "${app}".`);
    return join(dirname(packageName), app);
  }

  log('generalDebug_0003', `Found app entry point in "${rootDir}".`);
  return rootDir;
}

function checkArrayOrUndefined(obj: Record<string, any>, key: string) {
  const items = obj[key];

  if (Array.isArray(items)) {
    return items;
  } else if (items !== undefined) {
    log('expectedArray_0072', key, typeof items);
  }

  return undefined;
}

export function findDependencyVersion(
  pckg: Record<string, any>,
  rootPath: string,
  packageName: string,
): Promise<string> {
  const { devDependencies = {}, dependencies = {} } = pckg;
  const desiredVersion = dependencies[packageName] ?? devDependencies[packageName];

  if (desiredVersion) {
    if (isGitPackage(desiredVersion)) {
      return Promise.resolve(makeGitUrl(desiredVersion));
    } else if (isLocalPackage(rootPath, desiredVersion)) {
      return Promise.resolve(makeFilePath(rootPath, desiredVersion));
    }
  }

  return findPackageVersion(rootPath, packageName);
}

export async function findPackageVersion(rootPath: string, packageName: string): Promise<string> {
  try {
    log('generalDebug_0003', `Finding the version of "${packageName}" in "${rootPath}".`);
    const moduleName = require.resolve(packageName, {
      paths: [rootPath],
    });
    const packageJson = await findFile(moduleName, 'package.json');
    return require(packageJson).version;
  } catch (e) {
    log('cannotResolveDependency_0053', packageName, rootPath);
    return 'latest';
  }
}

export async function retrieveExternals(root: string, packageInfo: any) {
  const sharedDependencies = await readImportmap(root, packageInfo);

  if (sharedDependencies.length === 0) {
    const allDeps = {
      ...packageInfo.devDependencies,
      ...packageInfo.dependencies,
    };
    const deps = packageInfo.pilets?.externals;
    return makeExternals(root, allDeps, deps);
  }

  return sharedDependencies.map((m) => m.name);
}

export async function retrievePiletsInfo(entryFile: string) {
  const exists = await checkExists(entryFile);

  if (!exists) {
    fail('entryPointDoesNotExist_0073', entryFile);
  }

  const packageJson = await findFile(entryFile, 'package.json');

  if (!packageJson) {
    fail('packageJsonMissing_0074');
  }

  const root = dirname(packageJson);
  const packageInfo = require(packageJson);
  const info = getPiletsInfo(packageInfo);
  const externals = await retrieveExternals(root, packageInfo);

  return {
    ...info,
    externals,
    name: packageInfo.name,
    version: packageInfo.version,
    dependencies: {
      std: packageInfo.dependencies || {},
      dev: packageInfo.devDependencies || {},
      peer: packageInfo.peerDependencies || {},
    },
    scripts: packageInfo.scripts,
    ignored: checkArrayOrUndefined(packageInfo, 'preservedDependencies'),
    root,
  };
}

export function isValidDependency(name: string) {
  // super simple check at the moment
  // just to filter out things like "redux-saga/effects" and "@scope/redux-saga/effects"
  return name.indexOf('/') === -1 || (name.indexOf('@') === 0 && name.split('/').length < 3);
}

export async function patchPiletPackage(
  root: string,
  name: string,
  version: string,
  piralInfo: PiralPackageData,
  fromEmulator: boolean,
  newInfo?: { language: SourceLanguage; bundler: string },
) {
  log('generalDebug_0003', `Patching the package.json in "${root}" ...`);
  const pkg = await getPiletPackage(root, name, version, piralInfo, fromEmulator, newInfo);

  await updateExistingJson(root, 'package.json', pkg);
  log('generalDebug_0003', `Succesfully patched the package.json.`);

  await updateExistingJson(root, 'pilet.json', {
    piralInstances: {
      [name]: {},
    },
  });
  log('generalDebug_0003', `Succesfully patched the pilet.json.`);
}

export async function getPiletPackage(
  root: string,
  name: string,
  version: string,
  piralInfo: PiralPackageData,
  fromEmulator: boolean,
  newInfo?: { language: SourceLanguage; bundler: string },
) {
  const { externals, packageOverrides, ...info } = getPiletsInfo(piralInfo);
  const piralDependencies = {
    ...piralInfo.devDependencies,
    ...piralInfo.dependencies,
  };
  const typeDependencies = newInfo ? getDevDependencies(newInfo.language) : {};
  const scripts = newInfo
    ? {
        start: 'pilet debug',
        build: 'pilet build',
        upgrade: 'pilet upgrade',
        ...info.scripts,
      }
    : info.scripts;
  const allExternals = makePiletExternals(root, piralDependencies, externals, fromEmulator, piralInfo);
  const devDependencies: Record<string, string> = {
    ...Object.keys(typeDependencies).reduce((deps, name) => {
      deps[name] = piralDependencies[name] || typeDependencies[name];
      return deps;
    }, {}),
    ...Object.keys(info.devDependencies).reduce((deps, name) => {
      deps[name] = getDependencyVersion(name, info.devDependencies, piralDependencies);
      return deps;
    }, {}),
    ...allExternals.filter(isValidDependency).reduce((deps, name) => {
      const version = piralDependencies[name] || tryFindPackageVersion(name);

      if (version || newInfo) {
        // set only if we have an explicit version or we are in the scaffolding case
        deps[name] = version || 'latest';
      }

      return deps;
    }, {}),
    [name]: `${version || piralInfo.version}`,
  };

  if (newInfo) {
    const bundler = newInfo.bundler;
    const version = `^${cliVersion}`;
    devDependencies['piral-cli'] = version;
    await appendBundler(devDependencies, bundler, version);
  }

  return deepMerge(packageOverrides, {
    importmap: {
      imports: {},
      inherit: [name],
    },
    devDependencies,
    dependencies: {
      [name]: undefined,
    },
    scripts,
  });
}

/**
 * Returns true if its an emulator package, otherwise it has to be a "raw" app shell.
 */
export function checkAppShellPackage(appPackage: PiralPackageData) {
  const { piralCLI = { generated: false, version: cliVersion } } = appPackage;

  if (piralCLI.generated) {
    checkAppShellCompatibility(piralCLI.version);
    return true;
  }

  log('generalDebug_0003', `Missing "piralCLI" section. Assume raw app shell.`);
  return false;
}

export function combinePiletExternals(
  appShells: Array<string>,
  peerDependencies: Record<string, string>,
  peerModules: Array<string>,
  importmap: Array<SharedDependency>,
) {
  const externals = [...Object.keys(peerDependencies), ...peerModules];

  for (let i = importmap.length; i--; ) {
    const entry = importmap[i];

    // if the entry has no parents, i.e., it was explicitly mentioned in the importmap
    // then keep it in the importmap (=> prefer the distributed approach, which will always work)
    if (Array.isArray(entry.parents)) {
      // only accept entry as a centrally shared dependency if the entry appears in all
      // mentioned / referenced app shells
      // in other cases (e.g., if one app shell does not share this) use the distributed
      // mechanism to ensure that the dependency can also be resolved in this shell
      if (appShells.every((app) => entry.parents.includes(app))) {
        externals.push(entry.name);
        importmap.splice(i, 1);
      }
    }
  }

  return externals;
}

export async function retrievePiletData(target: string, app?: string) {
  const piletJson = await findFile(target, 'pilet.json');
  const proposedRoot = piletJson ? dirname(piletJson) : target;
  const packageJson = await findFile(proposedRoot, 'package.json');

  if (!packageJson) {
    fail('packageJsonMissing_0075');
  }

  const root = dirname(packageJson);
  const piletPackage = require(packageJson);
  const piletDefinition = piletJson && require(piletJson);
  const appPackages = findPiralInstances(app && [app], piletPackage, piletDefinition, target);
  const apps: Array<AppDefinition> = [];

  if (appPackages.length === 0) {
    fail('appInstancesNotGiven_0012');
  }

  for (const appPackage of appPackages) {
    const appFile: string = appPackage?.app;
    const appRoot: string = appPackage?.root;

    if (!appFile || !appRoot) {
      fail('appInstanceInvalid_0011');
    }

    const emulator = checkAppShellPackage(appPackage);
    apps.push({
      appPackage,
      appFile,
      appRoot,
      emulator,
    });
  }

  const importmap = await readImportmap(root, piletPackage);

  return {
    dependencies: piletPackage.dependencies || {},
    devDependencies: piletPackage.devDependencies || {},
    peerDependencies: piletPackage.peerDependencies || {},
    peerModules: piletPackage.peerModules || [],
    ignored: checkArrayOrUndefined(piletPackage, 'preservedDependencies'),
    importmap,
    apps,
    piletPackage,
    root,
  };
}
