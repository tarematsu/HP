export async function readMinuteFactRuntimeStateList(env) {
  if (!env?.MINUTE_DB) throw new Error('minute fact runtime state DB binding is missing');
  const result = await env.MINUTE_DB
    .prepare('SELECT * FROM sh_minute_fact_runtime_state ORDER BY task_name')
    .all();
  return result.results || [];
}
