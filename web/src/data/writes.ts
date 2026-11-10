import { supabase } from './supabase'

/** Small writes (principle 6): update one column on one row. */
export async function setField(table: string, id: string, field: string, value: unknown) {
  const { error } = await supabase.from(table).update({ [field]: value }).eq('id', id)
  if (error) throw error
}
