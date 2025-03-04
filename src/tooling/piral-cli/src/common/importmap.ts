import { resolve, dirname, isAbsolute } from 'path';
import { log, fail } from './log';
import { satisfies, validate } from './version';
import { computeHash } from './hash';
import { getHash, readJson, findFile, checkExists, checkIsDirectory } from './io';
import { tryResolvePackage } from './npm';
import { SharedDependency, Importmap } from '../types';

const shorthandsUrls = ['', '.', '...'];

function getDependencyDetails(depName: string): [assetName: string, identifier: string, versionSpec: string] {
  const sep = depName.indexOf('@', 1);
  const version = sep > 0 ? depName.substring(sep + 1) : '';
  const id = sep > 0 ? depName.substring(0, sep) : depName;
  const assetName = (id.startsWith('@') ? id.substring(1) : id).replace(/[\/\.]/g, '-').replace(/(\-)+/, '-');
  return [assetName, id, version];
}

function getLocalDependencyVersion(
  packageJson: string,
  depName: string,
  versionSpec: string,
): [offeredVersion: string, requiredVersion: string] {
  const details = require(packageJson);

  if (versionSpec) {
    if (!validate(versionSpec)) {
      fail('importMapVersionSpecInvalid_0026', depName);
    }

    if (!satisfies(details.version, versionSpec)) {
      fail('importMapVersionSpecNotSatisfied_0025', depName, details.version);
    }

    return [details.version, versionSpec];
  }

  return [details.version, details.version];
}

async function resolveImportmap(dir: string, importmap: Importmap) {
  const dependencies: Array<SharedDependency> = [];
  const sharedImports = importmap?.imports;
  const inheritedImports = importmap?.inherit;

  if (typeof sharedImports === 'object' && sharedImports) {
    for (const depName of Object.keys(sharedImports)) {
      const url = sharedImports[depName];
      const [assetName, identifier, versionSpec] = getDependencyDetails(depName);

      if (typeof url !== 'string') {
        log('generalInfo_0000', `The value of "${depName}" in the importmap is not a string and will be ignored.`);
      } else if (/^https?:\/\//.test(url)) {
        const hash = computeHash(url).substring(0, 7);

        dependencies.push({
          id: `${identifier}@${hash}`,
          requireId: `${identifier}@${hash}`,
          entry: url,
          name: identifier,
          ref: url,
          type: 'remote',
        });
      } else if (url === identifier || shorthandsUrls.includes(url)) {
        const entry = tryResolvePackage(identifier, dir);

        if (entry) {
          const packageJson = await findFile(dirname(entry), 'package.json');
          const [version, requireVersion] = getLocalDependencyVersion(packageJson, depName, versionSpec);

          dependencies.push({
            id: `${identifier}@${version}`,
            requireId: `${identifier}@${requireVersion}`,
            entry,
            name: identifier,
            ref: `${assetName}.js`,
            type: 'local',
          });
        } else {
          fail('importMapReferenceNotFound_0027', dir, identifier);
        }
      } else if (!url.startsWith('.') && !isAbsolute(url)) {
        const entry = tryResolvePackage(url, dir);

        if (entry) {
          const packageJson = await findFile(dirname(entry), 'package.json');
          const [version, requireVersion] = getLocalDependencyVersion(packageJson, depName, versionSpec);

          dependencies.push({
            id: `${identifier}@${version}`,
            requireId: `${identifier}@${requireVersion}`,
            entry,
            name: identifier,
            ref: `${assetName}.js`,
            type: 'local',
          });
        } else {
          fail('importMapReferenceNotFound_0027', dir, url);
        }
      } else {
        const entry = resolve(dir, url);
        const exists = await checkExists(entry);

        if (exists) {
          const isDirectory = await checkIsDirectory(entry);
          const packageJson = isDirectory
            ? resolve(entry, 'package.json')
            : await findFile(dirname(entry), 'package.json');
          const packageJsonExists = await checkExists(packageJson);

          if (packageJsonExists) {
            const [version, requireVersion] = getLocalDependencyVersion(packageJson, depName, versionSpec);

            dependencies.push({
              id: `${identifier}@${version}`,
              requireId: `${identifier}@${requireVersion}`,
              entry: isDirectory ? tryResolvePackage(entry, dir) : entry,
              name: identifier,
              ref: `${assetName}.js`,
              type: 'local',
            });
          } else if (isDirectory) {
            fail('importMapReferenceNotFound_0027', entry, 'package.json');
          } else {
            const hash = await getHash(entry);

            dependencies.push({
              id: `${identifier}@${hash}`,
              requireId: `${identifier}@${hash}`,
              entry,
              name: identifier,
              ref: `${assetName}.js`,
              type: 'local',
            });
          }
        } else {
          fail('importMapReferenceNotFound_0027', dir, url);
        }
      }
    }
  }

  if (Array.isArray(inheritedImports)) {
    for (const inheritedImport of inheritedImports) {
      const packageJson = tryResolvePackage(`${inheritedImport}/package.json`, dir);

      if (packageJson) {
        const packageDir = dirname(packageJson);
        const packageDetails = require(packageJson);
        const otherDependencies = await readImportmap(packageDir, packageDetails, true);

        for (const dependency of otherDependencies) {
          const entry = dependencies.find((dep) => dep.name === dependency.name);

          if (!entry) {
            dependencies.push({
              ...dependency,
              parents: [inheritedImport],
            });
          } else if (Array.isArray(entry.parents)) {
            entry.parents.push(inheritedImport);
          }
        }
      }
    }
  }

  return dependencies;
}

export async function readImportmap(
  dir: string,
  packageDetails: any,
  inherited = false,
): Promise<Array<SharedDependency>> {
  const importmap = packageDetails.importmap;

  if (typeof importmap === 'string') {
    const notFound = {};
    const content = await readJson(dir, importmap, notFound);

    if (content === notFound) {
      fail('importMapFileNotFound_0028', dir, importmap);
    }

    const baseDir = dirname(resolve(dir, importmap));
    return resolveImportmap(baseDir, content);
  } else if (typeof importmap === 'undefined' && inherited) {
    // Fall back to sharedDependencies or pilets.external if available
    const shared: Array<string> = packageDetails.sharedDependencies ?? packageDetails.pilets?.externals;

    if (Array.isArray(shared)) {
      return shared.map((dep) => ({
        id: dep,
        name: dep,
        entry: dep,
        type: 'local',
        ref: undefined,
        requireId: dep,
      }));
    }
  }

  return resolveImportmap(dir, importmap);
}
