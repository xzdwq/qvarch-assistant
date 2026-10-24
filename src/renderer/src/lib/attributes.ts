import { shallowRef } from 'vue'
import type { AttrDef } from '@shared/tracker/attributes'

/** The events' attributes as the settings have them now (set by the window with the settings, kept in step). */
export const attrDefs = shallowRef<AttrDef[]>([])
export const setAttrDefs = (list: AttrDef[] | undefined) => void (attrDefs.value = list ?? [])
