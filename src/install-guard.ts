/** Why an install may not proceed, or undefined when it may.
 * A marketplace plugin already registers the provider, and an existing extension is
 * replaced only under --force; either way a second registration must be deliberate. */
export type InstallBlocker = 'marketplace' | 'existing' | 'directory'

// gdp: law force never blocks a marketplace or existing install: (force == false) || ((result != 'marketplace') && (result != 'existing'))
// gdp: law a directory is refused whatever force says: (result == 'directory') implies (exists_extension && exists_isDirectory)
export function installBlocker(exists: {marketplace: boolean; extension: boolean; isDirectory: boolean}, force: boolean): InstallBlocker | undefined {
  if (exists.marketplace && !force) return 'marketplace'
  if (exists.extension && exists.isDirectory) return 'directory'
  if (exists.extension && !force) return 'existing'
  return undefined
}
