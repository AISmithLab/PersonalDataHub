/**
 * SandboxEngine handles executing LLM-generated JavaScript functions locally.
 * It uses `new Function` to parse the string into an executable block.
 * Note: In a production React Native environment, ensure Hermes supports this or use QuickJS.
 */
export class SandboxEngine {
  /**
   * Executes a provided script on the given data.
   * @param script A string containing the body of a JS function, e.g., "return JSON.parse(data).length;"
   * @param dataString The normalized JSON string of the raw data.
   * @returns The processed/extracted JSON object or null if it fails.
   */
  static execute(script: string, dataString: string): any {
    try {
      // The script should be a pure function body that expects a 'data' variable.
      // Example script: "const obj = JSON.parse(data); return { id: obj.id, date: obj.date };"
      const sandboxFunc = new Function('data', script);
      const result = sandboxFunc(dataString);
      return result;
    } catch (error) {
      console.error('[SandboxEngine] Script execution failed:', error);
      return null;
    }
  }
}
