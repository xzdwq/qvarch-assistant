/** A UUID as the server and the app make them (rooms, spaces, documents, files): 8-4-4-4-12 hex digits, any case. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Whether a value is such an id (the one check everywhere: paths, keys, parameters). */
export const isUuid = (x: unknown): x is string => typeof x === 'string' && UUID.test(x)
