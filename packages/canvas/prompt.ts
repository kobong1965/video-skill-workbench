/** LibTV normalizes outer whitespace and line endings when storing prompts. */
export function canvasPromptsEqual(expected: string, actual: unknown): boolean {
  if (typeof actual !== 'string') return false;
  const normalize = (value: string) => value.replace(/\r\n/g, '\n').trim();
  const normalizedExpected = normalize(expected);
  return normalizedExpected.length > 0 && normalizedExpected === normalize(actual);
}
