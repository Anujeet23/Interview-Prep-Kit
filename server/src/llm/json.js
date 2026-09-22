/** Parse model output as JSON, tolerating code fences and leading/trailing prose. */
export function parseJsonLoose(text) {
  let s = String(text ?? '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const inner = s.slice(start, end + 1);
      try {
        return JSON.parse(inner);
      } catch {
        // common model slip: trailing commas
        return JSON.parse(inner.replace(/,\s*([}\]])/g, '$1'));
      }
    }
    throw new SyntaxError('No JSON object found in model output');
  }
}

export function describeZodError(err) {
  return (err?.issues || [])
    .slice(0, 8)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}
