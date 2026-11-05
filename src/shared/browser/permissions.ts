/**
 * What a page of the built-in browser gets when it asks for a permission: a rule per permission — every site always,
 * or as the browser's settings say (`sitePermissions`: on for all sites or off for all; the app's own pages always
 * get them); one not named is refused. Nothing is asked of the person (no prompt in the browser).
 */
export const PERMISSION_GRANTS = ['anySite', 'bySetting'] as const
export type PermissionGrant = (typeof PERMISSION_GRANTS)[number]

export const PAGE_PERMISSIONS: Readonly<Record<string, PermissionGrant>> = {
  /** Copying from a page (its «Копировать» button). */
  'clipboard-sanitized-write': 'anySite',
  notifications: 'anySite',
  /** The camera and the microphone. */
  media: 'bySetting',
  /** Reading what the person copied (passwords, tokens may be there). */
  'clipboard-read': 'bySetting',
}

/** Whether a page gets this permission (`ownPage` — the app's own page, not a site; `sitesAllowed` — the setting). */
export function permissionAllowed(permission: string, ownPage: boolean, sitesAllowed: boolean): boolean {
  if (!Object.hasOwn(PAGE_PERMISSIONS, permission)) return false
  const grant = PAGE_PERMISSIONS[permission]
  switch (grant) {
    case 'anySite':
      return true
    case 'bySetting':
      return ownPage || sitesAllowed
    default:
      return grant satisfies never
  }
}
